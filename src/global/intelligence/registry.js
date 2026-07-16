import { BACKEND_IDS } from "./types.js";
import { createOllamaBackend } from "./backends/ollama.js";
import { createOpenRouterBackend } from "./backends/openrouter.js";
import { createCustomHttpBackend } from "./backends/custom-http.js";
import {
  createOpencodeGoBackend,
  createOpencodeZenBackend
} from "./backends/opencode-providers.js";
import { createOpencodeRuntimeBackend } from "./backends/opencode-runtime.js";
import { collectOpencodeCliEvidence } from "./backends/opencode-evidence.js";
import { CAPABILITY_STATES } from "../capability-states.js";

export function createDefaultBackends({
  env = process.env,
  fetchImpl = globalThis.fetch,
  customProviders = [],
  whichImpl,
  collectCliEvidence,
  spawnImpl
} = {}) {
  const sharedCliEvidence = createSharedCliEvidenceCollector({
    env,
    whichImpl,
    collectCliEvidence
  });

  const backends = [
    createOllamaBackend({ env, fetchImpl }),
    createOpencodeGoBackend({ env, fetchImpl, collectCliEvidence: sharedCliEvidence }),
    createOpencodeZenBackend({ env, fetchImpl, collectCliEvidence: sharedCliEvidence }),
    createOpenRouterBackend({ env, fetchImpl }),
    createOpencodeRuntimeBackend({
      env,
      whichImpl,
      spawnImpl,
      collectCliEvidence: sharedCliEvidence
    })
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
  backends = null,
  whichImpl,
  collectCliEvidence,
  spawnImpl
} = {}) {
  const resolved = backends ?? createDefaultBackends({
    env,
    fetchImpl,
    customProviders,
    whichImpl,
    collectCliEvidence,
    spawnImpl
  });
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

  const go = inspections.find((entry) => entry.id === BACKEND_IDS.OPENCODE_GO);
  const zen = inspections.find((entry) => entry.id === BACKEND_IDS.OPENCODE_ZEN);
  const openrouter = inspections.find((entry) => entry.id === BACKEND_IDS.OPENROUTER);

  return {
    total: inspections.length,
    available: inspections.filter((entry) => entry.available).length,
    localAvailable: inspections.some(
      (entry) => entry.id === BACKEND_IDS.OLLAMA && entry.available
    ),
    cloudConfigured: Boolean(go?.configured || zen?.configured || openrouter?.hasApiKey),
    /** OpenRouter stays key-based; Go/Zen use proven authenticated evidence. */
    cloudAuthenticated: Boolean(
      go?.authenticated || zen?.authenticated || openrouter?.hasApiKey
    ),
    opencodeGoConfigured: Boolean(go?.configured),
    opencodeZenConfigured: Boolean(zen?.configured),
    opencodeGoAuthenticated: Boolean(go?.authenticated),
    opencodeZenAuthenticated: Boolean(zen?.authenticated),
    byState
  };
}

export function resolveBackendById(backends, backendId) {
  return backends.find((backend) => backend.id === backendId) ?? null;
}

function createSharedCliEvidenceCollector({
  env,
  whichImpl,
  collectCliEvidence
}) {
  let cached = null;
  const collector = collectCliEvidence ?? collectOpencodeCliEvidence;
  return () => {
    if (!cached) cached = collector({ env, whichImpl });
    return cached;
  };
}
