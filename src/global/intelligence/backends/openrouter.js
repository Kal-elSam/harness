import {
  BACKEND_IDS,
  COST_CLASSES,
  OPENROUTER_FREE_MODEL,
  PRIVACY_CLASSES,
  createModelDescriptor
} from "../types.js";
import { fetchJson } from "../http.js";
import { CAPABILITY_STATES } from "../../capability-states.js";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export function createOpenRouterBackend({
  fetchImpl = globalThis.fetch,
  env = process.env,
  apiKey = null
} = {}) {
  const resolvedKey = apiKey ?? env.OPENROUTER_API_KEY ?? null;

  return {
    id: BACKEND_IDS.OPENROUTER,
    label: "OpenRouter",
    local: false,

    async detect() {
      if (!resolvedKey) {
        return {
          id: BACKEND_IDS.OPENROUTER,
          label: "OpenRouter",
          state: CAPABILITY_STATES.UNKNOWN,
          detected: false,
          available: false,
          hasApiKey: false,
          error: null,
          recommendation: "Set OPENROUTER_API_KEY in the environment to enable OpenRouter (never stored by Kairo)."
        };
      }

      return {
        id: BACKEND_IDS.OPENROUTER,
        label: "OpenRouter",
        state: CAPABILITY_STATES.AUTHENTICATED,
        detected: true,
        available: true,
        hasApiKey: true,
        error: null,
        recommendation: "OpenRouter API key detected in environment. Cloud use still requires explicit consent."
      };
    },

    async listModels({ freeOnly = true } = {}) {
      if (!resolvedKey) return [];

      const result = await fetchJson(`${OPENROUTER_BASE}/models`, {
        headers: {
          Authorization: `Bearer ${resolvedKey}`,
          "Content-Type": "application/json"
        },
        fetchImpl
      });

      if (!result.ok) {
        return [
          createModelDescriptor({
            provider: BACKEND_IDS.OPENROUTER,
            modelId: OPENROUTER_FREE_MODEL,
            local: false,
            costClass: COST_CLASSES.FREE,
            privacyClass: PRIVACY_CLASSES.CLOUD,
            opaque: true
          })
        ];
      }

      const models = Array.isArray(result.data?.data) ? result.data.data : [];
      const mapped = models
        .filter((entry) => {
          if (!freeOnly) return true;
          const id = entry.id ?? "";
          return id.endsWith(":free") || id === OPENROUTER_FREE_MODEL;
        })
        .map((entry) => createModelDescriptor({
          provider: BACKEND_IDS.OPENROUTER,
          modelId: entry.id,
          local: false,
          costClass: COST_CLASSES.FREE,
          privacyClass: PRIVACY_CLASSES.CLOUD,
          contextLimit: entry.context_length ?? null,
          tools: Boolean(entry.supported_parameters?.includes?.("tools")),
          reasoning: false
        }));

      if (!mapped.some((entry) => entry.modelId === OPENROUTER_FREE_MODEL)) {
        mapped.unshift(createModelDescriptor({
          provider: BACKEND_IDS.OPENROUTER,
          modelId: OPENROUTER_FREE_MODEL,
          local: false,
          costClass: COST_CLASSES.FREE,
          privacyClass: PRIVACY_CLASSES.CLOUD,
          opaque: true
        }));
      }

      return mapped;
    },

    async capabilities() {
      const detection = await this.detect();
      return {
        id: BACKEND_IDS.OPENROUTER,
        local: false,
        cloud: true,
        requiresApiKey: true,
        requiresConsent: true,
        streaming: true,
        tools: true,
        freeRouterModel: OPENROUTER_FREE_MODEL,
        state: detection.state,
        hasApiKey: Boolean(resolvedKey)
      };
    },

    async invoke(contextPack, request = {}) {
      if (!resolvedKey) {
        return invokeError("OPENROUTER_API_KEY is not set. Kairo never stores credentials.");
      }

      const modelId = request.modelId ?? OPENROUTER_FREE_MODEL;
      const messages = buildChatMessages(contextPack, request);

      const result = await fetchJson(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resolvedKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/Kal-elSam/harness",
          "X-OpenRouter-Title": "Kairo Runtime"
        },
        body: {
          model: modelId,
          messages,
          stream: false
        },
        timeoutMs: request.timeoutMs ?? 120000,
        fetchImpl
      });

      if (!result.ok) {
        return invokeError(result.error ?? "OpenRouter chat failed.");
      }

      const content = result.data?.choices?.[0]?.message?.content ?? "";
      const usedModel = result.data?.model ?? modelId;
      const usage = result.data?.usage ?? {};

      return {
        ok: true,
        backendId: BACKEND_IDS.OPENROUTER,
        model: usedModel,
        content,
        usage: {
          inputTokens: usage.prompt_tokens ?? null,
          outputTokens: usage.completion_tokens ?? null,
          cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
          estimatedCost: null,
          model: usedModel,
          backendId: BACKEND_IDS.OPENROUTER,
          fallbackUsed: usedModel !== modelId
        },
        raw: result.data
      };
    }
  };
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
    backendId: BACKEND_IDS.OPENROUTER,
    model: null,
    content: null,
    error: message,
    usage: null
  };
}
