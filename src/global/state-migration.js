import { resolveAdapter } from "./registry.js";

export function normalizeGlobalState(state) {
  if (!state) return null;

  const adapters = state.adapters ?? migrateLegacyAgents(state.agents ?? []);

  return {
    ...state,
    adapters,
    agents: toLegacyAgents(adapters)
  };
}

export function getInstalledAdapterIds(state) {
  const normalized = normalizeGlobalState(state);
  return normalized?.adapters?.map((entry) => entry.id) ?? [];
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

function toLegacyAgents(adapters) {
  return adapters.map(({ id, configFile, present }) => ({ id, configFile, present }));
}
