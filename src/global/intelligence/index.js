export {
  BACKEND_IDS,
  COST_CLASSES,
  PRIVACY_CLASSES,
  ROUTING_MODES,
  TRANSPORT_KINDS,
  OPENROUTER_FREE_MODEL,
  OPENCODE_API_KEY_ENV,
  OPENCODE_GO_BASE_URL,
  OPENCODE_ZEN_BASE_URL,
  OPENCODE_GO_DEFAULT_MODEL,
  OPENCODE_ZEN_DEFAULT_FREE_MODEL,
  DEFAULT_OLLAMA_HOST,
  createModelDescriptor,
  createRoutingDecision,
  createUsageTelemetry
} from "./types.js";

export {
  resolveOpencodeTransport,
  isDirectTransport,
  listRegisteredModelIds,
  normalizeModelId,
  toRuntimeModelRef,
  resolveRuntimeProduct,
  OPENCODE_GO_TRANSPORTS,
  OPENCODE_ZEN_TRANSPORTS
} from "./transport-registry.js";

export {
  ENTITLEMENT_STATES,
  BILLING_MODELS,
  parseAuthListProviders,
  collectOpencodeCliEvidence
} from "./backends/opencode-evidence.js";

export { createOllamaBackend } from "./backends/ollama.js";
export { createOpenRouterBackend } from "./backends/openrouter.js";
export { createCustomHttpBackend } from "./backends/custom-http.js";
export {
  createOpencodeGoBackend,
  createOpencodeZenBackend
} from "./backends/opencode-providers.js";

export { createOpencodeRuntimeBackend } from "./backends/opencode-runtime.js";

export {
  runOpencodeJson,
  parseOpencodeJsonEvents
} from "./backends/opencode-cli.js";

export {
  createDefaultBackends,
  inspectIntelligenceBackends,
  summarizeIntelligenceBackends,
  resolveBackendById
} from "./registry.js";

export {
  compileContextPack,
  isPrivatePath,
  estimateTokens
} from "./context-compiler.js";

export {
  resolveRoutingDecision,
  classifyTaskWeight,
  isDirectProviderEligible
} from "./router.js";

export {
  runIntelligenceRequest,
  explainRouting
} from "./orchestrate.js";
