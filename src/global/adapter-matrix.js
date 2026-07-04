import { harnessHomePaths } from "./paths.js";
import { readGlobalState } from "./state.js";
import {
  detectInstalledAdapters,
  isAllAgentsSelection,
  listAdapters
} from "./registry.js";

export async function buildAdapterMatrix(homeDir) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);
  const detected = detectInstalledAdapters({ homeDir });
  const installedAgentIds = new Set((state?.adapters ?? state?.agents ?? []).map((entry) => entry.id));

  return listAdapters().map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    rootDir: adapter.assets.rootDir,
    configFile: adapter.assets.configFile,
    detected: detected.includes(adapter.id),
    managed: installedAgentIds.has(adapter.id),
    managedTargets: [...adapter.assets.managedTargets]
  }));
}

export async function buildAdapterMatrixReport(homeDir) {
  const matrix = await buildAdapterMatrix(homeDir);
  const managedCount = matrix.filter((entry) => entry.managed).length;
  const detectedCount = matrix.filter((entry) => entry.detected).length;

  return {
    homeDir,
    adapters: matrix,
    managedCount,
    detectedCount,
    supportedCount: matrix.length
  };
}
