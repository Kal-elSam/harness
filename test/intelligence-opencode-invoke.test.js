import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKEND_IDS,
  OPENCODE_GO_DEFAULT_MODEL,
  OPENCODE_ZEN_DEFAULT_FREE_MODEL,
  createOpencodeGoBackend,
  createOpencodeZenBackend
} from "../src/global/intelligence/index.js";

const emptyCli = () => ({
  cliInstalled: false,
  authListOk: false,
  authProviders: [],
  error: null
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

test("Go chat completions invoke normalizes content and usage", async () => {
  const backend = createOpencodeGoBackend({
    env: { OPENCODE_API_KEY: "sk-test" },
    collectCliEvidence: emptyCli,
    fetchImpl: async (url, init) => {
      assert.match(String(url), /\/chat\/completions$/);
      const body = JSON.parse(init.body);
      assert.equal(body.model, "kimi-k2.7-code");
      assert.equal(body.messages[0].role, "system");
      return jsonResponse(200, {
        model: "kimi-k2.7-code",
        choices: [{ message: { content: "go answer" } }],
        usage: { prompt_tokens: 11, completion_tokens: 3 }
      });
    }
  });

  const result = await backend.invoke(
    { systemPrompt: "sys" },
    { modelId: "kimi-k2.7-code", prompt: "hi" }
  );
  assert.equal(result.ok, true);
  assert.equal(result.backendId, BACKEND_IDS.OPENCODE_GO);
  assert.equal(result.content, "go answer");
  assert.equal(result.usage.inputTokens, 11);
  assert.equal(result.usage.outputTokens, 3);
  assert.equal(result.usage.fallbackUsed, false);
});

test("Zen responses invoke normalizes output_text", async () => {
  const backend = createOpencodeZenBackend({
    env: { OPENCODE_API_KEY: "sk-test" },
    collectCliEvidence: emptyCli,
    fetchImpl: async (url) => {
      assert.match(String(url), /\/responses$/);
      return jsonResponse(200, {
        model: "gpt-5.5",
        output_text: "zen answer",
        usage: { input_tokens: 4, output_tokens: 2 }
      });
    }
  });

  const result = await backend.invoke({}, { modelId: "gpt-5.5", prompt: "hi" });
  assert.equal(result.ok, true);
  assert.equal(result.backendId, BACKEND_IDS.OPENCODE_ZEN);
  assert.equal(result.content, "zen answer");
  assert.equal(result.usage.inputTokens, 4);
  assert.equal(result.usage.fallbackUsed, false);
});

test("invoke uses provider default model when request omits modelId", async () => {
  const backend = createOpencodeGoBackend({
    env: { OPENCODE_API_KEY: "sk-test" },
    collectCliEvidence: emptyCli,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.model, OPENCODE_GO_DEFAULT_MODEL);
      return jsonResponse(200, {
        model: OPENCODE_GO_DEFAULT_MODEL,
        choices: [{ message: { content: "defaulted" } }],
        usage: {}
      });
    }
  });
  const result = await backend.invoke({}, { prompt: "hi" });
  assert.equal(result.ok, true);
  assert.equal(result.content, "defaulted");
});

test("invoke without API key fails without persisting credentials", async () => {
  const result = await createOpencodeZenBackend({
    env: {},
    collectCliEvidence: emptyCli
  }).invoke({}, { modelId: OPENCODE_ZEN_DEFAULT_FREE_MODEL, prompt: "hi" });
  assert.equal(result.ok, false);
  assert.match(result.error, /OPENCODE_API_KEY/);
  assert.match(result.error, /never stores credentials/i);
});

test("runtime-only model recommends --backend opencode with runtime id", async () => {
  const result = await createOpencodeGoBackend({
    env: { OPENCODE_API_KEY: "sk-test" },
    collectCliEvidence: emptyCli,
    fetchImpl: async () => jsonResponse(200, { data: [] })
  }).invoke({}, { modelId: "minimax-m3", prompt: "hi" });
  assert.equal(result.ok, false);
  assert.match(result.error, /--backend opencode/);
  assert.match(result.error, /opencode-go\/minimax-m3/);
});

test("HTTP invoke errors redact API keys for 401/403/429", async () => {
  const secret = "sk-oc-leaky";
  for (const status of [401, 403, 429]) {
    const result = await createOpencodeGoBackend({
      env: { OPENCODE_API_KEY: secret },
      collectCliEvidence: emptyCli,
      fetchImpl: async () => jsonResponse(status, {
        error: { message: `fail ${status} key=${secret}` }
      })
    }).invoke({}, { modelId: "kimi-k2.7-code", prompt: "hi" });
    assert.equal(result.ok, false);
    assert.ok(!String(result.error).includes(secret), `status ${status} leaked secret`);
    assert.match(result.error, /REDACTED|fail/i);
  }
});

test("composed backends keep catalog detect and listModels", async () => {
  const backend = createOpencodeGoBackend({
    env: { OPENCODE_API_KEY: "sk-test" },
    collectCliEvidence: emptyCli,
    fetchImpl: async () => jsonResponse(200, { data: [{ id: "kimi-k2.7-code" }] })
  });
  const detection = await backend.detect();
  assert.equal(detection.authenticated, true);
  const models = await backend.listModels();
  assert.ok(models.some((entry) => entry.modelId === "kimi-k2.7-code"));
  assert.equal(typeof backend.capabilities, "function");
  assert.equal(typeof backend.invoke, "function");
});
