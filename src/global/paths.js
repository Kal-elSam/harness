import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

export const HARNESS_DIR_NAME = ".harness";

export function resolveHomeDir(env = process.env) {
  return env.HARNESS_HOME ?? homedir();
}

export function harnessHomePaths(homeDir) {
  const root = join(homeDir, HARNESS_DIR_NAME);

  return {
    homeDir,
    root,
    statePath: join(root, "state.json"),
    policyPath: join(root, "policy.json"),
    profilePath: join(root, "profile.json"),
    historyPath: join(root, "history.jsonl"),
    runsDir: join(root, "runs"),
    reviewsDir: join(root, "reviews"),
    alertsDir: join(root, "alerts"),
    monitorDir: join(root, "monitor"),
    monitorStatePath: join(root, "monitor", "state.json"),
    coreDir: join(root, "core"),
    backupsDir: join(root, "backups"),
    sessionsDir: join(root, "sessions"),
    worktreesDir: join(root, "worktrees"),
    usageDir: join(root, "usage"),
    modelIntelligencePath: join(root, "model-intelligence.json"),
    huggingfaceLeaderboardPath: join(root, "huggingface-leaderboard.json")
  };
}

export function runPaths(homeDir, runId) {
  const { runsDir } = harnessHomePaths(homeDir);
  const runDir = join(runsDir, runId);

  return {
    runDir,
    statePath: join(runDir, "state.json"),
    eventsPath: join(runDir, "events.jsonl"),
    transcriptPath: join(runDir, "transcript.jsonl")
  };
}

/**
 * The exact shape createWorktreeId() (execution-worktree-types.js)
 * produces — `wt_` plus two base36 segments. Enforced here, at the one
 * real boundary every worktree path gets built from, rather than trusted
 * by each caller separately: an unvalidated id (e.g. "../../escape")
 * would otherwise let `join()` resolve outside worktreesDir entirely.
 */
export function assertWorktreeId(worktreeId) {
  if (typeof worktreeId !== "string" || !/^wt_[a-z0-9]{1,20}_[a-z0-9]{1,20}$/.test(worktreeId)) {
    throw new Error(`Invalid worktree id "${worktreeId ?? ""}".`);
  }
  return worktreeId;
}

/**
 * Every real path an execution worktree needs — the real checked-out git
 * worktree itself (`treePath`, never the project's own directory) plus its
 * own metadata, all scoped under this one worktreeDir so a single
 * `rm -rf` (see execution-worktree-manager.js's rollback) fully undoes an
 * incomplete creation. `worktreeId` is validated here, the one real
 * boundary every consumer of this function goes through — never trusted
 * or re-validated ad hoc by callers.
 */
export function worktreePaths(homeDir, worktreeId) {
  assertWorktreeId(worktreeId);
  const { worktreesDir } = harnessHomePaths(homeDir);
  const worktreeDir = join(worktreesDir, worktreeId);
  // Defense in depth alongside the regex above — the same real containment
  // check architect-store.js's taskPaths already applies to task ids.
  const rel = relative(worktreesDir, worktreeDir);
  const isInside = rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../");
  if (!isInside) {
    throw new Error(`Worktree path escapes worktreesDir for id "${worktreeId}".`);
  }

  return {
    worktreeDir,
    treePath: join(worktreeDir, "tree"),
    statePath: join(worktreeDir, "state.json"),
    checkpointsPath: join(worktreeDir, "checkpoints.jsonl")
  };
}
