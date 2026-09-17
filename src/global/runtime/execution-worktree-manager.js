import { execFileSync } from "node:child_process";
import { closeSync, openSync, unlinkSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { resolveHead, resolveWorkingTreeFingerprint, verifyPlanForExecution } from "../architect/architect-store.js";
import { worktreePaths } from "../paths.js";
import {
  createWorktreeId, EXECUTION_WORKTREE_SCHEMA, WORKTREE_STATES, isTerminalWorktreeState
} from "./execution-worktree-types.js";
import {
  appendCheckpoint, createWorktreeRecord, listWorktreeRecords, readWorktreeState, writeWorktreeState
} from "./execution-worktree-store.js";
import { readRunState } from "./run-store.js";
import { RUN_STATES, isTerminalRunState } from "./run-types.js";
import { resolveReviewSnapshot } from "./review/review-git.js";

/** Only these three roles are real execution-worktree roles — see beginRoleRun's own doc for why this stays a closed list, not an open string. */
const EXECUTION_WORKTREE_ROLES = new Set(["Builder", "Debugger", "Tester"]);

/**
 * The real project's own working tree must be clean before Kairo ever
 * creates an execution worktree from it — the same `.ai/tasks/**` exclusion
 * resolveWorkingTreeFingerprint already uses (Kairo's own task artifacts
 * are never treated as "dirty"), but here checked directly rather than via
 * a fingerprint comparison, since what matters is "is there anything real
 * to lose track of", not a specific hash value.
 */
function assertWorkingTreeClean(projectRoot, { exec }) {
  const diff = exec("git", ["diff", "--binary", "HEAD", "--", ".", ":(exclude).ai/tasks/**"], {
    cwd: projectRoot, encoding: null, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024
  });
  const untracked = exec("git", [
    "ls-files", "--others", "--exclude-standard", "-z", "--", ".", ":(exclude).ai/tasks/**"
  ], { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (diff.length > 0 || String(untracked).trim().length > 0) {
    throw new Error("Working tree is not clean — commit or stash real changes before creating an execution worktree.");
  }
}

/**
 * Best-effort, idempotent undo for any partially-created execution
 * worktree — safe to call even when nothing real was created yet (a
 * `git worktree remove` on an unregistered path just fails quietly, same
 * for an `rm -rf` on a directory that was never made). Never masks the
 * real error that triggered it; the caller always rethrows the original.
 */
async function rollbackWorktree({ projectRoot, treePath, worktreeDir, exec }) {
  try {
    exec("git", ["worktree", "remove", "--force", treePath], { cwd: projectRoot, stdio: "ignore" });
  } catch { /* never registered, or already gone — fine */ }
  try {
    exec("git", ["worktree", "prune"], { cwd: projectRoot, stdio: "ignore" });
  } catch { /* best-effort */ }
  await rm(worktreeDir, { recursive: true, force: true }).catch(() => {});
}

/**
 * The execution worktree itself (not the real project) must have zero
 * uncommitted changes — tracked or untracked — before a role starts and
 * again right before a commit is made. This is what makes the "before"
 * checkpoint and the staged-diff validation trustworthy preconditions
 * instead of just an audit trail: a role can never inherit stray state
 * left over from a previous role or from outside interference, and
 * completeRoleRun can trust that whatever it stages is exactly and only
 * what this role's run produced.
 */
function assertExecutionWorktreeClean(treePath, { exec }) {
  const diff = exec("git", ["diff", "--binary", "HEAD"], {
    cwd: treePath, encoding: null, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024
  });
  const untracked = exec("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: treePath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
  });
  if (diff.length > 0 || String(untracked).trim().length > 0) {
    throw new Error(`Execution worktree at "${treePath}" is not clean.`);
  }
}

/** Unstages everything without touching the working tree — used to back out a rejected staging attempt. */
function unstageAll(treePath, exec) {
  try {
    exec("git", ["reset"], { cwd: treePath, stdio: "ignore" });
  } catch { /* best-effort — the completion is already being rejected */ }
}

/**
 * Creates one real, isolated execution worktree for an approved
 * architecture plan — the real boundary every future role's run will be
 * launched inside, never the project's own directory. Verifies the plan
 * via the real verifyPlanForExecution (APPROVED state, real artifact
 * digests — catches a plan.md/task.md tampered with after approval, which
 * a bare state+HEAD check would silently miss — and baseSha staleness),
 * the exact same gate executePlan itself goes through, never a
 * hand-rolled duplicate of it. checkWorkingTree:false here on purpose:
 * that flag checks the project's fingerprint is byte-identical to
 * whatever it was AT approval time, which is a different, weaker
 * question than "is it clean right now" — assertWorkingTreeClean below
 * is the real precondition a worktree creation needs. Any failure after
 * the state record is written rolls back completely — see
 * rollbackWorktree's own doc; a real orphaned worktree is never left
 * behind.
 * @param {object} args
 * @param {string} args.projectRoot - already-resolved real project root
 * @param {string} args.taskId
 * @param {string} args.homeDir
 * @param {(command: string, args: string[], options: object) => Buffer|string} [args.exec]
 */
export async function createExecutionWorktree({ projectRoot, taskId, homeDir, exec = execFileSync }) {
  const record = await verifyPlanForExecution(projectRoot, taskId, { exec, checkWorkingTree: false });
  // verifyPlanForExecution already proved the project's real current HEAD
  // equals this — reusing it instead of resolving HEAD again avoids a
  // redundant git call for a value already established.
  const currentHead = record.status.baseHead;
  assertWorkingTreeClean(projectRoot, { exec });

  const worktreeId = createWorktreeId();
  const paths = worktreePaths(homeDir, worktreeId);
  const now = new Date().toISOString();
  const originalWorkingTreeFingerprint = resolveWorkingTreeFingerprint(projectRoot, { exec });

  const metadata = {
    schema: EXECUTION_WORKTREE_SCHEMA,
    worktreeId,
    projectRoot,
    taskId,
    treePath: paths.treePath,
    baseSha: currentHead,
    originalWorkingTreeFingerprint,
    status: WORKTREE_STATES.PENDING,
    activeRole: null,
    activeRunId: null,
    // The last HEAD Kairo itself legitimately produced or verified —
    // never null, initialized to baseSha since that's the one HEAD Kairo
    // has actually verified so far (via verifyPlanForExecution above).
    // Every later state-changing boundary (beginRoleRun, completeRoleRun,
    // markReadyForReview) checks the worktree's real current HEAD against
    // this exact value before trusting anything about it — a commit
    // landing at ANY point outside a legitimate completeRoleRun, PENDING
    // included, is a rogue commit, not a clean worktree.
    controlledHeadSha: currentHead,
    readyHeadSha: null,
    createdAt: now,
    updatedAt: now,
    error: null
  };

  try {
    await createWorktreeRecord(homeDir, metadata);
    exec("git", ["worktree", "add", "--detach", paths.treePath, currentHead], {
      cwd: projectRoot, stdio: ["ignore", "ignore", "pipe"]
    });
    const worktreeHead = resolveHead(paths.treePath, { exec });
    if (worktreeHead !== currentHead) {
      throw new Error(`Execution worktree HEAD "${worktreeHead}" does not match the expected base "${currentHead}".`);
    }
    return metadata;
  } catch (error) {
    await rollbackWorktree({ projectRoot, treePath: paths.treePath, worktreeDir: paths.worktreeDir, exec });
    throw error;
  }
}

async function requireWorktree(homeDir, worktreeId) {
  const worktree = await readWorktreeState(homeDir, worktreeId);
  if (!worktree) throw new Error(`Execution worktree "${worktreeId}" not found.`);
  return worktree;
}

/**
 * Best-effort transition to INTERRUPTED with a real, honest reason — used
 * by completeRoleRun's own failure branches (a run that didn't succeed, an
 * unsafe/private/oversized real diff). Never throws itself; the caller
 * still throws its own real error right after calling this, so a
 * persistence failure here never masks the original real reason.
 */
async function markInterrupted(homeDir, worktree, reason) {
  const next = {
    ...worktree, status: WORKTREE_STATES.INTERRUPTED, activeRole: null, activeRunId: null,
    updatedAt: new Date().toISOString(), error: reason
  };
  await writeWorktreeState(homeDir, next).catch(() => {});
  return next;
}

/**
 * The real, systemic guard every state-changing boundary below applies:
 * a clean worktree only proves everything is committed, never that Kairo
 * authorized those commits. PENDING is a real trust boundary exactly like
 * ACTIVE is — a rogue commit made while nothing is "running" would
 * otherwise get silently laundered into legitimacy the moment the next
 * role begins, or the moment the worktree is marked ready for review.
 */
function assertHeadIsControlled(worktree, currentHead, action) {
  if (currentHead !== worktree.controlledHeadSha) {
    throw new Error(
      `Execution worktree HEAD is "${currentHead}", but Kairo's last controlled HEAD is `
      + `"${worktree.controlledHeadSha}" — a commit landed outside Kairo's control. Refusing to ${action}.`
    );
  }
}

/**
 * Starts one real role's run inside an already-created execution worktree
 * — the real boundary a role's own agent run is launched inside (the
 * caller still owns actually starting the real run itself, e.g. via
 * run-manager.js's startRun, pointed at this worktree's treePath as cwd;
 * this function only owns the worktree's own bookkeeping around it).
 * Only Builder/Debugger/Tester are real execution-worktree roles —
 * Explorer/Architect/Reviewer stay non-operational per the plan's own
 * explicitly-deferred scope, and this is a closed list rather than any
 * string precisely so a typo or a future role added elsewhere can never
 * silently start "running" inside a worktree without this file's own
 * explicit sign-off. Requires the worktree to be PENDING (a fresh
 * creation, or the state completeRoleRun leaves it in after a prior
 * role) — never lets two roles run concurrently in the same worktree.
 * Also requires the worktree itself to be completely clean right now
 * (assertExecutionWorktreeClean) AND its real current HEAD to still equal
 * controlledHeadSha (assertHeadIsControlled) — a worktree can sit in
 * PENDING indefinitely between roles, and nothing stops a rogue commit
 * from landing there; a clean tree alone would let it through silently.
 * Records a real "before" checkpoint (the worktree's own real HEAD +
 * working-tree fingerprint right now) before flipping PENDING -> ACTIVE.
 * @param {object} args
 * @param {string} args.worktreeId
 * @param {string} args.role
 * @param {string} args.runId - the real run-manager.js runId this role's
 *   agent process is (or will be) running under — completeRoleRun later
 *   requires this exact same id back.
 * @param {string} args.homeDir
 * @param {(command: string, args: string[], options: object) => Buffer|string} [args.exec]
 */
export async function beginRoleRun({ worktreeId, role, runId, homeDir, exec = execFileSync }) {
  if (!EXECUTION_WORKTREE_ROLES.has(role)) {
    throw new Error(`"${role}" is not a real execution-worktree role — only Builder, Debugger, and Tester may run inside one.`);
  }
  const worktree = await requireWorktree(homeDir, worktreeId);
  if (worktree.status !== WORKTREE_STATES.PENDING) {
    throw new Error(`Execution worktree "${worktreeId}" is ${worktree.status}; expected PENDING to begin a new role run.`);
  }
  assertExecutionWorktreeClean(worktree.treePath, { exec });

  const now = new Date().toISOString();
  const headSha = resolveHead(worktree.treePath, { exec });
  assertHeadIsControlled(worktree, headSha, "begin a new role run");
  const fingerprint = resolveWorkingTreeFingerprint(worktree.treePath, { exec });
  await appendCheckpoint(homeDir, worktreeId, {
    worktreeId, role, runId, phase: "before", headSha, fingerprint, timestamp: now
  });

  const next = {
    ...worktree, status: WORKTREE_STATES.ACTIVE, activeRole: role, activeRunId: runId, updatedAt: now
  };
  await writeWorktreeState(homeDir, next);
  return next;
}

/**
 * Completes one real role's run — the real boundary that decides
 * whether anything the role's agent touched ever becomes a real commit.
 * Requires the exact same runId beginRoleRun recorded (a stale or wrong
 * runId is always rejected, never silently accepted) and the real run
 * (read fresh from run-store.js, never trusted from the caller) to have
 * actually reached a terminal state:
 * - Not yet terminal (still PENDING/STARTING/RUNNING): rejected outright,
 *   no state change at all — this is a caller usage error (completing too
 *   early), not a real worktree failure.
 * The real run also has to prove it actually ran inside this exact
 * worktree (`runState.cwd === worktree.treePath`) — a COMPLETED state
 * alone is never enough, since nothing stops a run claiming completion
 * from a wholly different directory.
 * - Terminal but not COMPLETED (FAILED/CANCELLED/INTERRUPTED), or
 *   COMPLETED from the wrong cwd: the role's real attempt failed — no
 *   commit is ever created for it, and the worktree moves straight to
 *   INTERRUPTED.
 * - COMPLETED, from the right cwd: the real success path, guarded end to
 *   end so what's validated is provably what's committed:
 *   1. The worktree's real current HEAD must still equal
 *      `controlledHeadSha` (the same value beginRoleRun itself verified)
 *      — if it moved at all, the agent ran `git commit` itself instead
 *      of only editing files, and that's rejected outright (INTERRUPTED,
 *      no further commit).
 *   2. The real, current uncommitted working-tree diff is validated via
 *      resolveReviewSnapshot (real path safety, real size/line/file
 *      limits, real symlink/binary/non-regular handling). ANY excluded
 *      entry at all — not just private paths — fails the completion
 *      outright, since there is no consent/cockpit surface yet at this
 *      increment and a validated file riding alongside an excluded one
 *      must never let the excluded one through.
 *   3. When there are real changes, Kairo stages exactly the validated
 *      paths (never `git add -A`), then re-validates the real STAGED
 *      content (not the pre-staging view) — the staged path set must
 *      match what was validated, staged modes must be regular files
 *      only (no submodule gitlinks), and zero unstaged/untracked
 *      changes may remain. HEAD is re-checked immediately before the
 *      commit itself as a final race guard, and the worktree is
 *      re-verified clean immediately after committing.
 *   4. When there are no real changes at all, no commit is fabricated;
 *      the real "after" checkpoint records the exact same real HEAD as
 *      "before".
 *   Either way, the worktree returns to PENDING afterward, ready for the
 *   next role or for markReadyForReview. The agent never runs
 *   `git commit`/`git add` itself at any point — only ever edits files.
 * @param {object} args
 * @param {string} args.worktreeId
 * @param {string} args.role
 * @param {string} args.runId
 * @param {string} args.homeDir
 * @param {(command: string, args: string[], options: object) => Buffer|string} [args.exec]
 * @param {(command: string, args: string[], options: object) => Promise<{stdout: string}>} [args.execFileImpl] - see resolveReviewSnapshot's own doc
 * @param {(homeDir: string, runId: string) => Promise<object|null>} [args.readRun]
 */
export async function completeRoleRun({
  worktreeId, role, runId, homeDir, exec = execFileSync, execFileImpl, readRun = readRunState
}) {
  const worktree = await requireWorktree(homeDir, worktreeId);
  if (worktree.status !== WORKTREE_STATES.ACTIVE) {
    throw new Error(`Execution worktree "${worktreeId}" is ${worktree.status}; expected ACTIVE to complete a role run.`);
  }
  if (worktree.activeRole !== role || worktree.activeRunId !== runId) {
    throw new Error(
      `Role run mismatch for execution worktree "${worktreeId}": active is `
      + `"${worktree.activeRole}"/"${worktree.activeRunId}", not "${role}"/"${runId}".`
    );
  }

  const runState = await readRun(homeDir, runId);
  if (!runState || !isTerminalRunState(runState.state)) {
    throw new Error(`Cannot complete role run: run "${runId}" has not finished yet (state: ${runState?.state ?? "unknown"}).`);
  }

  // A COMPLETED state alone proves nothing about *where* the run actually
  // executed — a run claiming completion from a different cwd never really
  // touched this worktree, so it can never be trusted to close it out.
  if (runState.cwd !== worktree.treePath) {
    await markInterrupted(
      homeDir, worktree,
      `Role "${role}" run "${runId}" ran in "${runState.cwd ?? "unknown"}", not the execution worktree "${worktree.treePath}".`
    );
    throw new Error(
      `Cannot complete role run: run "${runId}" executed outside its execution worktree — `
      + `execution worktree "${worktreeId}" moved to INTERRUPTED, no commit created.`
    );
  }

  if (runState.state !== RUN_STATES.COMPLETED) {
    await markInterrupted(homeDir, worktree, `Role "${role}" run "${runId}" ended in state ${runState.state}.`);
    throw new Error(
      `Role "${role}" run "${runId}" did not complete successfully (state: ${runState.state}) — `
      + `execution worktree "${worktreeId}" moved to INTERRUPTED, no commit created.`
    );
  }

  // The "before" HEAD is a precondition, not just an audit fact: if it
  // moved at all, the agent (or anything else) ran `git commit` itself
  // instead of only editing files, and Kairo can no longer be sure what
  // it's about to stage is exactly and only this role's own work.
  const headBeforeStaging = resolveHead(worktree.treePath, { exec });
  if (headBeforeStaging !== worktree.controlledHeadSha) {
    await markInterrupted(
      homeDir, worktree,
      `Execution worktree HEAD moved from "${worktree.controlledHeadSha}" to "${headBeforeStaging}" `
      + `outside Kairo's control during role "${role}" — the agent committed directly.`
    );
    throw new Error(
      `Cannot complete role run: HEAD changed unexpectedly during role "${role}" — the agent committed `
      + `directly instead of only editing files. Execution worktree "${worktreeId}" moved to INTERRUPTED, no commit created.`
    );
  }

  let workingSnapshot;
  try {
    workingSnapshot = await resolveReviewSnapshot({ cwd: worktree.treePath, execFileImpl });
  } catch (error) {
    await markInterrupted(homeDir, worktree, error.message ?? String(error));
    throw error;
  }

  // ANY excluded entry — private, binary, symlink, non-regular — blocks
  // the whole completion. There is no consent/cockpit surface yet at this
  // increment to ask a human about any of them, and silently committing
  // only the admitted subset is exactly the bypass this guards against:
  // an unrelated excluded file must never ride along just because some
  // other, validated file was also touched.
  if (workingSnapshot.excluded.length > 0) {
    const reason = `Role "${role}" touched path(s) Kairo refuses to commit: `
      + workingSnapshot.excluded.map((e) => `${e.path} (${e.reason})`).join(", ") + ".";
    await markInterrupted(homeDir, worktree, reason);
    throw new Error(`Cannot complete role run: ${reason} Execution worktree "${worktreeId}" moved to INTERRUPTED, no commit created.`);
  }

  if (workingSnapshot.files.length === 0) {
    const now = new Date().toISOString();
    const fingerprint = resolveWorkingTreeFingerprint(worktree.treePath, { exec });
    await appendCheckpoint(homeDir, worktreeId, {
      worktreeId, role, runId, phase: "after", headSha: headBeforeStaging, fingerprint, timestamp: now
    });
    const next = {
      ...worktree, status: WORKTREE_STATES.PENDING, activeRole: null, activeRunId: null,
      controlledHeadSha: headBeforeStaging, updatedAt: now
    };
    await writeWorktreeState(homeDir, next);
    return next;
  }

  // Stage exactly the validated paths — never `git add -A`, which would
  // sweep in anything else sitting in the worktree regardless of what was
  // actually validated above.
  const validatedPaths = workingSnapshot.files.map((f) => f.path);
  exec("git", ["add", "--", ...validatedPaths], { cwd: worktree.treePath, stdio: "ignore" });

  // What's validated must match what's actually staged and about to be
  // committed — re-run the same review snapshot logic against the real
  // staged content, not the pre-staging working-tree view of it.
  let stagedSnapshot;
  try {
    stagedSnapshot = await resolveReviewSnapshot({ cwd: worktree.treePath, staged: true, execFileImpl });
  } catch (error) {
    unstageAll(worktree.treePath, exec);
    await markInterrupted(homeDir, worktree, error.message ?? String(error));
    throw error;
  }

  if (stagedSnapshot.excluded.length > 0) {
    unstageAll(worktree.treePath, exec);
    const reason = `Staged content includes excluded path(s): `
      + stagedSnapshot.excluded.map((e) => `${e.path} (${e.reason})`).join(", ") + ".";
    await markInterrupted(homeDir, worktree, reason);
    throw new Error(`Cannot complete role run: ${reason} Execution worktree "${worktreeId}" moved to INTERRUPTED, no commit created.`);
  }

  const stagedPaths = new Set(stagedSnapshot.files.map((f) => f.path));
  const workingPaths = new Set(workingSnapshot.files.map((f) => f.path));
  const pathSetsMatch = stagedPaths.size === workingPaths.size && [...stagedPaths].every((p) => workingPaths.has(p));
  if (!pathSetsMatch) {
    unstageAll(worktree.treePath, exec);
    const reason = "Staged path set does not match the validated working-tree snapshot.";
    await markInterrupted(homeDir, worktree, reason);
    throw new Error(`Cannot complete role run: ${reason} Execution worktree "${worktreeId}" moved to INTERRUPTED, no commit created.`);
  }

  // Symlinks/binaries are already excluded above; this additionally
  // catches submodule gitlinks (mode 160000) and any other non-regular
  // mode git itself is willing to stage.
  const badMode = stagedSnapshot.files.find((f) => f.mode != null && f.mode !== "100644" && f.mode !== "100755");
  if (badMode) {
    unstageAll(worktree.treePath, exec);
    const reason = `Staged path "${badMode.path}" has a non-regular file mode (${badMode.mode}).`;
    await markInterrupted(homeDir, worktree, reason);
    throw new Error(`Cannot complete role run: ${reason} Execution worktree "${worktreeId}" moved to INTERRUPTED, no commit created.`);
  }

  const unstagedDiff = exec("git", ["diff", "--name-only"], {
    cwd: worktree.treePath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
  });
  const untrackedFiles = exec("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: worktree.treePath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
  });
  if (String(unstagedDiff).trim().length > 0 || String(untrackedFiles).trim().length > 0) {
    unstageAll(worktree.treePath, exec);
    const reason = "Unstaged or untracked changes remain after staging the validated diff.";
    await markInterrupted(homeDir, worktree, reason);
    throw new Error(`Cannot complete role run: ${reason} Execution worktree "${worktreeId}" moved to INTERRUPTED, no commit created.`);
  }

  // Final race guard: re-check HEAD immediately before the real commit,
  // not just once at the top of this function.
  const headBeforeCommit = resolveHead(worktree.treePath, { exec });
  if (headBeforeCommit !== headBeforeStaging) {
    unstageAll(worktree.treePath, exec);
    const reason = `Execution worktree HEAD moved from "${headBeforeStaging}" to "${headBeforeCommit}" while staging.`;
    await markInterrupted(homeDir, worktree, reason);
    throw new Error(`Cannot complete role run: ${reason} Execution worktree "${worktreeId}" moved to INTERRUPTED, no commit created.`);
  }

  exec("git", ["commit", "-qm", `checkpoint(${role}): run ${runId}`], { cwd: worktree.treePath, stdio: "ignore" });

  const now = new Date().toISOString();
  const headSha = resolveHead(worktree.treePath, { exec });
  const fingerprint = resolveWorkingTreeFingerprint(worktree.treePath, { exec });

  // Cleanliness after the commit is itself verified, not assumed — an
  // execution worktree only ever hands back to PENDING in a state the
  // next role (or markReadyForReview) can trust as a real precondition.
  // The commit already happened at this point, so a failure here goes to
  // INTERRUPTED rather than unstaging anything.
  try {
    assertExecutionWorktreeClean(worktree.treePath, { exec });
  } catch (error) {
    await markInterrupted(homeDir, worktree, `Execution worktree left dirty after committing role "${role}": ${error.message}`);
    throw error;
  }

  await appendCheckpoint(homeDir, worktreeId, {
    worktreeId, role, runId, phase: "after", headSha, fingerprint, timestamp: now
  });

  const next = {
    ...worktree, status: WORKTREE_STATES.PENDING, activeRole: null, activeRunId: null,
    controlledHeadSha: headSha, updatedAt: now
  };
  await writeWorktreeState(homeDir, next);
  return next;
}

/**
 * Explicitly marks an execution worktree ready for a real preview/merge
 * (increment 3) — only ever from PENDING (no role run active right now);
 * never automatic after a single role completes, since a real multi-role
 * chain (Builder -> Debugger -> Tester) may still have more roles left to
 * run. That automatic chaining itself is still out of scope here — this
 * is only the explicit, single-worktree "I'm done, this is ready" signal.
 * PENDING alone only proves no role is running right now — it says
 * nothing about whether the worktree is still clean, since nothing stops
 * a stray edit (or leftover excluded file) from landing after the last
 * role completed. READY_FOR_REVIEW is a claim that everything reviewable
 * is already contained in real commits, so that claim is verified here
 * too (assertExecutionWorktreeClean), not just assumed from the status
 * name. But a clean tree alone only proves everything is committed, never
 * that Kairo authorized those commits — a rogue commit made while the
 * worktree sat idle in PENDING (nothing "running" to catch it) would
 * otherwise be laundered into legitimacy right here, so the real current
 * HEAD must also still equal controlledHeadSha (assertHeadIsControlled).
 * Either rejection is a caller/environment usage error, not a worktree
 * failure — zero state change, stays PENDING rather than moving to
 * INTERRUPTED.
 * @param {object} args
 * @param {string} args.worktreeId
 * @param {string} args.homeDir
 * @param {(command: string, args: string[], options: object) => Buffer|string} [args.exec]
 */
export async function markReadyForReview({ worktreeId, homeDir, exec = execFileSync }) {
  const worktree = await requireWorktree(homeDir, worktreeId);
  if (worktree.status !== WORKTREE_STATES.PENDING) {
    throw new Error(`Execution worktree "${worktreeId}" is ${worktree.status}; expected PENDING (no active role run) to mark ready for review.`);
  }
  assertExecutionWorktreeClean(worktree.treePath, { exec });
  // The real HEAD is frozen here, not just cleanliness — previewWorktreeMerge
  // later requires the worktree's current HEAD to still equal this exact
  // value, so any commit landing after this point (however that happened)
  // invalidates the preview instead of silently riding along.
  const readyHeadSha = resolveHead(worktree.treePath, { exec });
  assertHeadIsControlled(worktree, readyHeadSha, "mark ready for review");
  const next = {
    ...worktree, status: WORKTREE_STATES.READY_FOR_REVIEW, readyHeadSha,
    controlledHeadSha: readyHeadSha, updatedAt: new Date().toISOString()
  };
  await writeWorktreeState(homeDir, next);
  return next;
}

/**
 * Computes one real, deterministic merge preview for an execution worktree
 * already in READY_FOR_REVIEW — shared by previewWorktreeMerge (the public
 * read-only preview) and applyWorktreeMerge (which recomputes this exact
 * same preview fresh, right before applying, and refuses to trust a stale
 * one). Never mutates anything and never reserves any resource.
 *
 * - The worktree's own current HEAD must still equal readyHeadSha —
 *   anything else means a commit landed after markReadyForReview (however
 *   that happened), and the caller must mark ready again before previewing.
 * - finalHeadSha (the worktree's current HEAD) must actually descend from
 *   baseSha (`git merge-base --is-ancestor`) — refuses to preview history
 *   that was rewritten or diverged out from under the worktree.
 * - The accumulated diff baseSha..finalHeadSha is validated exactly like a
 *   review snapshot (resolveReviewSnapshot — real path safety, real
 *   accumulated size/line/file limits across every role's commits
 *   combined, real symlink/binary/non-regular handling). ANY excluded
 *   entry blocks the preview outright, same as completeRoleRun's own rule.
 * - The fingerprint binds baseSha, finalHeadSha, and a real digest of the
 *   exact binary diff bytes between them — applyWorktreeMerge's
 *   confirmationTarget must match all three exactly, not just the SHAs.
 * @param {object} worktree
 * @param {object} deps
 * @param {(command: string, args: string[], options: object) => Buffer|string} deps.exec
 * @param {(command: string, args: string[], options: object) => Promise<{stdout: string}>} [deps.execFileImpl]
 */
async function computeMergePreview(worktree, { exec, execFileImpl }) {
  assertExecutionWorktreeClean(worktree.treePath, { exec });

  const currentHead = resolveHead(worktree.treePath, { exec });
  if (currentHead !== worktree.readyHeadSha) {
    throw new Error(
      `Execution worktree HEAD moved from "${worktree.readyHeadSha}" to "${currentHead}" after it was marked `
      + "ready for review — a fresh markReadyForReview is required before previewing again."
    );
  }

  const baseSha = worktree.baseSha;
  const finalHeadSha = currentHead;

  try {
    exec("git", ["merge-base", "--is-ancestor", baseSha, finalHeadSha], { cwd: worktree.treePath, stdio: "ignore" });
  } catch {
    throw new Error(`Execution worktree HEAD "${finalHeadSha}" does not descend from its own baseSha "${baseSha}" — refusing to preview.`);
  }

  const snapshot = await resolveReviewSnapshot({ cwd: worktree.treePath, base: baseSha, execFileImpl });
  if (snapshot.excluded.length > 0) {
    const reason = `Execution worktree's accumulated diff touches path(s) Kairo refuses to merge: `
      + snapshot.excluded.map((e) => `${e.path} (${e.reason})`).join(", ") + ".";
    throw new Error(reason);
  }

  const rawDiff = exec("git", ["diff", "--binary", `${baseSha}..${finalHeadSha}`], {
    cwd: worktree.treePath, encoding: null, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024
  });
  const diffDigest = createHash("sha256").update(rawDiff).digest("hex");
  const fingerprint = createHash("sha256").update(JSON.stringify({ baseSha, finalHeadSha, diffDigest })).digest("hex");

  return {
    baseSha,
    finalHeadSha,
    fingerprint,
    diffText: rawDiff.toString("utf8"),
    stats: {
      fileCount: snapshot.totals.fileCount,
      changedLines: snapshot.totals.changedLines,
      diffBytes: snapshot.totals.diffBytes
    },
    noChanges: baseSha === finalHeadSha
  };
}

/**
 * Read-only preview of what applyWorktreeMerge would apply — real diff,
 * real stats, real fingerprint, computed fresh every call. Never changes
 * the worktree's state and never reserves anything; see computeMergePreview
 * for the real validation this performs.
 * @param {object} args
 * @param {string} args.worktreeId
 * @param {string} args.homeDir
 * @param {(command: string, args: string[], options: object) => Buffer|string} [args.exec]
 * @param {(command: string, args: string[], options: object) => Promise<{stdout: string}>} [args.execFileImpl]
 */
export async function previewWorktreeMerge({ worktreeId, homeDir, exec = execFileSync, execFileImpl }) {
  const worktree = await requireWorktree(homeDir, worktreeId);
  if (worktree.status !== WORKTREE_STATES.READY_FOR_REVIEW) {
    throw new Error(`Execution worktree "${worktreeId}" is ${worktree.status}; expected READY_FOR_REVIEW to preview a merge.`);
  }
  return computeMergePreview(worktree, { exec, execFileImpl });
}

/**
 * Real, exclusive, file-based lock per worktree — the git mutation
 * applyWorktreeMerge performs against the real project needs actual
 * exclusion, not just serialized state writes. writeWorktreeState's own
 * per-worktreeId in-memory queue only serializes the write itself; it does
 * nothing to stop two concurrent applyWorktreeMerge calls from both
 * reading READY_FOR_REVIEW and both passing every check before either one
 * writes APPLYING. An exclusive `wx` file create is atomic at the
 * filesystem level and closes that whole window, not just the write.
 */
function acquireApplyLock(worktreeDir) {
  const lockPath = join(worktreeDir, "apply.lock");
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("Another apply is already in progress for this execution worktree.");
    }
    throw error;
  }
  closeSync(fd);
  return lockPath;
}

function releaseApplyLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch { /* best-effort — recovery of a stale lock is increment 4's own scope */ }
}

/**
 * Applies one real, previously previewed merge — the only place a
 * confirmed, reviewed commit chain ever reaches the real project, and
 * only ever via `git merge --ff-only`: never cherry-pick, never a partial
 * patch, never automatic conflict resolution.
 *
 * Every check runs BEFORE anything is mutated, and every one of them
 * rejects with zero state change (the worktree stays READY_FOR_REVIEW):
 * a stale or hand-built confirmationTarget that doesn't match a freshly
 * recomputed preview, a worktree whose HEAD moved since the preview, or
 * a real project that no longer has the exact HEAD, working-tree
 * fingerprint, and cleanliness it had when this worktree was created.
 * Drift is never resolved automatically — the caller must get a fresh
 * preview and confirm again.
 *
 * Only once every one of those has passed does this persist APPLYING and
 * actually run `git merge --ff-only` against the real project. Any
 * failure from this point on — the merge itself failing (e.g. the real
 * project stopped being fast-forwardable in the tiny window since the
 * last check), or the post-merge verification (real HEAD must equal
 * finalHeadSha, real project tree must be clean) — moves the worktree to
 * INTERRUPTED. `git merge --ff-only` itself guarantees no partial merge
 * on failure; this never attempts to rewrite history to recover.
 *
 * A no-op preview (baseSha === finalHeadSha, nothing was ever committed
 * across any role) skips the real git mutation entirely and goes
 * straight to APPLIED — there is nothing to merge.
 * @param {object} args
 * @param {string} args.worktreeId
 * @param {{baseSha: string, finalHeadSha: string, fingerprint: string}} args.confirmationTarget - a preview's own exact output, never hand-built by a caller
 * @param {string} args.homeDir
 * @param {(command: string, args: string[], options: object) => Buffer|string} [args.exec]
 * @param {(command: string, args: string[], options: object) => Promise<{stdout: string}>} [args.execFileImpl]
 */
