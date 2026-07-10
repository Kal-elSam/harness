import {
  BACKEND_IDS,
  COST_CLASSES,
  DEFAULT_OLLAMA_HOST,
  PRIVACY_CLASSES,
  createModelDescriptor
} from "../types.js";
import { fetchJson } from "../http.js";
import { CAPABILITY_STATES } from "../../capability-states.js";

export function createOllamaBackend({
  host = null,
  fetchImpl = globalThis.fetch,
  env = process.env
} = {}) {
  const baseUrl = normalizeOllamaHost(host ?? env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST);

  return {
    id: BACKEND_IDS.OLLAMA,
    label: "Ollama",
    local: true,

    async detect() {
      const result = await fetchJson(`${baseUrl}/api/tags`, {
        timeoutMs: 2000,
        fetchImpl
      });

      if (!result.ok) {
        return {
          id: BACKEND_IDS.OLLAMA,
          label: "Ollama",
          state: CAPABILITY_STATES.UNKNOWN,
          detected: false,
          available: false,
          host: baseUrl,
          error: result.error,
          recommendation: `Start Ollama locally (${DEFAULT_OLLAMA_HOST}) or set OLLAMA_HOST.`
        };
      }

      const models = parseOllamaModels(result.data);
      return {
        id: BACKEND_IDS.OLLAMA,
        label: "Ollama",
        state: models.length > 0 ? CAPABILITY_STATES.AVAILABLE : CAPABILITY_STATES.DETECTED,
        detected: true,
        available: models.length > 0,
        host: baseUrl,
        modelCount: models.length,
        error: null,
        recommendation: models.length > 0
          ? `Ollama ready with ${models.length} local model(s).`
          : "Ollama is running but no models are pulled yet."
      };
    },

    async listModels() {
      const result = await fetchJson(`${baseUrl}/api/tags`, { fetchImpl });
      if (!result.ok) return [];
      return parseOllamaModels(result.data);
    },

    async capabilities() {
      const detection = await this.detect();
      return {
        id: BACKEND_IDS.OLLAMA,
        local: true,
        cloud: false,
        requiresApiKey: false,
        requiresConsent: false,
        streaming: true,
        tools: false,
        state: detection.state,
        host: baseUrl
      };
    },

    async invoke(contextPack, request = {}) {
      const modelId = request.modelId;
      if (!modelId) {
        return invokeError("Ollama invoke requires modelId.");
      }

      const messages = buildChatMessages(contextPack, request);
      const result = await fetchJson(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          model: modelId,
          messages,
          stream: false,
          options: request.options ?? undefined
        },
        timeoutMs: request.timeoutMs ?? 120000,
        fetchImpl
      });

      if (!result.ok) {
        return invokeError(result.error ?? "Ollama chat failed.");
      }

      const content = result.data?.message?.content ?? "";
      return {
        ok: true,
        backendId: BACKEND_IDS.OLLAMA,
        model: modelId,
        content,
        usage: {
          inputTokens: result.data?.prompt_eval_count ?? null,
          outputTokens: result.data?.eval_count ?? null,
          cachedTokens: null,
          estimatedCost: 0,
          model: modelId,
          backendId: BACKEND_IDS.OLLAMA,
          fallbackUsed: false
        },
        raw: result.data
      };
    }
  };
}

function parseOllamaModels(data) {
  const models = Array.isArray(data?.models) ? data.models : [];
  return models.map((entry) => createModelDescriptor({
    provider: BACKEND_IDS.OLLAMA,
    modelId: entry.name ?? entry.model,
    local: true,
    costClass: COST_CLASSES.LOCAL,
    privacyClass: PRIVACY_CLASSES.LOCAL,
    contextLimit: null,
    tools: false,
    reasoning: false
  })).filter((entry) => Boolean(entry.modelId));
}

function normalizeOllamaHost(host) {
  return String(host).replace(/\/+$/, "");
}

function buildChatMessages(contextPack, request) {
  const messages = [];
  if (contextPack?.systemPrompt) {
    messages.push({ role: "system", content: contextPack.systemPrompt });
  }
  if (Array.isArray(request.messages) && request.messages.length > 0) {
    messages.push(...request.messages);
  } else if (request.prompt) {
    messages.push({ role: "user", content: request.prompt });
  }
  return messages;
}

function invokeError(message) {
  return {
    ok: false,
    backendId: BACKEND_IDS.OLLAMA,
    model: null,
    content: null,
    error: message,
    usage: null
  };
}
