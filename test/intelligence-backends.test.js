import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  BACKEND_IDS,
  OPENROUTER_FREE_MODEL,
  ROUTING_MODES,
  createOllamaBackend,
  createCustomHttpBackend,
  createOpenRouterBackend,
  inspectIntelligenceBackends,
  resolveRoutingDecision,
  runIntelligenceRequest
} from "../src/global/intelligence/index.js";
import { CAPABILITY_STATES } from "../src/global/capability-states.js";

function mockFetchSequence(handlers) {
  let index = 0;
  return async (url, init = {}) => {
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    return handler(String(url), init);
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

test("Ollama detect reports unknown when host unreachable", async () => {
  const backend = createOllamaBackend({
    host: "http://127.0.0.1:9",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    }
  });

  const detection = await backend.detect();
  assert.equal(detection.detected, false);
  assert.equal(detection.state, CAPABILITY_STATES.UNKNOWN);
});

test("Ollama detect and listModels when tags available", async () => {
  const fetchImpl = mockFetchSequence([
    async () => jsonResponse(200, {
      models: [{ name: "llama3.2:latest", model: "llama3.2:latest", size: 1 }]
    })
  ]);

  const backend = createOllamaBackend({ host: "http://127.0.0.1:11434", fetchImpl });
  const detection = await backend.detect();
  assert.equal(detection.detected, true);
  assert.equal(detection.available, true);

  const models = await backend.listModels();
  assert.equal(models[0].modelId, "llama3.2:latest");
  assert.equal(models[0].local, true);
});

test("Ollama invoke posts chat and returns usage", async () => {
  const fetchImpl = mockFetchSequence([
    async (url, init) => {
      assert.match(url, /\/api\/chat$/);
      assert.equal(init.method, "POST");
      return jsonResponse(200, {
        message: { role: "assistant", content: "hello local" },
        prompt_eval_count: 10,
        eval_count: 4
      });
    }
  ]);

  const backend = createOllamaBackend({ fetchImpl });
  const result = await backend.invoke(
    { systemPrompt: "sys" },
    { modelId: "llama3.2", prompt: "hi" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.content, "hello local");
  assert.equal(result.usage.inputTokens, 10);
});

test("custom provider derives privacy from baseUrl instead of profile local flag", async () => {
  const remote = createCustomHttpBackend({
    baseUrl: "https://provider.example/v1",
    modelId: "remote-model",
    local: true
  });
  const local = createCustomHttpBackend({
    baseUrl: "http://127.0.0.1:8080/v1",
    modelId: "local-model",
    local: false
  });

  assert.equal(remote.local, false);
  assert.equal((await remote.listModels())[0].privacyClass, "cloud");
  assert.equal(local.local, true);
  assert.equal((await local.listModels())[0].privacyClass, "local");
});

test("custom providers reject unsafe schemes before credentials can be sent", async () => {
  assert.throws(
    () => createCustomHttpBackend({
      baseUrl: "http://remote.example/v1",
      apiKeyEnv: "REMOTE_KEY",
      env: { REMOTE_KEY: "secret" }
    }),
    /https|local|private/i
  );
  assert.throws(
    () => createCustomHttpBackend({ baseUrl: "file:///tmp/provider" }),
    /http|https/i
  );
  assert.throws(
    () => createCustomHttpBackend({
      baseUrl: "https://provider.example/v1",
      modelId: "remote-model",
      apiKeyEnv: "REMOTE_KEY",
      env: { REMOTE_KEY: "secret" }
    }),
    /remote custom providers.*apiKeyEnv|local endpoint/i
  );

  let request;
  const backend = createCustomHttpBackend({
    baseUrl: "http://127.0.0.1:8080/v1",
    modelId: "local-model",
    apiKeyEnv: "LOCAL_KEY",
    env: { LOCAL_KEY: "secret" },
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse(200, { choices: [{ message: { content: "ok" } }] });
    }
  });

  const result = await backend.invoke({}, { prompt: "hello" });
  assert.equal(result.ok, true);
  assert.equal(request.init.headers.Authorization, "Bearer secret");
});

test("OpenRouter without API key stays unknown", async () => {
  const backend = createOpenRouterBackend({ env: {} });
  const detection = await backend.detect();
  assert.equal(detection.hasApiKey, false);
  assert.equal(detection.state, CAPABILITY_STATES.UNKNOWN);
});

test("OpenRouter with API key is authenticated and lists free router", async () => {
  const fetchImpl = mockFetchSequence([
    async () => jsonResponse(200, { data: [{ id: "meta/llama-3.3-70b:free", context_length: 8192 }] })
  ]);

  const backend = createOpenRouterBackend({
    env: { OPENROUTER_API_KEY: "sk-or-test" },
    fetchImpl
  });

  const detection = await backend.detect();
  assert.equal(detection.hasApiKey, true);
  assert.equal(detection.state, CAPABILITY_STATES.AUTHENTICATED);

  const models = await backend.listModels();
  assert.ok(models.some((entry) => entry.modelId === OPENROUTER_FREE_MODEL));
});

test("cloud fallback denied without consent; approved with consent", async () => {
  const backends = [
    {
      id: BACKEND_IDS.OLLAMA,
      available: false,
      models: []
    },
    {
      id: BACKEND_IDS.OPENROUTER,
      available: true,
      hasApiKey: true,
      models: [{
        provider: BACKEND_IDS.OPENROUTER,
        modelId: OPENROUTER_FREE_MODEL,
        local: false,
        privacyClass: "cloud",
        costClass: "free"
      }]
    }
  ];

  const denied = resolveRoutingDecision({ backends, cloudConsent: false });
  assert.equal(denied.mode, ROUTING_MODES.CLOUD_CONSENT);
  assert.equal(denied.canInvoke, false);
  assert.equal(denied.requiresCloudConsent, true);

  const approved = resolveRoutingDecision({ backends, cloudConsent: true });
  assert.equal(approved.canInvoke, true);
});

test("user model override wins over local default", () => {
  const backends = [
    {
      id: BACKEND_IDS.OLLAMA,
      available: true,
      models: [{
        provider: BACKEND_IDS.OLLAMA,
        modelId: "llama3.2",
        local: true,
        privacyClass: "local",
        costClass: "local"
      }]
    },
    {
      id: BACKEND_IDS.OPENROUTER,
      available: true,
      hasApiKey: true,
      models: [{
        provider: BACKEND_IDS.OPENROUTER,
        modelId: OPENROUTER_FREE_MODEL,
        local: false,
        privacyClass: "cloud",
        costClass: "free"
      }]
    }
  ];

  const decision = resolveRoutingDecision({
    backends,
    profile: {
      preferredBackend: BACKEND_IDS.OPENROUTER,
      preferredModel: OPENROUTER_FREE_MODEL
    },
    cloudConsent: true
  });

  assert.equal(decision.mode, ROUTING_MODES.USER_OVERRIDE);
  assert.equal(decision.backendId, BACKEND_IDS.OPENROUTER);
  assert.equal(decision.model.modelId, OPENROUTER_FREE_MODEL);
});

test("no backend leaves diagnostics mode", () => {
  const decision = resolveRoutingDecision({ backends: [] });
  assert.equal(decision.mode, ROUTING_MODES.DIAGNOSTICS);
  assert.equal(decision.canInvoke, false);
});

test("token budget blocks invoke when exceeded", () => {
  const decision = resolveRoutingDecision({
    backends: [{
      id: BACKEND_IDS.OLLAMA,
      available: true,
      models: [{ modelId: "x", local: true, privacyClass: "local" }]
    }],
    contextPack: { estimatedTokens: 5000 },
    tokenBudget: 100
  });

  assert.equal(decision.canInvoke, false);
  assert.match(decision.reason, /budget/i);
});

test("runIntelligenceRequest requires consent+confirm for cloud", async () => {
  const openrouter = createOpenRouterBackend({
    env: { OPENROUTER_API_KEY: "sk-or-test" },
    fetchImpl: mockFetchSequence([
      async () => jsonResponse(200, { data: [] }),
      async () => jsonResponse(200, {
        model: "meta/llama:free",
        choices: [{ message: { content: "cloud ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 }
      })
    ])
  });

  const ollamaDown = createOllamaBackend({
    fetchImpl: async () => {
      throw new Error("down");
    }
  });

  const denied = await runIntelligenceRequest({
    workspaceRoot: process.cwd(),
    backends: [ollamaDown, openrouter],
    prompt: "hello",
    cloudConsent: false,
    confirmed: false,
    env: { OPENROUTER_API_KEY: "sk-or-test" }
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.diagnosticsOnly, true);

  const fetchImpl = mockFetchSequence([
    async (url) => {
      if (String(url).includes("11434")) throw new Error("down");
      if (String(url).includes("/models")) return jsonResponse(200, { data: [] });
      return jsonResponse(200, {
        model: "meta/llama:free",
        choices: [{ message: { content: "cloud ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 }
      });
    }
  ]);

  const approved = await runIntelligenceRequest({
    workspaceRoot: process.cwd(),
    backends: [
      createOllamaBackend({ fetchImpl }),
      createOpenRouterBackend({ env: { OPENROUTER_API_KEY: "sk-or-test" }, fetchImpl })
    ],
    prompt: "hello",
    cloudConsent: true,
    confirmed: true,
    env: { OPENROUTER_API_KEY: "sk-or-test" }
  });

  assert.equal(approved.ok, true);
  assert.equal(approved.result.content, "cloud ok");
  assert.equal(approved.telemetry.inputTokens, 5);
});

test("profile cloudConsent never authorizes an invocation", async () => {
  let invoked = false;
  const cloud = {
    id: BACKEND_IDS.OPENROUTER,
    label: "Cloud",
    async detect() {
      return { id: BACKEND_IDS.OPENROUTER, label: "Cloud", detected: true, available: true, hasApiKey: true };
    },
    async listModels() {
      return [{ modelId: OPENROUTER_FREE_MODEL, local: false, privacyClass: "cloud", costClass: "free" }];
    },
    async capabilities() {
      return { id: BACKEND_IDS.OPENROUTER, cloud: true };
    },
    async invoke() {
      invoked = true;
      return { ok: true, content: "must not run", usage: {} };
    }
  };

  const outcome = await runIntelligenceRequest({
    workspaceRoot: process.cwd(),
    profile: { cloudConsent: true },
    backends: [cloud],
    prompt: "hello",
    confirmed: true
  });

  assert.equal(outcome.ok, false);
  assert.equal(invoked, false);
  assert.match(outcome.error, /consent/i);
});

test("include-private requires a second confirmation before local invoke", async () => {
  const root = await mkdtemp(`${tmpdir()}/kairo-private-confirm-`);
  await writeFile(`${root}/.env`, "TOP_SECRET=1\n", "utf8");
  await writeFile(`${root}/package.json`, JSON.stringify({ name: "private-confirm" }), "utf8");

  let invoked = false;
  const local = {
    id: BACKEND_IDS.OLLAMA,
    label: "Local",
    async detect() {
      return { id: BACKEND_IDS.OLLAMA, label: "Local", detected: true, available: true };
    },
    async listModels() {
      return [{ modelId: "local-model", local: true, privacyClass: "local", costClass: "local" }];
    },
    async capabilities() {
      return { id: BACKEND_IDS.OLLAMA, local: true };
    },
    async invoke() {
      invoked = true;
      return { ok: true, content: "must not run", usage: {} };
    }
  };

  const outcome = await runIntelligenceRequest({
    workspaceRoot: root,
    backends: [local],
    prompt: "hello",
    relevantPaths: [".env"],
    includePrivate: true,
    confirmed: false
  });

  assert.equal(outcome.ok, false);
  assert.equal(invoked, false);
  assert.match(outcome.error, /include-private.*confirm/i);
  assert.equal(outcome.contextPack.relevantFiles.includes(".env"), false);
});

test("inspectIntelligenceBackends returns default backends including OpenCode Go/Zen", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("11434")) throw new Error("down");
    return jsonResponse(401, { error: "unauthorized" });
  };

  const inspections = await inspectIntelligenceBackends({
    env: {},
    fetchImpl,
    whichImpl: () => false,
    collectCliEvidence: () => ({
      cliInstalled: false,
      authListOk: false,
      authProviders: [],
      error: null
    })
  });

  assert.equal(inspections.length, 5);
  assert.ok(inspections.some((entry) => entry.id === BACKEND_IDS.OLLAMA));
  assert.ok(inspections.some((entry) => entry.id === BACKEND_IDS.OPENCODE_GO));
  assert.ok(inspections.some((entry) => entry.id === BACKEND_IDS.OPENCODE_ZEN));
  assert.ok(inspections.some((entry) => entry.id === BACKEND_IDS.OPENROUTER));
  assert.ok(inspections.some((entry) => entry.id === BACKEND_IDS.OPENCODE));
});
