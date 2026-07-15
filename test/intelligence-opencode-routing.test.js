import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKEND_IDS,
  OPENCODE_GO_DEFAULT_MODEL,
  ROUTING_MODES,
  createDefaultBackends,
  inspectIntelligenceBackends,
  resolveRoutingDecision,
  runIntelligenceRequest,
  summarizeIntelligenceBackends
} from "../src/global/intelligence/index.js";

const emptyCli = () => ({ cliInstalled: false, authListOk: false, authProviders: [], error: null });

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(body); } };
}

function cloudModel(id, modelId, costClass = "paid") {
  return {
    id,
    hasApiKey: true,
    authenticated: true,
    available: true,
    configured: true,
    models: [{ provider: id, modelId, local: false, privacyClass: "cloud", costClass }]
  };
}

test("registry order is Ollama → Go → Zen → OpenRouter → runtime", () => {
  const ids = createDefaultBackends({
    env: {},
    collectCliEvidence: emptyCli,
    whichImpl: () => false
  }).map((entry) => entry.id);
  assert.deepEqual(ids, [
    BACKEND_IDS.OLLAMA,
    BACKEND_IDS.OPENCODE_GO,
    BACKEND_IDS.OPENCODE_ZEN,
    BACKEND_IDS.OPENROUTER,
    BACKEND_IDS.OPENCODE
  ]);
});

test("CLI evidence is collected once per default backend set", async () => {
  let calls = 0;
  const backends = createDefaultBackends({
    env: { OPENCODE_API_KEY: "sk-test" },
    collectCliEvidence: () => {
      calls += 1;
      return emptyCli();
    },
    fetchImpl: async () => jsonResponse(200, { data: [] })
  });
  await Promise.all(backends.map((backend) => backend.detect()));
  assert.equal(calls, 1);
});

test("routing prefers Go over Zen/OpenRouter with null Go fallback", () => {
  const decision = resolveRoutingDecision({
    backends: [
      { id: BACKEND_IDS.OLLAMA, available: false, models: [] },
      cloudModel(BACKEND_IDS.OPENCODE_GO, OPENCODE_GO_DEFAULT_MODEL),
      cloudModel(BACKEND_IDS.OPENCODE_ZEN, "big-pickle", "free"),
      cloudModel(BACKEND_IDS.OPENROUTER, "openrouter/free", "free")
    ],
    cloudConsent: true
  });
  assert.equal(decision.backendId, BACKEND_IDS.OPENCODE_GO);
  assert.equal(decision.fallback, null);
  assert.equal(decision.canInvoke, true);
});

test("authenticated routing safety: Go auth fail, Zen block, overrides, runtime, summary", () => {
  for (const status of [401, 403, 429]) {
    const blocked = resolveRoutingDecision({
      backends: [
        {
          id: BACKEND_IDS.OPENCODE_GO, hasApiKey: true, authenticated: false,
          available: false, configured: true, error: `HTTP ${status}`, models: []
        },
        cloudModel(BACKEND_IDS.OPENCODE_ZEN, "big-pickle", "free"),
        cloudModel(BACKEND_IDS.OPENROUTER, "openrouter/free", "free")
      ],
      cloudConsent: true
    });
    assert.equal(blocked.mode, ROUTING_MODES.DIAGNOSTICS);
    assert.equal(blocked.canInvoke, false);
    assert.equal(blocked.fallback, null);
  }

  const zenOk = resolveRoutingDecision({
    backends: [
      {
        id: BACKEND_IDS.OPENCODE_GO, hasApiKey: false, authenticated: false,
        available: false, configured: false, models: []
      },
      cloudModel(BACKEND_IDS.OPENCODE_ZEN, "big-pickle", "free"),
      cloudModel(BACKEND_IDS.OPENROUTER, "openrouter/free", "free")
    ],
    cloudConsent: true
  });
  assert.equal(zenOk.backendId, BACKEND_IDS.OPENCODE_ZEN);

  const zenBlocks = resolveRoutingDecision({
    backends: [
      {
        id: BACKEND_IDS.OPENCODE_GO, hasApiKey: false, authenticated: false,
        available: false, configured: false, models: []
      },
      {
        id: BACKEND_IDS.OPENCODE_ZEN, hasApiKey: true, authenticated: false,
        available: false, configured: true, error: "HTTP 401", models: []
      },
      cloudModel(BACKEND_IDS.OPENROUTER, "openrouter/free", "free")
    ],
    cloudConsent: true
  });
  assert.equal(zenBlocks.mode, ROUTING_MODES.DIAGNOSTICS);
  assert.equal(zenBlocks.fallback, null);

  const override = resolveRoutingDecision({
    backends: [
      {
        id: BACKEND_IDS.OPENCODE_GO, hasApiKey: true, authenticated: false,
        available: false, configured: true, models: []
      },
      cloudModel(BACKEND_IDS.OPENCODE_ZEN, "big-pickle", "free")
    ],
    cloudConsent: true,
    sessionOverride: {
      preferredBackend: BACKEND_IDS.OPENCODE_GO,
      preferredModel: OPENCODE_GO_DEFAULT_MODEL
    }
  });
  assert.equal(override.mode, ROUTING_MODES.DIAGNOSTICS);
  assert.match(override.reason, /not eligible|automatic routing was not applied/i);

  const runtime = resolveRoutingDecision({
    backends: [
      cloudModel(BACKEND_IDS.OPENCODE_ZEN, "big-pickle", "free"),
      {
        id: BACKEND_IDS.OPENCODE, available: true, detected: true,
        authenticated: false, hasApiKey: false,
        models: [{ provider: BACKEND_IDS.OPENCODE, modelId: "opencode-default", local: false, privacyClass: "cloud" }]
      }
    ],
    cloudConsent: true,
    sessionOverride: { preferredBackend: BACKEND_IDS.OPENCODE }
  });
  assert.equal(runtime.backendId, BACKEND_IDS.OPENCODE);

  const summary = summarizeIntelligenceBackends([
    {
      id: BACKEND_IDS.OPENCODE_GO, available: false, hasApiKey: true,
      configured: true, authenticated: false, state: "error"
    },
    {
      id: BACKEND_IDS.OPENCODE_ZEN, available: true, hasApiKey: true,
      configured: true, authenticated: true, state: "authenticated"
    },
    { id: BACKEND_IDS.OPENROUTER, available: true, hasApiKey: true, state: "authenticated" }
  ]);
  assert.equal(summary.opencodeGoAuthenticated, false);
  assert.equal(summary.opencodeZenAuthenticated, true);
  assert.equal(summary.cloudConfigured, true);
  assert.equal(summary.cloudAuthenticated, true);
});