export async function applyWorktreeMerge({ worktreeId, confirmationTarget, homeDir, exec = execFileSync, execFileImpl }) {
  const worktree = await requireWorktree(homeDir, worktreeId);
  if (worktree.status !== WORKTREE_STATES.READY_FOR_REVIEW) {
    throw new Error(`Execution worktree "${worktreeId}" is ${worktree.status}; expected READY_FOR_REVIEW to apply a merge.`);
  }

  const { worktreeDir } = worktreePaths(homeDir, worktreeId);
  const lockPath = acquireApplyLock(worktreeDir);

  try {
    // Re-read fresh now that the lock is actually held — another apply
    // may have already moved this worktree while this call was blocked
    // acquiring the lock (or, absent a real lock, would have raced here).
    const fresh = await requireWorktree(homeDir, worktreeId);
    if (fresh.status !== WORKTREE_STATES.READY_FOR_REVIEW) {
      throw new Error(`Execution worktree "${worktreeId}" is ${fresh.status}; expected READY_FOR_REVIEW to apply a merge.`);
    }

    const preview = await computeMergePreview(fresh, { exec, execFileImpl });
    const matches = confirmationTarget
      && confirmationTarget.baseSha === preview.baseSha
      && confirmationTarget.finalHeadSha === preview.finalHeadSha
      && confirmationTarget.fingerprint === preview.fingerprint;
    if (!matches) {
      throw new Error(
        "Cannot apply: confirmationTarget does not match a fresh preview of this execution worktree — "
        + "request a new preview and confirm again."
      );
    }

    const projectHead = resolveHead(fresh.projectRoot, { exec });
    if (projectHead !== fresh.baseSha) {
      throw new Error(
        `Cannot apply: the real project's HEAD is "${projectHead}", not the execution worktree's own baseSha `
        + `"${fresh.baseSha}" — the project moved since this worktree was created.`
      );
    }
    const projectFingerprint = resolveWorkingTreeFingerprint(fresh.projectRoot, { exec });
    if (projectFingerprint !== fresh.originalWorkingTreeFingerprint) {
      throw new Error("Cannot apply: the real project's working tree no longer matches its original fingerprint.");
    }
    assertWorkingTreeClean(fresh.projectRoot, { exec });

    if (preview.noChanges) {
      const next = { ...fresh, status: WORKTREE_STATES.APPLIED, updatedAt: new Date().toISOString() };
      await writeWorktreeState(homeDir, next);
      return next;
    }

    const applying = { ...fresh, status: WORKTREE_STATES.APPLYING, updatedAt: new Date().toISOString() };
    await writeWorktreeState(homeDir, applying);

    try {
      exec("git", ["merge", "--ff-only", preview.finalHeadSha], {
        cwd: fresh.projectRoot, stdio: ["ignore", "ignore", "pipe"]
      });

      const mergedHead = resolveHead(fresh.projectRoot, { exec });
      if (mergedHead !== preview.finalHeadSha) {
        throw new Error(`Real project HEAD is "${mergedHead}" after the merge, expected "${preview.finalHeadSha}".`);
      }
      assertWorkingTreeClean(fresh.projectRoot, { exec });

      const applied = { ...applying, status: WORKTREE_STATES.APPLIED, updatedAt: new Date().toISOString() };
      await writeWorktreeState(homeDir, applied);
      return applied;
    } catch (error) {
      await markInterrupted(homeDir, applying, `Merge into the real project failed or left it in an unexpected state: ${error.message}`);
      throw error;
    }
  } finally {
    releaseApplyLock(lockPath);
  }
}

