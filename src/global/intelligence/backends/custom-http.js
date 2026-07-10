import {
  BACKEND_IDS,
  COST_CLASSES,
  PRIVACY_CLASSES,
  createModelDescriptor
} from "../types.js";
import { fetchJson } from "../http.js";
import { CAPABILITY_STATES } from "../../capability-states.js";
import { classifyCustomBaseUrl, isValidEnvironmentName } from "../custom-url.js";

/**
 * OpenAI-compatible HTTP backend. API keys are read from env by name only —
 * never from profile JSON or disk.
 */
export function createCustomHttpBackend({
  id = BACKEND_IDS.CUSTOM,
  label = "Custom provider",
  baseUrl,
  modelId,
  apiKeyEnv = null,
  local: _local = false,
  fetchImpl = globalThis.fetch,
  env = process.env
} = {}) {
  if (!baseUrl) {
    throw new Error("Custom HTTP backend requires baseUrl.");
  }

  const location = classifyCustomBaseUrl(baseUrl);
  const normalizedBase = location.normalizedBaseUrl;
  if (apiKeyEnv != null && !isValidEnvironmentName(apiKeyEnv)) {
    throw new Error("Custom provider apiKeyEnv must be a valid uppercase environment variable name.");
  }
  if (apiKeyEnv && !location.local) {
    throw new Error(
      "Remote custom providers cannot use apiKeyEnv in 0.2.0; use a built-in provider or a local endpoint."
    );
  }
  const apiKey = apiKeyEnv ? (env[apiKeyEnv] ?? null) : null;

  return {
    id,
    label,
    local: location.local,

    async detect() {
      if (apiKeyEnv && !apiKey) {
        return {
          id,
          label,
          state: CAPABILITY_STATES.UNKNOWN,
          detected: false,
          available: false,
          hasApiKey: false,
          error: null,
          recommendation: `Set ${apiKeyEnv} in the environment. Kairo never stores credentials.`
        };
      }

      return {
        id,
        label,
        state: CAPABILITY_STATES.DETECTED,
        detected: true,
        available: Boolean(modelId),
        hasApiKey: apiKeyEnv ? Boolean(apiKey) : null,
        error: null,
        recommendation: modelId
          ? `Custom provider configured (${modelId}).`
          : "Custom provider baseUrl set; configure modelId in profile."
      };
    },

    async listModels() {
      if (!modelId) return [];
      return [
        createModelDescriptor({
          provider: id,
          modelId,
          local: location.local,
          costClass: location.local ? COST_CLASSES.LOCAL : COST_CLASSES.UNKNOWN,
          privacyClass: location.local ? PRIVACY_CLASSES.LOCAL : PRIVACY_CLASSES.CLOUD,
          opaque: true
        })
      ];
    },

    async capabilities() {
      const detection = await this.detect();
      return {
        id,
        local: location.local,
        cloud: !location.local,
        requiresApiKey: Boolean(apiKeyEnv),
        requiresConsent: !location.local,
        streaming: false,
        tools: false,
        state: detection.state,
        baseUrl: normalizedBase,
        modelId
      };
    },

    async invoke(contextPack, request = {}) {
      if (apiKeyEnv && !apiKey) {
        return invokeError(id, `Missing ${apiKeyEnv}. Kairo never stores credentials.`);
      }

      const resolvedModel = request.modelId ?? modelId;
      if (!resolvedModel) {
        return invokeError(id, "Custom invoke requires modelId.");
      }

      const messages = [];
      if (contextPack?.systemPrompt) {
        messages.push({ role: "system", content: contextPack.systemPrompt });
      }
      if (Array.isArray(request.messages) && request.messages.length > 0) {
        messages.push(...request.messages);
      } else if (request.prompt) {
        messages.push({ role: "user", content: request.prompt });
      }

      const headers = { "Content-Type": "application/json" };
      if (apiKey && location.credentialSafe) headers.Authorization = `Bearer ${apiKey}`;

      const result = await fetchJson(`${normalizedBase}/chat/completions`, {
        method: "POST",
        headers,
        body: {
          model: resolvedModel,
          messages,
          stream: false
        },
        timeoutMs: request.timeoutMs ?? 120000,
        fetchImpl
      });

      if (!result.ok) {
        return invokeError(id, result.error ?? "Custom provider chat failed.");
      }

      const content = result.data?.choices?.[0]?.message?.content ?? "";
      const usage = result.data?.usage ?? {};

      return {
        ok: true,
        backendId: id,
        model: resolvedModel,
        content,
        usage: {
          inputTokens: usage.prompt_tokens ?? null,
          outputTokens: usage.completion_tokens ?? null,
          cachedTokens: null,
          estimatedCost: null,
          model: resolvedModel,
          backendId: id,
          fallbackUsed: false
        },
        raw: result.data
      };
    }
  };
}

function invokeError(backendId, message) {
  return {
    ok: false,
    backendId,
    model: null,
    content: null,
    error: message,
    usage: null
  };
}
