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
    coreDir: join(root, "core"),
    backupsDir: join(root, "backups")
  };
}
