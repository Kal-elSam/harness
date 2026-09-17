import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { readTaskRecord, resolveHead, resolveWorkingTreeFingerprint } from "../architect/architect-store.js";
import { PLAN_STATES } from "../architect/architect-types.js";
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
 * is still APPROVED and its baseSha still matches the project's real
 * current HEAD (the same staleness check verifyPlanForExecution already
 * performs, reused here rather than re-derived), and that the project's
 * own working tree is clean, before ever touching git. Any failure after
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
  const record = await readTaskRecord(projectRoot, taskId);
  if (!record) throw new Error(`Plan "${taskId}" not found.`);
  if (record.status.state !== PLAN_STATES.APPROVED) {
    throw new Error(`Plan "${taskId}" is ${record.status.state}; explicit approval is required before creating an execution worktree.`);
  }
  const currentHead = resolveHead(projectRoot, { exec });
  if (currentHead !== record.status.baseHead) {
    throw new Error(`Plan "${taskId}" is stale: repository HEAD changed since approval.`);
  }
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
