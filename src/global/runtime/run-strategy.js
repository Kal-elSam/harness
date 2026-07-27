import { stat } from "node:fs/promises";
import {
  RUN_STRATEGIES,
  normalizeRunStrategy,
  createOrchLineage,
  resolveKairoMinionExtensionPath
} from "./orchestration/index.js";

export { RUN_STRATEGIES, normalizeRunStrategy };

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
