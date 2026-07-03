import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const STATE_VERSION = 1;

export async function readGlobalState(statePath) {
  if (!existsSync(statePath)) return null;

  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

export async function writeGlobalState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function createGlobalState({ packageName, cliVersion, agents, coreFiles, backups, installedAt }) {
  const now = new Date().toISOString();

  return {
    stateVersion: STATE_VERSION,
    packageName,
    cliVersion,
    scope: "agent-global",
    installedAt: installedAt ?? now,
    updatedAt: now,
    agents,
    coreFiles,
    backups
  };
}