test("CLI sessionOverride beats profile and Ollama", () => {
  const decision = resolveRoutingDecision({
    backends: [
      {
        id: BACKEND_IDS.OLLAMA,
        available: true,
        models: [{ provider: BACKEND_IDS.OLLAMA, modelId: "llama3.2", local: true, privacyClass: "local" }]
      },
      cloudModel(BACKEND_IDS.OPENCODE_GO, OPENCODE_GO_DEFAULT_MODEL)
    ],
    profile: { preferredBackend: BACKEND_IDS.OLLAMA },
    cloudConsent: true,
    sessionOverride: {
      preferredBackend: BACKEND_IDS.OPENCODE_GO,
      preferredModel: OPENCODE_GO_DEFAULT_MODEL
    }
  });
  assert.equal(decision.backendId, BACKEND_IDS.OPENCODE_GO);
  assert.equal(decision.mode, ROUTING_MODES.USER_OVERRIDE);
  assert.match(decision.reason, /^CLI override:/);
});

test("profile override beats automatic selection", () => {
  const decision = resolveRoutingDecision({
    backends: [
      {
        id: BACKEND_IDS.OLLAMA,
        available: true,
        models: [{ provider: BACKEND_IDS.OLLAMA, modelId: "llama3.2", local: true, privacyClass: "local" }]
      },
      cloudModel(BACKEND_IDS.OPENCODE_ZEN, "big-pickle", "free")
    ],
    profile: { preferredBackend: BACKEND_IDS.OPENCODE_ZEN, preferredModel: "big-pickle" },
    cloudConsent: true
  });
  assert.equal(decision.backendId, BACKEND_IDS.OPENCODE_ZEN);
  assert.match(decision.reason, /^User override:/);
});

test("cloud consent blocks Go, Zen, and OpenRouter invoke", () => {
  for (const id of [BACKEND_IDS.OPENCODE_GO, BACKEND_IDS.OPENCODE_ZEN, BACKEND_IDS.OPENROUTER]) {
    const decision = resolveRoutingDecision({
      backends: [cloudModel(id, "m")],
      cloudConsent: false
    });
    assert.equal(decision.backendId, id);
    assert.equal(decision.canInvoke, false);
    assert.equal(decision.requiresCloudConsent, true);
  }
});

test("Go invoke failure does not auto-invoke Zen", async () => {
  let zenCalls = 0;
  const outcome = await runIntelligenceRequest({
    workspaceRoot: process.cwd(),
    prompt: "hi",
    cloudConsent: true,
    confirmed: true,
    backends: [
      {
        id: BACKEND_IDS.OPENCODE_GO,
        detect: async () => ({
          id: BACKEND_IDS.OPENCODE_GO, available: true, hasApiKey: true,
          authenticated: true, state: "authenticated"
        }),
        listModels: async () => cloudModel(BACKEND_IDS.OPENCODE_GO, OPENCODE_GO_DEFAULT_MODEL).models,
        capabilities: async () => ({}),
        invoke: async () => ({ ok: false, error: "HTTP 429 limit", usage: null })
      },
      {
        id: BACKEND_IDS.OPENCODE_ZEN,
        detect: async () => ({
          id: BACKEND_IDS.OPENCODE_ZEN, available: true, hasApiKey: true,
          authenticated: true, state: "authenticated"
        }),
        listModels: async () => cloudModel(BACKEND_IDS.OPENCODE_ZEN, "big-pickle", "free").models,
        capabilities: async () => ({}),
        invoke: async () => {
          zenCalls += 1;
          return { ok: true, content: "zen", usage: {} };
        }
      }
    ]
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.routing.backendId, BACKEND_IDS.OPENCODE_GO);
  assert.equal(outcome.routing.fallback, null);
  assert.equal(zenCalls, 0);
});

test("no eligible backend ends in diagnostics; inspect includes runtime after OpenRouter", async () => {
  const decision = resolveRoutingDecision({ backends: [] });
  assert.equal(decision.mode, ROUTING_MODES.DIAGNOSTICS);
  assert.equal(decision.canInvoke, false);

  const inspections = await inspectIntelligenceBackends({
    env: {},
    fetchImpl: async (url) => {
      if (String(url).includes("11434")) throw new Error("down");
      return jsonResponse(401, { error: "unauthorized" });
    },
    whichImpl: () => false,
    collectCliEvidence: emptyCli
  });
  assert.equal(inspections.length, 5);
  assert.ok(inspections.some((entry) => entry.id === BACKEND_IDS.OPENCODE));
  assert.equal(inspections.at(-1).id, BACKEND_IDS.OPENCODE);
});
