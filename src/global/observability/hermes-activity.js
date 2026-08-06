import { fetchJson } from "../intelligence/http.js";

export const DEFAULT_HERMES_API_URL = "http://127.0.0.1:8642";
export const HERMES_ACTIVITY_LIMIT_DEFAULT = 20;
export const HERMES_ACTIVITY_LIMIT_MAX = 50;
export const HERMES_ACTIVITY_TIMEOUT_MS = 2000;
export const HERMES_ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function emptyAgg() {
  return { returnedCount: 0, activeCount: 0, endedCount: 0, hasMore: false, lastActiveAt: null };
}
function out(partial) {
  return { state: "error", error: null, diagnostics: [], baseUrl: null, sessions: [], aggregates: emptyAgg(), ...partial };
}
function opaque(state, diagnostics, baseUrl = null) {
  return out({ state, error: state, diagnostics: diagnostics.map(String), baseUrl });
}

/** Loopback HTTP(S) only — no embedded credentials. */
export function assertHermesLoopbackUrl(raw) {
  try {
    const url = new URL(String(raw ?? ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "protocol" };
    if (url.username || url.password) return { ok: false, reason: "credentials" };
    if (!LOOPBACK.has(url.hostname.replace(/^\[|\]$/g, ""))) return { ok: false, reason: "not_loopback" };
    return { ok: true, url: url.origin };
  } catch { return { ok: false, reason: "invalid_url" }; }
}

function clampLimit(limit) {
  const n = Number(limit);
  return Number.isFinite(n)
    ? Math.min(HERMES_ACTIVITY_LIMIT_MAX, Math.max(1, Math.trunc(n)))
    : HERMES_ACTIVITY_LIMIT_DEFAULT;
}

async function hermesGet(url, { apiKey, timeoutMs, fetchImpl }) {
  const headers = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const wrapped = (input, init = {}) => fetchImpl(input, { ...init, method: "GET", redirect: "error" });
  return fetchJson(url, { method: "GET", headers, timeoutMs, fetchImpl: wrapped });
}

function classifyTransport(res) {
  if (res?.status === 401 || res?.status === 403) return "auth_required";
  if (res?.status >= 500 || res?.error === "request timed out") return "error";
  if (res?.status === 0) return /timed?\s*out|abort/.test(String(res.error ?? "")) ? "error" : "unavailable";
  return null;
}

function isJson(data) {
  return data != null && typeof data === "object" && !Array.isArray(data) && !("raw" in data);
}

/** Upstream: features.session_resources + endpoints.sessions {method,path}. */
export function capabilitiesAdvertiseSessionsList(caps) {
  if (caps?.features?.session_resources !== true) return false;
  const ep = caps?.endpoints?.sessions;
  if (ep == null || typeof ep !== "object" || Array.isArray(ep)) return false;
  return String(ep.method).toUpperCase() === "GET" && ep.path === "/api/sessions";
}

function parseTs(value) {
  if (value == null) return { ok: true, ms: null };
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false };
  const ms = value > 1e12 ? value : value * 1000;
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return { ok: false };
  return { ok: true, ms };
}
function countOrZero(value) {
  if (value == null) return { ok: true, n: 0 };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return { ok: false };
  return { ok: true, n: value };
}
function optString(value) {
  if (value == null) return { ok: true, s: null };
  return typeof value === "string" ? { ok: true, s: value } : { ok: false };
}

