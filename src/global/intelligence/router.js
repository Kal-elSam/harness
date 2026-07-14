import {
  BACKEND_IDS,
  OPENCODE_GO_DEFAULT_MODEL,
  OPENCODE_ZEN_DEFAULT_FREE_MODEL,
  OPENROUTER_FREE_MODEL,
  PRIVACY_CLASSES,
  ROUTING_MODES,
  createRoutingDecision
} from "./types.js";
import { estimateTokens } from "./context-compiler.js";

export function classifyTaskWeight(task = "") {
  const text = String(task).toLowerCase();
  if (/architect|adr|design system|security|threat/.test(text)) return "heavy";
  if (/review|refactor complex|debug complex/.test(text)) return "heavy";
  if (/test|scaffold|explain|status|diagnose|lint|format/.test(text)) return "light";
  return "light";
}

/** Precedence: CLI → profile → Ollama → Go → Zen → OpenRouter → diagnostics. Go has no Zen invoke fallback. */
export function resolveRoutingDecision({
  backends = [],
  profile = {},
  contextPack = null,
  task = null,
  cloudConsent = false,
  tokenBudget = null,
  sessionOverride = null
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

  const effectiveProfile = applySessionOverride(profile, sessionOverride);
  const override = resolveUserOverride(effectiveProfile, backends, sessionOverride);
  if (override) {
    return createRoutingDecision({
      backendId: override.backend.id,
      model: override.model,
      reason: override.source === "cli"
        ? `CLI override: ${override.backend.id}/${override.model.modelId}`
        : `User override: ${override.backend.id}/${override.model.modelId}`,
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

  const go = backends.find((entry) => entry.id === BACKEND_IDS.OPENCODE_GO);
  if (go?.hasApiKey) {
    const model = selectOpencodeModel(go.models, OPENCODE_GO_DEFAULT_MODEL, BACKEND_IDS.OPENCODE_GO);
    return createRoutingDecision({
      backendId: BACKEND_IDS.OPENCODE_GO,
      model,
      reason: cloudConsent
        ? `OpenCode Go approved: ${model.modelId}`
        : `OpenCode Go available (${model.modelId}) but cloud consent required before invoke`,
      estimatedTokens,
      privacyImpact: PRIVACY_CLASSES.CLOUD,
      mode: ROUTING_MODES.CLOUD_CONSENT,
      requiresCloudConsent: true,
      canInvoke: cloudConsent,
      fallback: null
    });
  }

  const zen = backends.find((entry) => entry.id === BACKEND_IDS.OPENCODE_ZEN);
  if (zen?.hasApiKey) {
    const model = selectOpencodeModel(zen.models, OPENCODE_ZEN_DEFAULT_FREE_MODEL, BACKEND_IDS.OPENCODE_ZEN);
    return createRoutingDecision({
      backendId: BACKEND_IDS.OPENCODE_ZEN,
      model,
      reason: cloudConsent
        ? `OpenCode Zen approved: ${model.modelId}`
        : `OpenCode Zen available (${model.modelId}) but cloud consent required before invoke`,
      estimatedTokens,
      privacyImpact: PRIVACY_CLASSES.CLOUD,
      mode: ROUTING_MODES.CLOUD_CONSENT,
      requiresCloudConsent: true,
      canInvoke: cloudConsent,
      fallback: buildOpenRouterFallback(backends, cloudConsent)
    });
  }

  const openrouter = backends.find((entry) => entry.id === BACKEND_IDS.OPENROUTER);
  if (openrouter?.hasApiKey) {
    const model = openrouter.models?.find((entry) => entry.modelId === OPENROUTER_FREE_MODEL)
      ?? openrouter.models?.[0]
      ?? opaqueCloudModel(BACKEND_IDS.OPENROUTER, OPENROUTER_FREE_MODEL, "free");

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

function applySessionOverride(profile, sessionOverride) {
  if (!sessionOverride) return profile;
  return {
    ...profile,
    preferredBackend: sessionOverride.preferredBackend ?? profile.preferredBackend,
    preferredModel: sessionOverride.preferredModel ?? profile.preferredModel
  };
}

function resolveUserOverride(profile, backends, sessionOverride) {
  const preferredBackend = profile.preferredBackend ?? null;
  const preferredModel = profile.preferredModel ?? null;
  if (!preferredBackend && !preferredModel) return null;

  const source = sessionOverride?.preferredBackend || sessionOverride?.preferredModel
    ? "cli"
    : "profile";

  if (preferredBackend) {
    const backend = backends.find((entry) => entry.id === preferredBackend);
    if (!backend || (!backend.available && !backend.hasApiKey && !backend.detected)) {
      return null;
    }
    const model = (backend.models ?? []).find((entry) => entry.modelId === preferredModel)
      ?? backend.models?.[0]
      ?? (preferredModel
        ? opaqueOverrideModel(preferredBackend, preferredModel, backend)
        : null);
    if (!model) return null;
    return { backend, model, source };
  }

  if (preferredModel) {
    for (const backend of backends) {
      const model = (backend.models ?? []).find((entry) => entry.modelId === preferredModel);
      if (model) return { backend, model, source };
    }
  }

  return null;
}

function opaqueOverrideModel(preferredBackend, preferredModel, backend) {
  const isLocal = backend.id === BACKEND_IDS.OLLAMA;
  return {
    provider: preferredBackend,
    modelId: preferredModel,
    local: isLocal,
    privacyClass: isLocal ? PRIVACY_CLASSES.LOCAL : PRIVACY_CLASSES.CLOUD,
    costClass: "unknown",
    opaque: true
  };
}

function opaqueCloudModel(provider, modelId, costClass) {
  return {
    provider,
    modelId,
    local: false,
    privacyClass: PRIVACY_CLASSES.CLOUD,
    costClass,
    opaque: true
  };
}

function selectLocalModel(models, task) {
  const weight = classifyTaskWeight(task);
  if (weight === "heavy" && models.length > 1) {
    return [...models].sort((a, b) => String(b.modelId).localeCompare(String(a.modelId)))[0];
  }
  return models[0];
}

function selectOpencodeModel(models, preferredId, provider) {
  const list = Array.isArray(models) ? models : [];
  return list.find((entry) => entry.modelId === preferredId)
    ?? list.find((entry) => entry.costClass === "free")
    ?? list[0]
    ?? opaqueCloudModel(provider, preferredId, provider === BACKEND_IDS.OPENCODE_GO ? "paid" : "unknown");
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
  const go = backends.find((entry) => entry.id === BACKEND_IDS.OPENCODE_GO && entry.hasApiKey);
  if (go) {
    return {
      backendId: BACKEND_IDS.OPENCODE_GO,
      modelId: go.models?.[0]?.modelId ?? OPENCODE_GO_DEFAULT_MODEL,
      requiresConsent: !cloudConsent
    };
  }
  return buildOpenRouterFallback(backends, cloudConsent);
}

function buildOpenRouterFallback(backends, cloudConsent) {
  const openrouter = backends.find((entry) => entry.id === BACKEND_IDS.OPENROUTER && entry.hasApiKey);
  if (!openrouter) return null;
  return {
    backendId: BACKEND_IDS.OPENROUTER,
    modelId: OPENROUTER_FREE_MODEL,
    requiresConsent: !cloudConsent
  };
}
