import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeGlobalState, STATE_VERSION, UNSUPPORTED_STATE_VERSION } from "./state-migration.js";
import { normalizeSddState } from "./integrations/sdd-state.js";

export { STATE_VERSION, UNSUPPORTED_STATE_VERSION };

export async function readGlobalState(statePath) {
  if (!existsSync(statePath)) return null;

  try {
    const raw = JSON.parse(await readFile(statePath, "utf8"));
    return normalizeGlobalState(raw);
  } catch (error) {
    if (error?.code === UNSUPPORTED_STATE_VERSION) throw error;
    return null;
  }
}

export async function writeGlobalState(statePath, state) {
  const normalized = normalizeGlobalState(state) ?? state;
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function createGlobalState({
  packageName,
  cliVersion,
  adapters,
  components = [],
  coreFiles,
  backups,
  installedAt,
  sdd
}) {
  const now = new Date().toISOString();
  const normalizedAdapters = adapters.map((entry) => ({ ...entry }));
  const normalizedComponents = components.map((entry) => ({ ...entry }));

  return normalizeGlobalState({
    stateVersion: STATE_VERSION,
    packageName,
    cliVersion,
    scope: "agent-global",
    installedAt: installedAt ?? now,
    updatedAt: now,
    adapters: normalizedAdapters,
    agents: normalizedAdapters.map(({ id, configFile, present }) => ({ id, configFile, present })),
    components: normalizedComponents,
    coreFiles,
    backups,
    sdd: normalizeSddState(sdd)
  });
}