/**
 * Explicit human/orchestrator cancellation — valid from any state where
 * nothing real is being mutated right now (PENDING, ACTIVE,
 * READY_FOR_REVIEW), never from APPLYING: a real git mutation against the
 * real project may be in flight there, and cancelling mid-mutation is
 * undefined, not "safe to abandon". Never commits anything on the way
 * out — any real, uncommitted work sitting in the worktree is simply left
 * behind for discardWorktree to eventually remove. If a role was ACTIVE,
 * this only closes the worktree's own bookkeeping; stopping the real
 * underlying agent run (if it's still alive) is run-manager.js's own
 * responsibility, never this file's.
 * @param {object} args
 * @param {string} args.worktreeId
 * @param {string} args.homeDir
 * @param {string} [args.reason]
 */
export async function cancelWorktree({ worktreeId, homeDir, reason = "Cancelled." }) {
  const worktree = await requireWorktree(homeDir, worktreeId);
  if (worktree.status === WORKTREE_STATES.APPLYING) {
    throw new Error(`Execution worktree "${worktreeId}" is APPLYING; cancelling mid-merge is not supported.`);
  }
  if (isTerminalWorktreeState(worktree.status)) {
    throw new Error(`Execution worktree "${worktreeId}" is already ${worktree.status}; nothing to cancel.`);
  }
  const next = {
    ...worktree, status: WORKTREE_STATES.DISCARDED, activeRole: null, activeRunId: null,
    updatedAt: new Date().toISOString(), error: reason
  };
  await writeWorktreeState(homeDir, next);
  return next;
}

