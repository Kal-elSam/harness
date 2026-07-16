import { OPENCODE_API_KEY_ENV } from "../types.js";
import {
  isDirectTransport,
  normalizeModelId,
  resolveOpencodeTransport,
  toRuntimeModelRef
} from "../transport-registry.js";
import { invokeViaTransport } from "./opencode-http.js";
import { resolveOpencodeApiKey, redactSecret } from "./opencode-catalog.js";

/**
 * Compose direct HTTP invoke onto an OpenCode catalog backend.
 * No Go→Zen fallback here — routing owns that policy.
 */
export function withOpencodeDirectInvoke(catalog, {
  env = process.env,
  apiKey = null,
  fetchImpl = globalThis.fetch,
  defaultModelId = null
} = {}) {
  const resolvedKey = resolveOpencodeApiKey({ env, apiKey });
  const { id, label, product, baseUrl } = catalog;

  return {
    ...catalog,

    async invoke(contextPack, request = {}) {
      if (!resolvedKey) {
        return invokeError(id, `${OPENCODE_API_KEY_ENV} is not set. Kairo never stores credentials.`);
      }

      const modelId = normalizeModelId(request.modelId) ?? defaultModelId;
      const transport = resolveOpencodeTransport(product, modelId);

      if (!isDirectTransport(transport)) {
        const runtimeRef = toRuntimeModelRef(product, modelId) ?? modelId;
        return invokeError(
          id,
          `Model ${modelId} has no direct ${label} transport. Use --backend opencode --model ${runtimeRef} with OpenCode CLI installed and authenticated.`,
          modelId
        );
      }

      const result = await invokeViaTransport(transport, {
        baseUrl,
        apiKey: resolvedKey,
        modelId,
        contextPack,
        request,
        fetchImpl
      });

      if (!result.ok) {
        return invokeError(id, redactSecret(result.error, resolvedKey), modelId);
      }

      return {
        ok: true,
        backendId: id,
        model: result.model,
        content: result.content,
        usage: {
          ...result.usage,
          model: result.model,
          backendId: id,
          fallbackUsed: false
        },
        raw: result.raw
      };
    }
  };
}

function invokeError(backendId, message, model = null) {
  return {
    ok: false,
    backendId,
    model,
    content: null,
    error: message,
    usage: null
  };
}
