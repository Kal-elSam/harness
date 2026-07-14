import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKEND_IDS,
  COST_CLASSES,
  TRANSPORT_KINDS,
  ENTITLEMENT_STATES,
  createOpencodeGoBackend,
  createOpencodeZenBackend
} from "../src/global/intelligence/index.js";
import {
  zenCostClassForModel,
  goCostClassForModel
} from "../src/global/intelligence/backends/opencode-catalog.js";
import { CAPABILITY_STATES } from "../src/global/capability-states.js";

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

test("Go without API key stays unknown", async () => {
  const detection = await createOpencodeGoBackend({
    env: {},
    collectCliEvidence: emptyCli
  }).detect();
  assert.equal(detection.hasApiKey, false);
  assert.equal(detection.configured, false);
  assert.equal(detection.authenticated, false);
  assert.equal(detection.state, CAPABILITY_STATES.UNKNOWN);
  assert.equal(detection.billingModel, "go_plan");
  assert.match(detection.recommendation, /OPENCODE_API_KEY/);
});

test("Go configured via CLI auth list stays unauthenticated", async () => {
  const detection = await createOpencodeGoBackend({
    env: {},
    collectCliEvidence: () => ({
      cliInstalled: true,
      authListOk: true,
      authProviders: ["OpenCode Go"],
      error: null
    })
  }).detect();
  assert.equal(detection.configured, true);
  assert.equal(detection.authenticated, false);
  assert.equal(detection.entitlement, ENTITLEMENT_STATES.UNVERIFIED);
});

test("Go HTTP 429 is limit_reached without Zen spend", async () => {
  const detection = await createOpencodeGoBackend({
    env: { OPENCODE_API_KEY: "sk-test" },
    collectCliEvidence: emptyCli,
    fetchImpl: async () => jsonResponse(429, { error: { message: "limit" } })
  }).detect();
  assert.equal(detection.entitlement, ENTITLEMENT_STATES.LIMIT_REACHED);
  assert.match(detection.recommendation, /429|limit_reached|do not automatically/i);
});

test("Go /models authenticates and intersects direct transports only", async () => {
  const secret = "sk-oc-secret-value";
  const backend = createOpencodeGoBackend({
    env: { OPENCODE_API_KEY: secret },
    collectCliEvidence: emptyCli,
    fetchImpl: async (url, init) => {
      assert.match(String(url), /\/zen\/go\/v1\/models$/);
      assert.equal(init.headers.Authorization, `Bearer ${secret}`);
      return jsonResponse(200, {
        data: [
          { id: "kimi-k2.7-code" },
          { id: "minimax-m3" },
          { id: "totally-unknown-model" }
        ]
      });
    }
  });
  const detection = await backend.detect();
  assert.equal(detection.authenticated, true);
  assert.equal(detection.state, CAPABILITY_STATES.AUTHENTICATED);
  const models = await backend.listModels();
  assert.equal(models.find((m) => m.modelId === "kimi-k2.7-code").transport, TRANSPORT_KINDS.CHAT_COMPLETIONS);
  assert.ok(!models.some((m) => m.modelId === "minimax-m3"));
  assert.ok(!models.some((m) => m.modelId === "totally-unknown-model"));
});

test("detection errors redact API key secrets", async () => {
  const secret = "sk-oc-leaky";
  const detection = await createOpencodeGoBackend({
    env: { OPENCODE_API_KEY: secret },
    collectCliEvidence: emptyCli,
    fetchImpl: async () => jsonResponse(401, { error: { message: `bad key ${secret}` } })
  }).detect();
  assert.equal(detection.state, CAPABILITY_STATES.ERROR);
  assert.ok(!String(detection.error).includes(secret));
  assert.match(detection.error, /REDACTED/i);
});

test("Zen credits, free cost classes, and responses transport", async () => {
  assert.equal(zenCostClassForModel("big-pickle"), COST_CLASSES.FREE);
  assert.equal(zenCostClassForModel("mimo-v2.5-free"), COST_CLASSES.FREE);
  assert.equal(zenCostClassForModel("gpt-5.5"), COST_CLASSES.PAID);
  assert.equal(goCostClassForModel(), COST_CLASSES.PAID);

  const backend = createOpencodeZenBackend({
    env: { OPENCODE_API_KEY: "sk-test" },
    collectCliEvidence: emptyCli,
    fetchImpl: async () => jsonResponse(200, {
      data: [{ id: "big-pickle" }, { id: "gpt-5.5" }, { id: "claude-haiku-4-5" }]
    })
  });
  const detection = await backend.detect();
  assert.equal(detection.id, BACKEND_IDS.OPENCODE_ZEN);
  assert.equal(detection.billingModel, "zen_credits");
  const models = await backend.listModels();
  assert.equal(models.find((m) => m.modelId === "big-pickle").costClass, COST_CLASSES.FREE);
  assert.equal(models.find((m) => m.modelId === "gpt-5.5").transport, TRANSPORT_KINDS.RESPONSES);
  assert.ok(!models.some((m) => m.modelId === "claude-haiku-4-5"));
});