/**
 * Reconciles every real, currently-active execution worktree against the
 * real world — meant to run once when Kairo itself starts, mirroring
 * run-store.js's own reconcileActiveRuns for exactly the same reason: a
 * previous process may have died mid-operation, and nothing here ever
 * guesses what should have happened.
 *
 * - ACTIVE, whose real run is no longer alive (isTerminalRunState says
 *   so, or the run doesn't exist at all): the role's own attempt is
 *   abandoned — INTERRUPTED, no commit is ever fabricated on its behalf.
 * - APPLYING, the one case where a real git mutation may have been
 *   mid-flight when Kairo died:
 *   - the real project's HEAD already equals this worktree's own
 *     controlledHeadSha (the commit that was being merged) AND the real
 *     project tree is clean: the merge had actually already succeeded
 *     before the crash — recovered as APPLIED, the real outcome is never
 *     lost just because Kairo wasn't there to see it finish.
 *   - the real project's HEAD is still exactly baseSha AND clean: the
 *     merge never touched anything — back to READY_FOR_REVIEW; a fresh
 *     preview is required before retrying, never a resumed one.
 *   - anything else (an unexpected HEAD, or a dirty tree): ambiguous —
 *     INTERRUPTED, never guessed at or auto-repaired.
 * - PENDING / READY_FOR_REVIEW are left untouched here: nothing
 *   supervises them while idle, and the real drift checks already built
 *   into beginRoleRun / markReadyForReview / previewWorktreeMerge /
 *   applyWorktreeMerge catch anything wrong with them the moment they're
 *   used again.
 * @param {object} args
 * @param {string} args.homeDir
 * @param {(command: string, args: string[], options: object) => Buffer|string} [args.exec]
 * @param {(homeDir: string, runId: string) => Promise<object|null>} [args.readRun]
 */
