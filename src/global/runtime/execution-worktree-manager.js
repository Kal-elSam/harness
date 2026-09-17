import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolveHead, resolveWorkingTreeFingerprint, verifyPlanForExecution } from "../architect/architect-store.js";
import { worktreePaths } from "../paths.js";
import { createWorktreeId, EXECUTION_WORKTREE_SCHEMA, WORKTREE_STATES } from "./execution-worktree-types.js";
import { createWorktreeRecord } from "./execution-worktree-store.js";

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
