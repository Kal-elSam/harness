import { TRANSPORT_KINDS } from "./types.js";

/**
 * Explicit transport compatibility for OpenCode Go / Zen.
 * Never infer protocol from model name — only this registry decides.
 */

const GO_DIRECT = {
  "glm-5.2": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "glm-5.1": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "kimi-k2.7-code": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "kimi-k2.6": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "deepseek-v4-pro": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "deepseek-v4-flash": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "mimo-v2.5": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "mimo-v2.5-pro": TRANSPORT_KINDS.CHAT_COMPLETIONS
};

const GO_RUNTIME = {
  "minimax-m3": TRANSPORT_KINDS.RUNTIME,
  "minimax-m2.7": TRANSPORT_KINDS.RUNTIME,
  "minimax-m2.5": TRANSPORT_KINDS.RUNTIME,
  "qwen3.7-max": TRANSPORT_KINDS.RUNTIME,
  "qwen3.7-plus": TRANSPORT_KINDS.RUNTIME,
  "qwen3.6-plus": TRANSPORT_KINDS.RUNTIME
};

const ZEN_RESPONSES = {
  "gpt-5.6-sol": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.6-terra": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.6-luna": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.5": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.5-pro": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.4": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.4-pro": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.4-mini": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.4-nano": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.3-codex": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.3-codex-spark": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.2": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.2-codex": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.1": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.1-codex": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.1-codex-max": TRANSPORT_KINDS.RESPONSES,
  "gpt-5.1-codex-mini": TRANSPORT_KINDS.RESPONSES,
  "gpt-5": TRANSPORT_KINDS.RESPONSES,
  "gpt-5-codex": TRANSPORT_KINDS.RESPONSES,
  "gpt-5-nano": TRANSPORT_KINDS.RESPONSES
};

const ZEN_CHAT = {
  "deepseek-v4-pro": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "deepseek-v4-flash": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "minimax-m3": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "minimax-m2.7": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "minimax-m2.5": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "glm-5.2": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "glm-5.1": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "glm-5": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "kimi-k2.5": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "kimi-k2.6": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "kimi-k2.7-code": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "grok-4.5": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "grok-build-0.1": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "big-pickle": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "mimo-v2.5-free": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "north-mini-code-free": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "nemotron-3-ultra-free": TRANSPORT_KINDS.CHAT_COMPLETIONS,
  "deepseek-v4-flash-free": TRANSPORT_KINDS.CHAT_COMPLETIONS
};

const ZEN_RUNTIME = {
  "claude-fable-5": TRANSPORT_KINDS.RUNTIME,
  "claude-opus-4-8": TRANSPORT_KINDS.RUNTIME,
  "claude-opus-4-7": TRANSPORT_KINDS.RUNTIME,
  "claude-opus-4-6": TRANSPORT_KINDS.RUNTIME,
  "claude-opus-4-5": TRANSPORT_KINDS.RUNTIME,
  "claude-sonnet-5": TRANSPORT_KINDS.RUNTIME,
  "claude-sonnet-4-6": TRANSPORT_KINDS.RUNTIME,
  "claude-sonnet-4-5": TRANSPORT_KINDS.RUNTIME,
  "claude-haiku-4-5": TRANSPORT_KINDS.RUNTIME,
  "gemini-3.5-flash": TRANSPORT_KINDS.RUNTIME,
  "gemini-3.1-pro": TRANSPORT_KINDS.RUNTIME,
  "gemini-3-flash": TRANSPORT_KINDS.RUNTIME,
  "qwen3.7-max": TRANSPORT_KINDS.RUNTIME,
  "qwen3.7-plus": TRANSPORT_KINDS.RUNTIME,
  "qwen3.6-plus": TRANSPORT_KINDS.RUNTIME,
  "qwen3.5-plus": TRANSPORT_KINDS.RUNTIME
};

export const OPENCODE_GO_TRANSPORTS = Object.freeze({ ...GO_DIRECT, ...GO_RUNTIME });
export const OPENCODE_ZEN_TRANSPORTS = Object.freeze({
  ...ZEN_RESPONSES,
  ...ZEN_CHAT,
  ...ZEN_RUNTIME
});

export function resolveOpencodeTransport(product, modelId) {
  const id = normalizeModelId(modelId);
  if (!id) return null;
  if (product === "go") return OPENCODE_GO_TRANSPORTS[id] ?? null;
  if (product === "zen") return OPENCODE_ZEN_TRANSPORTS[id] ?? null;
  return null;
}

export function isDirectTransport(transport) {
  return transport === TRANSPORT_KINDS.CHAT_COMPLETIONS
    || transport === TRANSPORT_KINDS.RESPONSES;
}

export function listRegisteredModelIds(product, { directOnly = false, runtimeOnly = false } = {}) {
  const table = product === "go" ? OPENCODE_GO_TRANSPORTS : OPENCODE_ZEN_TRANSPORTS;
  return Object.entries(table)
    .filter(([, transport]) => {
      if (directOnly) return isDirectTransport(transport);
      if (runtimeOnly) return transport === TRANSPORT_KINDS.RUNTIME;
      return true;
    })
    .map(([modelId]) => modelId);
}

export function normalizeModelId(modelId) {
  if (!modelId) return null;
  const raw = String(modelId).trim();
  if (!raw) return null;
  const slash = raw.lastIndexOf("/");
  return slash >= 0 ? raw.slice(slash + 1) : raw;
}

export function toRuntimeModelRef(product, modelId) {
  const id = normalizeModelId(modelId);
  if (!id) return null;
  return product === "go" ? `opencode-go/${id}` : `opencode/${id}`;
}

export function resolveRuntimeProduct(modelId) {
  const raw = String(modelId ?? "");
  if (raw.startsWith("opencode-go/")) return "go";
  if (raw.startsWith("opencode/")) return "zen";
  if (OPENCODE_GO_TRANSPORTS[normalizeModelId(raw)] === TRANSPORT_KINDS.RUNTIME) {
    return OPENCODE_ZEN_TRANSPORTS[normalizeModelId(raw)] === TRANSPORT_KINDS.RUNTIME
      ? "zen"
      : "go";
  }
  if (OPENCODE_ZEN_TRANSPORTS[normalizeModelId(raw)] === TRANSPORT_KINDS.RUNTIME) return "zen";
  return null;
}
