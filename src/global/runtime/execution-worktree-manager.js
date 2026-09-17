import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolveHead, resolveWorkingTreeFingerprint, verifyPlanForExecution } from "../architect/architect-store.js";
import { worktreePaths } from "../paths.js";
import { createWorktreeId, EXECUTION_WORKTREE_SCHEMA, WORKTREE_STATES } from "./execution-worktree-types.js";
import { appendCheckpoint, createWorktreeRecord, readWorktreeState, writeWorktreeState } from "./execution-worktree-store.js";
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

  const now = new Date().toISOString();
  const headSha = resolveHead(worktree.treePath, { exec });
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
 * - Terminal but not COMPLETED (FAILED/CANCELLED/INTERRUPTED): the role's
 *   real attempt failed — no commit is ever created for it, and the
 *   worktree moves straight to INTERRUPTED.
 * - COMPLETED: the real success path. The real, current uncommitted
 *   worktree diff is validated exactly like a review snapshot would be
 *   (resolveReviewSnapshot — real path safety, real size/line/file
 *   limits, real symlink/binary/non-regular handling) with one stricter
 *   rule on top: since there is no consent/cockpit surface yet at this
 *   increment to ask a human about a private path, ANY private path
 *   touched here fails the completion outright (INTERRUPTED, no commit)
 *   rather than silently excluding it from what Kairo commits. When
 *   there are real changes, Kairo itself stages and commits them — the
 *   agent never runs `git commit` itself, only ever edits real files.
 *   When there are no real changes at all, no commit is fabricated; the
 *   real "after" checkpoint records the exact same real HEAD as
 *   "before". Either way, the worktree returns to PENDING afterward,
 *   ready for the next role or for markReadyForReview.
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
  if (runState.state !== RUN_STATES.COMPLETED) {
    await markInterrupted(homeDir, worktree, `Role "${role}" run "${runId}" ended in state ${runState.state}.`);
    throw new Error(
      `Role "${role}" run "${runId}" did not complete successfully (state: ${runState.state}) — `
      + `execution worktree "${worktreeId}" moved to INTERRUPTED, no commit created.`
    );
  }

  let snapshot;
  try {
    snapshot = await resolveReviewSnapshot({ cwd: worktree.treePath, execFileImpl });
  } catch (error) {
    await markInterrupted(homeDir, worktree, error.message ?? String(error));
    throw error;
  }
  const privateTouched = snapshot.excluded.filter((entry) => entry.reason === "private");
  if (privateTouched.length > 0) {
    const reason = `Role "${role}" touched private path(s): ${privateTouched.map((e) => e.path).join(", ")}.`;
    await markInterrupted(homeDir, worktree, reason);
    throw new Error(`Cannot complete role run: ${reason} Execution worktree "${worktreeId}" moved to INTERRUPTED, no commit created.`);
  }

  if (snapshot.files.length > 0) {
    exec("git", ["add", "-A"], { cwd: worktree.treePath, stdio: "ignore" });
    exec("git", ["commit", "-qm", `checkpoint(${role}): run ${runId}`], { cwd: worktree.treePath, stdio: "ignore" });
  }

  const now = new Date().toISOString();
  const headSha = resolveHead(worktree.treePath, { exec });
  const fingerprint = resolveWorkingTreeFingerprint(worktree.treePath, { exec });
  await appendCheckpoint(homeDir, worktreeId, {
    worktreeId, role, runId, phase: "after", headSha, fingerprint, timestamp: now
  });

  const next = {
    ...worktree, status: WORKTREE_STATES.PENDING, activeRole: null, activeRunId: null, updatedAt: now
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
 * @param {object} args
 * @param {string} args.worktreeId
 * @param {string} args.homeDir
 */
export async function markReadyForReview({ worktreeId, homeDir }) {
  const worktree = await requireWorktree(homeDir, worktreeId);
  if (worktree.status !== WORKTREE_STATES.PENDING) {
    throw new Error(`Execution worktree "${worktreeId}" is ${worktree.status}; expected PENDING (no active role run) to mark ready for review.`);
  }
  const next = { ...worktree, status: WORKTREE_STATES.READY_FOR_REVIEW, updatedAt: new Date().toISOString() };
  await writeWorktreeState(homeDir, next);
  return next;
}
