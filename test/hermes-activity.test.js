import test from "node:test";
import assert from "node:assert/strict";
import {
  assertHermesLoopbackUrl, capabilitiesAdvertiseSessionsList, loadHermesActivity,
  normalizeHermesSession, HERMES_ACTIVITY_TIMEOUT_MS
} from "../src/global/observability/hermes-activity.js";
import { buildCompanionSnapshot } from "../src/global/observability/build-companion-snapshot.js";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";

const NOW = Date.parse("2026-08-05T18:00:00.000Z");
const SECRET = "super-secret-token";

function capsOk(extra = {}) {
  return {
    object: "hermes.api_server.capabilities",
    platform: "hermes-agent",
    features: { session_resources: true, session_chat: true },
    endpoints: {
      sessions: { method: "GET", path: "/api/sessions" },
      session_create: { method: "POST", path: "/api/sessions" }
    },
    ...extra
  };
}

function listOk(rows, extra = {}) {
  return { object: "list", data: rows, limit: 20, offset: 0, has_more: false, ...extra };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300, status, redirected: false,
    async text() { return typeof body === "string" ? body : JSON.stringify(body); }
  };
}

function trackFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, redirect: init.redirect });
    return handler(String(url), init, calls.length);
  };
  return { calls, fetchImpl };
}

function assertNoSecret(value) {
  assert.ok(!JSON.stringify(value).includes(SECRET));
}

async function withCapsThen(bodyOrFetch) {
  const fetchImpl = typeof bodyOrFetch === "function" ? bodyOrFetch : async (url) => (
    url.endsWith("/v1/capabilities") ? jsonResponse(200, capsOk()) : jsonResponse(200, bodyOrFetch)
  );
  return loadHermesActivity({ baseUrl: "http://127.0.0.1:8642", apiKey: SECRET, nowMs: NOW, fetchImpl });
}

test("loopback URL gate", () => {
  assert.equal(assertHermesLoopbackUrl("http://127.0.0.1:8642").ok, true);
  assert.equal(assertHermesLoopbackUrl("https://localhost/v1").ok, true);
  assert.equal(assertHermesLoopbackUrl("http://example.com").ok, false);
  assert.equal(assertHermesLoopbackUrl("http://user:pass@127.0.0.1:8642").ok, false);
  assert.equal(assertHermesLoopbackUrl("ftp://127.0.0.1").ok, false);
});

test("capabilities require features.session_resources + {method,path}", () => {
  assert.equal(capabilitiesAdvertiseSessionsList(capsOk()), true);
  assert.equal(capabilitiesAdvertiseSessionsList({
    ...capsOk(), features: { session_resources: false }
  }), false);
  assert.equal(capabilitiesAdvertiseSessionsList({
    platform: "hermes-agent", session_resources: true,
    endpoints: { sessions: "GET /api/sessions" }
  }), false);
  assert.equal(capabilitiesAdvertiseSessionsList(capsOk({
    endpoints: { sessions: { method: "POST", path: "/api/sessions" } }
  })), false);
  assert.equal(capabilitiesAdvertiseSessionsList(capsOk({
    endpoints: { sessions: { method: "GET", path: "/api/sessions/extra" } }
  })), false);
});

test("productive upstream fixtures: capabilities → list data; scrub", async () => {
  const { calls, fetchImpl } = trackFetch((url) => {
    if (url.endsWith("/v1/capabilities")) return jsonResponse(200, capsOk());
    if (url.includes("/api/sessions?")) {
      return jsonResponse(200, listOk([{
        id: "s1", source: "cli", model: "m", title: "t",
        started_at: NOW / 1000 - 60, ended_at: null, last_active: NOW / 1000 - 30,
        message_count: 3, tool_call_count: 1, input_tokens: 10, output_tokens: 5,
        preview: "SECRET PREVIEW", user_id: "u1",
        estimated_cost_usd: 1.2, parent_session_id: "p0",
        has_system_prompt: true, has_model_config: true
      }], { has_more: true, total: undefined }));
    }
    throw new Error(`unexpected ${url}`);
  });

  const out = await loadHermesActivity({
    baseUrl: "http://127.0.0.1:8642", apiKey: SECRET, limit: 20,
    timeoutMs: HERMES_ACTIVITY_TIMEOUT_MS, nowMs: NOW, fetchImpl
  });
  assert.equal(out.state, "available");
  assert.equal(out.sessions[0].tokenCount, 15);
  assert.equal(out.sessions[0].active, true);
  assert.equal(out.aggregates.hasMore, true);
  assert.deepEqual(calls.map((c) => c.url), [
    "http://127.0.0.1:8642/v1/capabilities",
    "http://127.0.0.1:8642/api/sessions?limit=20&offset=0&include_children=false"
  ]);
  assert.ok(calls.every((c) => c.method === "GET" && c.redirect === "error"));
  assert.equal(calls[0].headers.Authorization, `Bearer ${SECRET}`);
  assertNoSecret(out);
  for (const leak of ["preview", "user_id", "estimated_cost", "parent_session", "has_system_prompt"]) {
    assert.ok(!JSON.stringify(out).includes(leak));
  }
});

