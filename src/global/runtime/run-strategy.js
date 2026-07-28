import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RUN_STRATEGIES,
  normalizeRunStrategy,
  createOrchLineage,
  resolveKairoMinionExtensionPath
} from "./orchestration/index.js";

export { RUN_STRATEGIES, normalizeRunStrategy };

const ORCH_MODULE_PATH = join(dirname(fileURLToPath(import.meta.url)), "orchestration", "index.js");

export const ORCH_RUNTIME_ENV = Object.freeze({
  HOME: "KAIRO_ORCH_HOME",
  ROOT_RUN_ID: "KAIRO_ORCH_ROOT_RUN_ID",
  ROOT_TASK_ID: "KAIRO_ORCH_ROOT_TASK_ID",
  CLI_VERSION: "KAIRO_ORCH_CLI_VERSION",
  MODULE: "KAIRO_ORCH_MODULE"
});

/** Reject orchestrated for non-Pi before any run I/O. */
export function assertOrchestratedAgent(agentId, strategy) {
  const normalized = normalizeRunStrategy(strategy);
  if (normalized === RUN_STRATEGIES.ORCHESTRATED && agentId !== "pi") {
    throw new Error(
      `Strategy "orchestrated" requires agent "pi" (got "${agentId}").`
    );
  }
  return normalized;
}

/** Fail closed when managed extension is missing or not a regular file. */
export async function assertManagedMinionExtension(homeDir) {
  const extensionPath = resolveKairoMinionExtensionPath(homeDir);
  let info;
  try {
    info = await stat(extensionPath);
  } catch {
    throw new Error(`Managed Kairo minion extension missing: ${extensionPath}`);
  }
  if (!info.isFile()) {
    throw new Error(`Managed Kairo minion extension is not a regular file: ${extensionPath}`);
  }
  return extensionPath;
}

export function createRootRunLineage(runId) {
  return createOrchLineage({ rootRunId: runId, parentRunId: null, depth: 0 });
}

/** Supervisor derives extension path from homeDir only — never from CLI/handoff. */
export function resolveOrchestratedExtensionPath(homeDir, strategy) {
  if (normalizeRunStrategy(strategy) !== RUN_STRATEGIES.ORCHESTRATED) return null;
  return resolveKairoMinionExtensionPath(homeDir);
}

export function buildOrchestratedRuntimeEnv({
  homeDir, rootRunId, rootTaskId, cliVersion = null,
  strategy = RUN_STRATEGIES.DIRECT, baseEnv = process.env
} = {}) {
  const env = { ...baseEnv };
  if (normalizeRunStrategy(strategy) !== RUN_STRATEGIES.ORCHESTRATED) return env;
  env[ORCH_RUNTIME_ENV.HOME] = homeDir;
  env[ORCH_RUNTIME_ENV.ROOT_RUN_ID] = rootRunId;
  env[ORCH_RUNTIME_ENV.ROOT_TASK_ID] = rootTaskId;
  env[ORCH_RUNTIME_ENV.CLI_VERSION] = cliVersion == null ? "" : String(cliVersion);
  env[ORCH_RUNTIME_ENV.MODULE] = ORCH_MODULE_PATH;
  return env;
}
