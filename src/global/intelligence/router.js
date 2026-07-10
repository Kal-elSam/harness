import {
  BACKEND_IDS,
  OPENROUTER_FREE_MODEL,
  PRIVACY_CLASSES,
  ROUTING_MODES,
  createRoutingDecision
} from "./types.js";
import { estimateTokens } from "./context-compiler.js";

const TASK_WEIGHTS = {
  architecture: "heavy",
  security: "heavy",
  review: "heavy",
  diagnose: "light",
  explain: "light",
  scaffold: "light",
  test: "light",
  default: "light"
};

export function classifyTaskWeight(task = "") {
  const text = String(task).toLowerCase();
  if (/architect|adr|design system|security|threat/.test(text)) return "heavy";
  if (/review|refactor complex|debug complex/.test(text)) return "heavy";
  if (/test|scaffold|explain|status|diagnose|lint|format/.test(text)) return "light";
  return TASK_WEIGHTS.default;
}

/**
 * Resolve which backend/model to use.
 * Precedence: user override > Ollama local > OpenRouter free (consent) > diagnostics.
 */
export function resolveRoutingDecision({
  backends = [],
  profile = {},
  contextPack = null,
  task = null,
  cloudConsent = false,
  tokenBudget = null
} = {}) {
  const estimatedTokens = contextPack?.estimatedTokens
    ?? estimateTokens(contextPack?.systemPrompt ?? "")
    + estimateTokens(task ?? "");

  const budget = tokenBudget ?? profile.tokenBudget ?? null;
  if (budget != null && estimatedTokens > budget) {
    return createRoutingDecision({
      backendId: null,
      model: null,
      reason: `Estimated tokens (${estimatedTokens}) exceed budget (${budget}). Compact context or raise tokenBudget.`,
      estimatedTokens,
      privacyImpact: PRIVACY_CLASSES.UNKNOWN,
      mode: ROUTING_MODES.DIAGNOSTICS,
      requiresCloudConsent: false,
      canInvoke: false
    });
  }

  const override = resolveUserOverride(profile, backends);
  if (override) {
    return createRoutingDecision({
      backendId: override.backend.id,
      model: override.model,
      reason: `User override: ${override.backend.id}/${override.model.modelId}`,
      estimatedTokens,
      privacyImpact: override.model.privacyClass,
      mode: ROUTING_MODES.USER_OVERRIDE,
      requiresCloudConsent: !override.model.local,
      canInvoke: override.model.local || cloudConsent,
      fallback: buildLocalFallback(backends)
    });
  }

  const ollama = backends.find((entry) => entry.id === BACKEND_IDS.OLLAMA);
  if (ollama?.available && Array.isArray(ollama.models) && ollama.models.length > 0) {
    const model = selectLocalModel(ollama.models, task);
    return createRoutingDecision({
      backendId: BACKEND_IDS.OLLAMA,
      model,
      reason: `Local-first: Ollama model ${model.modelId}`,
      estimatedTokens,
      privacyImpact: PRIVACY_CLASSES.LOCAL,
      mode: ROUTING_MODES.LOCAL,
      requiresCloudConsent: false,
      canInvoke: true,
      fallback: buildCloudFallback(backends, cloudConsent)
    });
  }

  const openrouter = backends.find((entry) => entry.id === BACKEND_IDS.OPENROUTER);
  if (openrouter?.hasApiKey) {
    const model = openrouter.models?.find((entry) => entry.modelId === OPENROUTER_FREE_MODEL)
      ?? openrouter.models?.[0]
      ?? {
        provider: BACKEND_IDS.OPENROUTER,
        modelId: OPENROUTER_FREE_MODEL,
        local: false,
        privacyClass: PRIVACY_CLASSES.CLOUD,
        costClass: "free",
        opaque: true
      };

    return createRoutingDecision({
      backendId: BACKEND_IDS.OPENROUTER,
      model,
      reason: cloudConsent
        ? `Cloud fallback approved: ${model.modelId}`
        : `OpenRouter available (${model.modelId}) but cloud consent required before invoke`,
      estimatedTokens,
      privacyImpact: PRIVACY_CLASSES.CLOUD,
      mode: ROUTING_MODES.CLOUD_CONSENT,
      requiresCloudConsent: true,
      canInvoke: cloudConsent,
      fallback: null
    });
  }

  return createRoutingDecision({
    backendId: null,
    model: null,
    reason: "No intelligence backend available. Remaining in diagnostics/configuration mode.",
    estimatedTokens,
    privacyImpact: PRIVACY_CLASSES.UNKNOWN,
    mode: ROUTING_MODES.DIAGNOSTICS,
    requiresCloudConsent: false,
    canInvoke: false
  });
}

function resolveUserOverride(profile, backends) {
  const preferredBackend = profile.preferredBackend ?? null;
  const preferredModel = profile.preferredModel ?? null;
  if (!preferredBackend && !preferredModel) return null;

  if (preferredBackend) {
    const backend = backends.find((entry) => entry.id === preferredBackend);
    if (!backend || (!backend.available && !backend.hasApiKey && !backend.detected)) {
      return null;
    }
    const model = (backend.models ?? []).find((entry) => entry.modelId === preferredModel)
      ?? backend.models?.[0]
      ?? (preferredModel
        ? {
          provider: preferredBackend,
          modelId: preferredModel,
          local: backend.id === BACKEND_IDS.OLLAMA,
          privacyClass: backend.id === BACKEND_IDS.OLLAMA ? PRIVACY_CLASSES.LOCAL : PRIVACY_CLASSES.CLOUD,
          costClass: "unknown",
          opaque: true
        }
        : null);
    if (!model) return null;
    return { backend, model };
  }

  if (preferredModel) {
    for (const backend of backends) {
      const model = (backend.models ?? []).find((entry) => entry.modelId === preferredModel);
      if (model) return { backend, model };
    }
  }

  return null;
}

function selectLocalModel(models, task) {
  const weight = classifyTaskWeight(task);
  if (weight === "heavy" && models.length > 1) {
    return [...models].sort((a, b) => String(b.modelId).localeCompare(String(a.modelId)))[0];
  }
  return models[0];
}

function buildLocalFallback(backends) {
  const ollama = backends.find((entry) => entry.id === BACKEND_IDS.OLLAMA && entry.available);
  if (!ollama?.models?.length) return null;
  return {
    backendId: BACKEND_IDS.OLLAMA,
    modelId: ollama.models[0].modelId
  };
}

function buildCloudFallback(backends, cloudConsent) {
  const openrouter = backends.find((entry) => entry.id === BACKEND_IDS.OPENROUTER && entry.hasApiKey);
  if (!openrouter) return null;
  return {
    backendId: BACKEND_IDS.OPENROUTER,
    modelId: OPENROUTER_FREE_MODEL,
    requiresConsent: !cloudConsent
  };
}