test("transport + inverted/synthetic schemas → incompatible; invalid rows abort", async () => {
  const cases = [
    ["http://example.com:8642", async () => jsonResponse(200, {}), "incompatible"],
    ["http://127.0.0.1:8642", async () => { throw new Error("fetch failed"); }, "unavailable"],
    ["http://127.0.0.1:8642", async () => jsonResponse(401, { error: "nope token=" + SECRET }), "auth_required"],
    ["http://127.0.0.1:8642", async () => jsonResponse(200, "<html>nope</html>"), "incompatible"],
    ["http://127.0.0.1:8642", async () => jsonResponse(200, {
      platform: "hermes-agent", session_resources: true,
      endpoints: { sessions: "GET /api/sessions" }
    }), "incompatible"]
  ];
  for (const [baseUrl, fetchImpl, state] of cases) {
    const out = await loadHermesActivity({ baseUrl, apiKey: SECRET, fetchImpl });
    assert.equal(out.state, state); assertNoSecret(out);
  }
  let n = 0;
  const abort = async () => {
    n += 1;
    if (n === 1) return jsonResponse(200, capsOk());
    const err = new Error("aborted"); err.name = "AbortError"; throw err;
  };
  assert.equal((await loadHermesActivity({ baseUrl: "http://127.0.0.1:8642", fetchImpl: abort })).state, "error");
  n = 0;
  const five = await loadHermesActivity({
    baseUrl: "http://127.0.0.1:8642",
    fetchImpl: async () => ++n === 1 ? jsonResponse(200, capsOk()) : jsonResponse(503, { error: "down " + SECRET })
  });
  assert.equal(five.state, "error"); assertNoSecret(five);

  assert.equal(normalizeHermesSession({
    id: "f", started_at: NOW / 1000 - 120, last_active: NOW / 1000 + 86_400, message_count: 1
  }, { nowMs: NOW }).active, false);
  assert.equal(normalizeHermesSession({ session_id: "renamed", started_at: NOW / 1000 }), null);
  assert.equal(normalizeHermesSession({ id: "x", started_at: "not-a-date" }), null);
  assert.equal(normalizeHermesSession({ id: "x", source: {} }), null);
  assert.equal(normalizeHermesSession({ id: "x", message_count: "1" }), null);
  assert.equal(normalizeHermesSession({ id: "x", started_at: 1e20 }), null);

  assert.equal((await withCapsThen({ sessions: [{ id: "s1", started_at: NOW / 1000 }] })).state, "incompatible");
  assert.equal((await withCapsThen({ data: [{ id: "s1", started_at: NOW / 1000 }] })).state, "incompatible");
  const renamed = await withCapsThen(listOk([
    { session_id: "renamed", started_at: NOW / 1000, last_active: NOW / 1000 }
  ]));
  assert.equal(renamed.state, "incompatible");
  assert.equal(renamed.sessions.length, 0);
  const outOfRange = await withCapsThen(listOk([{ id: "x", started_at: 1e20 }]));
  assert.equal(outOfRange.state, "incompatible");
  assert.equal(outOfRange.sessions.length, 0);
});

test("companion carries hermes.activity without steering governance", async () => {
  const snap = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.HEALTHY,
    buildObservability: async () => ({ probes: [{ id: "gentle", state: "available", evidence: [] }] }),
    inspectEngram: () => ({ status: "configured", binary: { path: "/e" } }),
    loadHermesActivity: async () => ({
      state: "unavailable", error: "unavailable", diagnostics: ["down"],
      baseUrl: "http://127.0.0.1:8642", sessions: [],
      aggregates: { returnedCount: 0, activeCount: 0, endedCount: 0, hasMore: false, lastActiveAt: null }
    }),
    loadEcosystemUpdates: async () => ({ state: "available", tools: {}, diagnostics: [], cacheHit: true }),
    runs: [], reviews: [], alerts: []
  });
  assert.equal(snap.ok, true);
  assert.equal(snap.signals.hermes.activity.state, "unavailable");
  assert.equal(snap.nextSafeAction.kind, "missing");
  const threw = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.HEALTHY,
    buildObservability: async () => ({ probes: [] }),
    loadHermesActivity: async () => { throw new Error("boom " + SECRET); },
    loadEcosystemUpdates: async () => ({ state: "available", tools: {}, diagnostics: [], cacheHit: true }),
    runs: [], reviews: [], alerts: []
  });
  assert.equal(threw.signals.hermes.activity.state, "error");
  assertNoSecret(threw);
});
