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

/** Direct Go/Zen HTTP is eligible only with key + proven auth + available. */
export function isDirectProviderEligible(backend) {
  return Boolean(backend?.hasApiKey && backend?.authenticated && backend?.available);
}

function diagnosticsDecision(reason, estimatedTokens) {
  return createRoutingDecision({
    backendId: null,
    model: null,
    reason,
    estimatedTokens,
    privacyImpact: PRIVACY_CLASSES.UNKNOWN,
    mode: ROUTING_MODES.DIAGNOSTICS,
    requiresCloudConsent: false,
    canInvoke: false,
    fallback: null
  });
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
    return diagnosticsDecision(
      `Estimated tokens (${estimatedTokens}) exceed budget (${budget}). Compact context or raise tokenBudget.`,
      estimatedTokens
    );
  }

  const effectiveProfile = applySessionOverride(profile, sessionOverride);
  const override = resolveUserOverride(effectiveProfile, backends, sessionOverride);
  if (override?.ineligible) {
    return diagnosticsDecision(override.reason, estimatedTokens);
  }
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
    if (!isDirectProviderEligible(go)) {
      return diagnosticsDecision(
        describeIneligibleCloudStop(go, "OpenCode Go", "Zen/OpenRouter"),
        estimatedTokens
      );
    }
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
  if (isDirectProviderEligible(zen)) {
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
  if (zen?.configured) {
    return diagnosticsDecision(
      describeIneligibleCloudStop(zen, "OpenCode Zen", "OpenRouter"),
      estimatedTokens
    );
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

  return diagnosticsDecision(
    "No intelligence backend available. Remaining in diagnostics/configuration mode.",
    estimatedTokens
  );
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
  const label = source === "cli" ? "CLI" : "User";
  const reject = (reason) => ({
    ineligible: true,
    reason: `${reason} Remaining in diagnostics; automatic routing was not applied.`
  });

  if (preferredBackend) {
    const backend = backends.find((entry) => entry.id === preferredBackend) ?? null;
    if (!isOverrideEligible(backend)) {
      return reject(`${label} override ${preferredBackend} is not eligible for invoke.`);
    }
    const model = (backend.models ?? []).find((entry) => entry.modelId === preferredModel)
      ?? backend.models?.[0]
      ?? (preferredModel
        ? opaqueOverrideModel(preferredBackend, preferredModel, backend)
        : null);
    if (!model) return reject(`${label} override ${preferredBackend} has no usable model.`);
    return { backend, model, source };
  }

  for (const backend of backends) {
    const model = (backend.models ?? []).find((entry) => entry.modelId === preferredModel);
    if (!model) continue;
    if (!isOverrideEligible(backend)) {
      return reject(
        `${label} override model ${preferredModel} resolved to ineligible backend ${backend.id}.`
      );
    }
    return { backend, model, source };
  }
  return reject(`${label} override model ${preferredModel} was not found.`);
}

/** Runtime is exempt from /models auth; Go/Zen require proven authentication. */
function isOverrideEligible(backend) {
  if (!backend) return false;
  if (backend.id === BACKEND_IDS.OPENCODE) return Boolean(backend.available || backend.detected);
  if (backend.id === BACKEND_IDS.OLLAMA) return Boolean(backend.available);
  if (backend.id === BACKEND_IDS.OPENCODE_GO || backend.id === BACKEND_IDS.OPENCODE_ZEN) {
    return isDirectProviderEligible(backend);
  }
  if (backend.id === BACKEND_IDS.OPENROUTER) return Boolean(backend.hasApiKey);
  return Boolean(backend.available || backend.hasApiKey || backend.detected);
}

function describeIneligibleCloudStop(backend, label, blockedFallback) {
  const detail = backend?.error
    ?? backend?.recommendation
    ?? "configured but not authenticated/available";
  return `${label} ${detail}. Invoke blocked (canInvoke=false); ${blockedFallback} fallback suppressed.`;
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
  const go = backends.find((entry) => entry.id === BACKEND_IDS.OPENCODE_GO);
  if (isDirectProviderEligible(go)) {
    return {
      backendId: BACKEND_IDS.OPENCODE_GO,
      modelId: go.models?.[0]?.modelId ?? OPENCODE_GO_DEFAULT_MODEL,
      requiresConsent: !cloudConsent
    };
  }
  if (go?.hasApiKey) return null;
  const zen = backends.find((entry) => entry.id === BACKEND_IDS.OPENCODE_ZEN);
  if (zen?.configured && !isDirectProviderEligible(zen)) return null;
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
