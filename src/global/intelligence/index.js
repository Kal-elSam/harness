export {
  BACKEND_IDS,
  COST_CLASSES,
  PRIVACY_CLASSES,
  ROUTING_MODES,
  OPENROUTER_FREE_MODEL,
  DEFAULT_OLLAMA_HOST,
  createModelDescriptor,
  createRoutingDecision,
  createUsageTelemetry
} from "./types.js";

export { createOllamaBackend } from "./backends/ollama.js";
export { createOpenRouterBackend } from "./backends/openrouter.js";
export { createCustomHttpBackend } from "./backends/custom-http.js";

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
  classifyTaskWeight
} from "./router.js";

export {
  runIntelligenceRequest,
  explainRouting
} from "./orchestrate.js";