export async function reconcileWorktrees({ homeDir, exec = execFileSync, readRun = readRunState }) {
  const records = await listWorktreeRecords(homeDir);
  const reconciled = [];

  for (const worktree of records) {
    if (worktree.status === WORKTREE_STATES.ACTIVE) {
      const runState = worktree.activeRunId ? await readRun(homeDir, worktree.activeRunId) : null;
      if (!runState || isTerminalRunState(runState.state)) {
        const next = await markInterrupted(
          homeDir, worktree,
          `Execution worktree recovered on restart: role "${worktree.activeRole}" run `
          + `"${worktree.activeRunId}" is no longer active.`
        );
        reconciled.push(next);
      }
      continue;
    }

    if (worktree.status === WORKTREE_STATES.APPLYING) {
      let projectHead = null;
      let projectClean = false;
      try {
        projectHead = resolveHead(worktree.projectRoot, { exec });
        assertWorkingTreeClean(worktree.projectRoot, { exec });
        projectClean = true;
      } catch { /* an unreadable or dirty real project falls through to the ambiguous, INTERRUPTED branch below */ }

      let next;
      if (projectClean && projectHead === worktree.controlledHeadSha) {
        next = { ...worktree, status: WORKTREE_STATES.APPLIED, updatedAt: new Date().toISOString() };
        await writeWorktreeState(homeDir, next);
      } else if (projectClean && projectHead === worktree.baseSha) {
        next = { ...worktree, status: WORKTREE_STATES.READY_FOR_REVIEW, updatedAt: new Date().toISOString() };
        await writeWorktreeState(homeDir, next);
      } else {
        next = await markInterrupted(
          homeDir, worktree,
          "Execution worktree recovered on restart: the real project was left in an ambiguous state "
          + "mid-merge — neither the original baseSha nor the expected merged HEAD, or a dirty tree."
        );
      }
      reconciled.push(next);
    }
  }

  return reconciled;
}

