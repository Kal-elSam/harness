import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeGlobalState } from "./state-migration.js";

export const STATE_VERSION = 2;

export async function readGlobalState(statePath) {
  if (!existsSync(statePath)) return null;

  try {
    const raw = JSON.parse(await readFile(statePath, "utf8"));
    return normalizeGlobalState(raw);
  } catch {
    return null;
  }
}

export async function writeGlobalState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function createGlobalState({ packageName, cliVersion, adapters, coreFiles, backups, installedAt }) {
  const now = new Date().toISOString();
  const normalizedAdapters = adapters.map((entry) => ({ ...entry }));

  return {
    stateVersion: STATE_VERSION,
    packageName,
    cliVersion,
    scope: "agent-global",
    installedAt: installedAt ?? now,
    updatedAt: now,
    adapters: normalizedAdapters,
    agents: normalizedAdapters.map(({ id, configFile, present }) => ({ id, configFile, present })),
    coreFiles,
    backups
  };
}
