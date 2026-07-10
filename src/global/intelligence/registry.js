import { BACKEND_IDS } from "./types.js";
import { createOllamaBackend } from "./backends/ollama.js";
import { createOpenRouterBackend } from "./backends/openrouter.js";
import { createCustomHttpBackend } from "./backends/custom-http.js";
import { CAPABILITY_STATES } from "../capability-states.js";

export function createDefaultBackends({
  env = process.env,
  fetchImpl = globalThis.fetch,
  customProviders = []
} = {}) {
  const backends = [
    createOllamaBackend({ env, fetchImpl }),
    createOpenRouterBackend({ env, fetchImpl })
  ];

  for (const provider of customProviders) {
    backends.push(createCustomHttpBackend({
      ...provider,
      env,
      fetchImpl
    }));
  }

  return backends;
}

export async function inspectIntelligenceBackends({
  env = process.env,
  fetchImpl = globalThis.fetch,
  customProviders = [],
  backends = null
} = {}) {
  const resolved = backends ?? createDefaultBackends({ env, fetchImpl, customProviders });
  return Promise.all(resolved.map(async (backend) => {
    const detection = await backend.detect();
    const models = detection.detected || detection.available
      ? await backend.listModels()
      : [];
    const capabilities = await backend.capabilities();

    return {
      ...detection,
      models,
      capabilities
    };
  }));
}

export function summarizeIntelligenceBackends(inspections) {
  const byState = {};
  for (const state of Object.values(CAPABILITY_STATES)) {
    byState[state] = 0;
  }

  for (const entry of inspections) {
    if (byState[entry.state] != null) {
      byState[entry.state] += 1;
    }
  }

  return {
    total: inspections.length,
    available: inspections.filter((entry) => entry.available).length,
    localAvailable: inspections.some(
      (entry) => entry.id === BACKEND_IDS.OLLAMA && entry.available
    ),
    cloudAuthenticated: inspections.some(
      (entry) => entry.id === BACKEND_IDS.OPENROUTER && entry.hasApiKey
    ),
    byState
  };
}

export function resolveBackendById(backends, backendId) {
  return backends.find((backend) => backend.id === backendId) ?? null;
}
