import { resolveAdapter } from "./registry.js";
import { ORCHESTRATOR_VERSION } from "./components/orchestrator.js";

const LEGACY_ORCHESTRATOR_COMPONENT = {
  id: "orchestrator",
  version: ORCHESTRATOR_VERSION,
  managedTargets: []
};

export function normalizeGlobalState(state) {
  if (!state) return null;

  const adapters = state.adapters ?? migrateLegacyAgents(state.agents ?? []);
  const components = state.components ?? migrateLegacyComponents(state, adapters);

  return {
    ...state,
    adapters,
    agents: toLegacyAgents(adapters),
    components
  };
}

export function getInstalledAdapterIds(state) {
  const normalized = normalizeGlobalState(state);
  return normalized?.adapters?.map((entry) => entry.id) ?? [];
}

export function getInstalledComponentIds(state) {
  const normalized = normalizeGlobalState(state);
  return normalized?.components?.map((entry) => entry.id) ?? [];
}

function migrateLegacyAgents(agents) {
  return agents.map((entry) => {
    const adapter = resolveAdapter(entry.id);

    return {
      id: adapter.id,
      label: adapter.label,
      rootDir: adapter.assets.rootDir,
      configFile: entry.configFile ?? adapter.assets.configFile,
      managedTargets: [...adapter.assets.managedTargets],
      present: entry.present ?? false
    };
  });
}

function migrateLegacyComponents(state, adapters) {
  if (Array.isArray(state.components)) return state.components;

  const managedTargets = adapters.map((adapter) => adapter.configFile);
  const hasLegacyOrchestrator = Boolean(state.coreFiles?.["core/orchestrator.md"]);

  if (!hasLegacyOrchestrator && managedTargets.length === 0) return [];

  return [{
    ...LEGACY_ORCHESTRATOR_COMPONENT,
    managedTargets
  }];
}

function toLegacyAgents(adapters) {
  return adapters.map(({ id, configFile, present }) => ({ id, configFile, present }));
}