/**
 * Removes the real, checked-out git worktree and its own local
 * ~/.harness/worktrees/<id>/ directory entirely — only ever from a
 * terminal state (APPLIED, DISCARDED, INTERRUPTED). A non-terminal
 * worktree still represents real, potentially unreviewed work; abandoning
 * it is cancelWorktree's own job first — this function only ever cleans
 * up what's already been decided. Reuses rollbackWorktree, the same
 * best-effort, idempotent real cleanup createExecutionWorktree's own
 * failure path already relies on.
 * @param {object} args
 * @param {string} args.worktreeId
 * @param {string} args.homeDir
 * @param {(command: string, args: string[], options: object) => Buffer|string} [args.exec]
 */
export async function discardWorktree({ worktreeId, homeDir, exec = execFileSync }) {
  const worktree = await requireWorktree(homeDir, worktreeId);
  if (!isTerminalWorktreeState(worktree.status)) {
    throw new Error(
      `Execution worktree "${worktreeId}" is ${worktree.status}; only a terminal worktree `
      + "(applied, discarded, interrupted) can be cleaned up — cancel it first."
    );
  }
  const { worktreeDir } = worktreePaths(homeDir, worktreeId);
  await rollbackWorktree({ projectRoot: worktree.projectRoot, treePath: worktree.treePath, worktreeDir, exec });
  return worktree;
}
