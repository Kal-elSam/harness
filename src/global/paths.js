import { homedir } from "node:os";
import { join } from "node:path";

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
 * Every real path an execution worktree needs — the real checked-out git
 * worktree itself (`treePath`, never the project's own directory) plus its
 * own metadata, all scoped under this one worktreeDir so a single
 * `rm -rf` (see execution-worktree-manager.js's rollback) fully undoes an
 * incomplete creation.
 */
export function worktreePaths(homeDir, worktreeId) {
  const { worktreesDir } = harnessHomePaths(homeDir);
  const worktreeDir = join(worktreesDir, worktreeId);

  return {
    worktreeDir,
    treePath: join(worktreeDir, "tree"),
    statePath: join(worktreeDir, "state.json"),
    checkpointsPath: join(worktreeDir, "checkpoints.jsonl")
  };
}
