export const BACKEND_IDS = {
  OLLAMA: "ollama",
  OPENROUTER: "openrouter",
  OPENCODE_GO: "opencode-go",
  OPENCODE_ZEN: "opencode-zen",
  OPENCODE: "opencode",
  CUSTOM: "custom"
};

export const TRANSPORT_KINDS = {
  CHAT_COMPLETIONS: "chat_completions",
  RESPONSES: "responses",
  RUNTIME: "runtime"
};

export const OPENCODE_API_KEY_ENV = "OPENCODE_API_KEY";

export const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";

export const OPENCODE_GO_DEFAULT_MODEL = "kimi-k2.7-code";
export const OPENCODE_ZEN_DEFAULT_FREE_MODEL = "big-pickle";

export const COST_CLASSES = {
  FREE: "free",
  LOCAL: "local",
  PAID: "paid",
  UNKNOWN: "unknown"
};

export const PRIVACY_CLASSES = {
  LOCAL: "local",
  CLOUD: "cloud",
  UNKNOWN: "unknown"
};

export const ROUTING_MODES = {
  DIAGNOSTICS: "diagnostics",
  LOCAL: "local",
  CLOUD_CONSENT: "cloud_consent",
  USER_OVERRIDE: "user_override"
};

export const OPENROUTER_FREE_MODEL = "openrouter/free";

export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

export function createModelDescriptor({
  provider,
  modelId,
  local = false,
  costClass = COST_CLASSES.UNKNOWN,
  privacyClass = PRIVACY_CLASSES.UNKNOWN,
  contextLimit = null,
  tools = false,
  reasoning = false,
  rateLimits = null,
  opaque = false,
  transport = null
}) {
  return {
    provider,
    modelId,
    local,
    costClass,
    privacyClass,
    contextLimit,
    tools,
    reasoning,
    rateLimits,
    opaque,
    transport
  };
}

export function createRoutingDecision({
  backendId,
  model,
  reason,
  estimatedTokens = null,
  privacyImpact = PRIVACY_CLASSES.UNKNOWN,
  fallback = null,
  mode = ROUTING_MODES.DIAGNOSTICS,
  requiresCloudConsent = false,
  canInvoke = false
}) {
  return {
    backendId,
    model,
    reason,
    estimatedTokens,
    privacyImpact,
    fallback,
    mode,
    requiresCloudConsent,
    canInvoke
  };
}

export function createUsageTelemetry({
  inputTokens = null,
  outputTokens = null,
  cachedTokens = null,
  estimatedCost = null,
  model = null,
  backendId = null,
  fallbackUsed = false
} = {}) {
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    estimatedCost,
    model,
    backendId,
    fallbackUsed
  };
}
