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
    coreDir: join(root, "core"),
    backupsDir: join(root, "backups")
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
