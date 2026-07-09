import { buildAdapterContext } from "./adapter-context.js";
import { CAPABILITY_STATES } from "./capability-states.js";
import {
  AGENT_CAPABILITY_IDS,
  listCapabilityAdapters,
  resolveCapabilityAdapter
} from "./agent-capabilities/index.js";

export async function inspectAllCapabilities({
  homeDir,
  workspaceRoot = process.cwd(),
  packageName = "@kal-elsam/kairo-runtime",
  probeOverrides = null
} = {}) {
  const context = buildAdapterContext({ homeDir, workspaceRoot, packageName });
  const adapters = listCapabilityAdapters();

  return Promise.all(adapters.map(async (adapter) => {
    const probeOptions = probeOverrides?.[adapter.id] ?? {};
    const inspection = adapter.inspect(context, probeOptions);
    const models = adapter.listModels?.(context, probeOptions) ?? null;

    return {
      ...inspection,
      models
    };
  }));
}

export async function inspectCapability(agentId, context, probeOptions = {}) {
  const adapter = resolveCapabilityAdapter(agentId);
  const inspection = adapter.inspect(context, probeOptions);
  const models = adapter.listModels?.(context, probeOptions) ?? null;
  return { ...inspection, models };
}

export function summarizeCapabilityRegistry(capabilities) {
  const byState = {};
  for (const state of Object.values(CAPABILITY_STATES)) {
    byState[state] = 0;
  }

  for (const capability of capabilities) {
    if (byState[capability.state] != null) {
      byState[capability.state] += 1;
    }
  }

  return {
    total: capabilities.length,
    supported: AGENT_CAPABILITY_IDS.length,
    detected: capabilities.filter((entry) => entry.detected).length,
    available: capabilities.filter((entry) => entry.state === CAPABILITY_STATES.AVAILABLE).length,
    byState
  };
}

export function buildCapabilityDiagnostics(capabilities) {
  const recommendations = capabilities
    .map((entry) => entry.recommendation)
    .filter(Boolean);

  const errors = capabilities
    .filter((entry) => entry.state === CAPABILITY_STATES.ERROR)
    .map((entry) => ({
      agent: entry.id,
      message: entry.error ?? entry.recommendation ?? "Inspection failed."
    }));

  return {
    recommendations,
    errors,
    hasActionableErrors: errors.length > 0
  };
}

export function delegateToAgent(agentId, context, runOptions = {}) {
  const adapter = resolveCapabilityAdapter(agentId);
  return adapter.run(context, runOptions);
}
