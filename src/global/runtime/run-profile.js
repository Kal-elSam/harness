import { resolveProfileAgents } from "../profile.js";
import { EXECUTION_ADAPTER_IDS } from "./execution-adapters/index.js";

export function resolveRuntimeOptions(profileResolved, overrides = {}) {
  const profile = profileResolved?.profile ?? profileResolved ?? {};
  const agentAliases = profile.agentAliases ?? {};
  const modelAliases = profile.modelAliases ?? {};

  let agentId = overrides.agentId ?? profile.defaultRuntimeAgent ?? null;
  if (agentId && agentAliases[agentId]) {
    agentId = agentAliases[agentId];
  }

  let model = overrides.model ?? profile.preferredModel ?? profile.defaultRuntimeModel ?? null;
  if (model && modelAliases[model]) {
    model = modelAliases[model];
  }

  const permissions = overrides.permissions
    ?? profile.defaultPermissions
    ?? [];

  const captureTranscript = overrides.captureTranscript
    ?? profile.captureTranscript
    ?? false;

  return {
    agentId,
    model,
    permissions: Array.isArray(permissions) ? permissions : [],
    captureTranscript: captureTranscript === true
  };
}

export function validateRuntimeProfile(profile) {
  const agentAliases = profile.agentAliases;
  if (agentAliases != null) {
    if (typeof agentAliases !== "object" || Array.isArray(agentAliases)) {
      throw new Error("Profile agentAliases must be an object.");
    }
    for (const target of Object.values(agentAliases)) {
      if (!EXECUTION_ADAPTER_IDS.includes(target)) {
        throw new Error(`Unknown agent alias target "${target}".`);
      }
    }
  }

  const modelAliases = profile.modelAliases;
  if (modelAliases != null) {
    if (typeof modelAliases !== "object" || Array.isArray(modelAliases)) {
      throw new Error("Profile modelAliases must be an object.");
    }
  }

  const defaultPermissions = profile.defaultPermissions;
  if (defaultPermissions != null && !Array.isArray(defaultPermissions)) {
    throw new Error("Profile defaultPermissions must be an array.");
  }

  if (
    profile.defaultRuntimeAgent != null
    && !EXECUTION_ADAPTER_IDS.includes(profile.defaultRuntimeAgent)
    && !Object.keys(agentAliases ?? {}).includes(profile.defaultRuntimeAgent)
  ) {
    throw new Error(`Unknown defaultRuntimeAgent "${profile.defaultRuntimeAgent}".`);
  }

  if (profile.captureTranscript != null && typeof profile.captureTranscript !== "boolean") {
    throw new Error("Profile captureTranscript must be a boolean.");
  }
}

export function resolveAgentFromProfile(profileResolved, requestedAgent) {
  const runtime = resolveRuntimeOptions(profileResolved, { agentId: requestedAgent });
  if (!runtime.agentId) {
    throw new Error(`Unknown or missing agent. Use ${EXECUTION_ADAPTER_IDS.join(", ")}.`);
  }
  if (!EXECUTION_ADAPTER_IDS.includes(runtime.agentId)) {
    throw new Error(`Agent "${runtime.agentId}" is not supported for Kairo runs.`);
  }
  return runtime;
}

export const RUNTIME_PROFILE_KEYS = new Set([
  "agentAliases",
  "modelAliases",
  "defaultPermissions",
  "defaultRuntimeAgent",
  "defaultRuntimeModel",
  "captureTranscript"
]);

export const SUPPORTED_RUN_AGENTS = [...EXECUTION_ADAPTER_IDS];
