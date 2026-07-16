import { TRANSPORT_KINDS } from "../types.js";
import { fetchJson } from "../http.js";

export async function invokeChatCompletions({
  baseUrl,
  apiKey,
  modelId,
  contextPack,
  request,
  fetchImpl
}) {
  const result = await fetchJson(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: bearerHeaders(apiKey),
    body: {
      model: modelId,
      messages: buildChatMessages(contextPack, request),
      stream: false
    },
    timeoutMs: request.timeoutMs ?? 120000,
    fetchImpl
  });

  if (!result.ok) {
    return {
      ok: false,
      error: redactSecret(result.error ?? "chat completions failed", apiKey)
    };
  }

  const usage = result.data?.usage ?? {};
  return {
    ok: true,
    model: result.data?.model ?? modelId,
    content: result.data?.choices?.[0]?.message?.content ?? "",
    usage: {
      inputTokens: usage.prompt_tokens ?? null,
      outputTokens: usage.completion_tokens ?? null,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
      estimatedCost: null
    },
    raw: result.data
  };
}

export async function invokeResponses({
  baseUrl,
  apiKey,
  modelId,
  contextPack,
  request,
  fetchImpl
}) {
  const result = await fetchJson(`${baseUrl}/responses`, {
    method: "POST",
    headers: bearerHeaders(apiKey),
    body: {
      model: modelId,
      input: buildResponsesInput(contextPack, request)
    },
    timeoutMs: request.timeoutMs ?? 120000,
    fetchImpl
  });

  if (!result.ok) {
    return {
      ok: false,
      error: redactSecret(result.error ?? "responses request failed", apiKey)
    };
  }

  const usage = result.data?.usage ?? {};
  return {
    ok: true,
    model: result.data?.model ?? modelId,
    content: extractResponsesContent(result.data),
    usage: {
      inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
      outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null,
      cachedTokens: usage.input_tokens_details?.cached_tokens ?? null,
      estimatedCost: null
    },
    raw: result.data
  };
}

export function invokeViaTransport(transport, options) {
  if (transport === TRANSPORT_KINDS.RESPONSES) {
    return invokeResponses(options);
  }
  return invokeChatCompletions(options);
}

function bearerHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function redactSecret(message, secret) {
  if (!message || !secret) return message ?? null;
  return String(message).split(String(secret)).join("[REDACTED]");
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

function buildResponsesInput(contextPack, request) {
  const parts = [];
  if (contextPack?.systemPrompt) {
    parts.push({ role: "system", content: contextPack.systemPrompt });
  }
  if (Array.isArray(request.messages) && request.messages.length > 0) {
    parts.push(...request.messages);
  } else if (request.prompt) {
    parts.push({ role: "user", content: request.prompt });
  }
  return parts;
}

function extractResponsesContent(data) {
  if (!data) return "";
  if (typeof data.output_text === "string") return data.output_text;

  if (Array.isArray(data.output)) {
    const texts = [];
    for (const item of data.output) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part?.type === "output_text" && part.text) texts.push(part.text);
          else if (typeof part?.text === "string") texts.push(part.text);
        }
      } else if (typeof item?.text === "string") {
        texts.push(item.text);
      }
    }
    if (texts.length > 0) return texts.join("");
  }

  return data?.choices?.[0]?.message?.content ?? "";
}
