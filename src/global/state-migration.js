import { resolveAdapter } from "./registry.js";
import { resolveComponent } from "./component-registry.js";
import { normalizeSddState } from "./integrations/sdd-state.js";

export const STATE_VERSION = 4;
export const UNSUPPORTED_STATE_VERSION = "UNSUPPORTED_STATE_VERSION";

const LEGACY_ORCHESTRATOR_COMPONENT = {
  id: "orchestrator",
  version: resolveComponent("orchestrator").version,
  managedTargets: []
};

/** Fail closed on future state versions — never silently downgrade. */
export function assertCompatibleStateVersion(state) {
  const version = state?.stateVersion;
  if (typeof version === "number" && version > STATE_VERSION) {
    const error = new Error(
      `Unsupported stateVersion ${version}; this runtime supports up to ${STATE_VERSION}.`
    );
    error.code = UNSUPPORTED_STATE_VERSION;
    throw error;
  }
}

/** Normalize any compatible v3/v4 (or legacy) state into explicit stateVersion 4. Idempotent for v4. */
export function normalizeGlobalState(state) {
  if (!state) return null;
  assertCompatibleStateVersion(state);

  const adapters = state.adapters ?? migrateLegacyAgents(state.agents ?? []);
  const components = state.components ?? migrateLegacyComponents(state, adapters);

  return {
    ...state,
    stateVersion: STATE_VERSION,
    adapters,
    agents: toLegacyAgents(adapters),
    components,
    sdd: normalizeSddState(state.sdd)
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