/** Official session row. Null on bad shape/types (no coercion). */
export function normalizeHermesSession(raw, { nowMs = Date.now() } = {}) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  const started = parseTs(raw.started_at), ended = parseTs(raw.ended_at), lastActive = parseTs(raw.last_active);
  if (!started.ok || !ended.ok || !lastActive.ok) return null;
  const messageCount = countOrZero(raw.message_count), toolCallCount = countOrZero(raw.tool_call_count);
  const inputTokens = countOrZero(raw.input_tokens), outputTokens = countOrZero(raw.output_tokens);
  if (!messageCount.ok || !toolCallCount.ok || !inputTokens.ok || !outputTokens.ok) return null;
  const source = optString(raw.source), model = optString(raw.model);
  const title = optString(raw.title), endReason = optString(raw.end_reason);
  if (!source.ok || !model.ok || !title.ok || !endReason.ok) return null;
  const lastActiveMs = lastActive.ms ?? ended.ms ?? started.ms;
  const isEnded = ended.ms != null || (endReason.s != null && endReason.s.length > 0);
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
  return {
    id: raw.id, source: source.s, model: model.s, title: title.s,
    startedAt: iso(started.ms), endedAt: iso(ended.ms), lastActiveAt: iso(lastActiveMs),
    messageCount: messageCount.n, toolCallCount: toolCallCount.n,
    tokenCount: inputTokens.n + outputTokens.n,
    active: !isEnded && lastActiveMs != null && (nowMs - lastActiveMs) <= HERMES_ACTIVE_WINDOW_MS
  };
}

/**
 * Read-only Hermes session activity via official local API.
 * Sequence: GET /v1/capabilities → GET /api/sessions (never CLI / state.db).
 */
export async function loadHermesActivity({
  env = process.env,
  baseUrl = env.KAIRO_HERMES_API_URL ?? DEFAULT_HERMES_API_URL,
  apiKey = env.KAIRO_HERMES_API_KEY ?? null,
  limit = HERMES_ACTIVITY_LIMIT_DEFAULT,
  timeoutMs = HERMES_ACTIVITY_TIMEOUT_MS,
  nowMs = Date.now(),
  fetchImpl = globalThis.fetch
} = {}) {
  const checked = assertHermesLoopbackUrl(baseUrl);
  if (!checked.ok) return opaque("incompatible", [`hermes baseUrl rejected: ${checked.reason}`]);
  const origin = checked.url;
  const capped = clampLimit(limit);
  const key = apiKey ? String(apiKey) : null;

  const capsRes = await hermesGet(`${origin}/v1/capabilities`, { apiKey: key, timeoutMs, fetchImpl });
  const capsFail = classifyTransport(capsRes);
  if (capsFail) return opaque(capsFail, [`hermes capabilities ${capsFail}`], origin);
  if (!capsRes.ok || !isJson(capsRes.data)
    || capsRes.data.platform !== "hermes-agent"
    || !capabilitiesAdvertiseSessionsList(capsRes.data)) {
    return opaque("incompatible", ["hermes session capabilities unsupported"], origin);
  }

  const qs = new URLSearchParams({ limit: String(capped), offset: "0", include_children: "false" });
  const sessionsRes = await hermesGet(`${origin}/api/sessions?${qs}`, { apiKey: key, timeoutMs, fetchImpl });
  const sessFail = classifyTransport(sessionsRes);
  if (sessFail) return opaque(sessFail, [`hermes sessions ${sessFail}`], origin);
  if (!sessionsRes.ok) return opaque("error", [`hermes sessions http ${sessionsRes.status}`], origin);
  const payload = sessionsRes.data;
  if (!isJson(payload) || payload.object !== "list" || !Array.isArray(payload.data)) {
    return opaque("incompatible", ["hermes sessions schema unknown"], origin);
  }

  const sessions = [];
  for (const row of payload.data) {
    const session = normalizeHermesSession(row, { nowMs });
    if (session == null) return opaque("incompatible", ["hermes session row invalid"], origin);
    sessions.push(session);
  }
  sessions.sort((a, b) => (Date.parse(b.lastActiveAt ?? "") || 0) - (Date.parse(a.lastActiveAt ?? "") || 0)
    || String(a.id).localeCompare(String(b.id)));

  const hasMore = typeof payload.has_more === "boolean" ? payload.has_more : sessions.length >= capped;

  return out({
    state: "available", error: null, diagnostics: [], baseUrl: origin, sessions,
    aggregates: {
      returnedCount: sessions.length,
      activeCount: sessions.filter((s) => s.active).length,
      endedCount: sessions.filter((s) => s.endedAt != null).length,
      hasMore, lastActiveAt: sessions[0]?.lastActiveAt ?? null
    }
  });
}
