import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKEND_IDS,
  TRANSPORT_KINDS,
  OPENCODE_API_KEY_ENV,
  OPENCODE_GO_BASE_URL,
  OPENCODE_ZEN_BASE_URL,
  OPENCODE_GO_DEFAULT_MODEL,
  OPENCODE_ZEN_DEFAULT_FREE_MODEL,
  createModelDescriptor,
  resolveOpencodeTransport,
  isDirectTransport,
  listRegisteredModelIds,
  normalizeModelId,
  toRuntimeModelRef,
  resolveRuntimeProduct
} from "../src/global/intelligence/index.js";

test("OpenCode backend IDs are explicit and stable", () => {
  assert.equal(BACKEND_IDS.OPENCODE_GO, "opencode-go");
  assert.equal(BACKEND_IDS.OPENCODE_ZEN, "opencode-zen");
  assert.equal(BACKEND_IDS.OPENCODE, "opencode");
});

test("transport kinds cover chat, responses, and runtime", () => {
  assert.equal(TRANSPORT_KINDS.CHAT_COMPLETIONS, "chat_completions");
  assert.equal(TRANSPORT_KINDS.RESPONSES, "responses");
  assert.equal(TRANSPORT_KINDS.RUNTIME, "runtime");
});

test("OpenCode contract constants stay env-safe", () => {
  assert.equal(OPENCODE_API_KEY_ENV, "OPENCODE_API_KEY");
  assert.match(OPENCODE_GO_BASE_URL, /\/zen\/go\/v1$/);
  assert.match(OPENCODE_ZEN_BASE_URL, /\/zen\/v1$/);
  assert.equal(OPENCODE_GO_DEFAULT_MODEL, "kimi-k2.7-code");
  assert.equal(OPENCODE_ZEN_DEFAULT_FREE_MODEL, "big-pickle");
});

test("createModelDescriptor accepts explicit transport", () => {
  const model = createModelDescriptor({
    provider: BACKEND_IDS.OPENCODE_GO,
    modelId: OPENCODE_GO_DEFAULT_MODEL,
    transport: TRANSPORT_KINDS.CHAT_COMPLETIONS
  });
  assert.equal(model.transport, TRANSPORT_KINDS.CHAT_COMPLETIONS);
  assert.equal(model.modelId, OPENCODE_GO_DEFAULT_MODEL);
});

test("transport registry never infers protocol from name", () => {
  assert.equal(resolveOpencodeTransport("go", "kimi-k2.7-code"), TRANSPORT_KINDS.CHAT_COMPLETIONS);
  assert.equal(resolveOpencodeTransport("zen", "gpt-5.5"), TRANSPORT_KINDS.RESPONSES);
  assert.equal(resolveOpencodeTransport("zen", "claude-haiku-4-5"), TRANSPORT_KINDS.RUNTIME);
  assert.equal(resolveOpencodeTransport("go", "made-up-model"), null);
});

test("normalizeModelId strips provider prefixes", () => {
  assert.equal(normalizeModelId("opencode-go/kimi-k2.7-code"), "kimi-k2.7-code");
  assert.equal(normalizeModelId("  gpt-5.5  "), "gpt-5.5");
  assert.equal(normalizeModelId(""), null);
});

test("isDirectTransport distinguishes runtime from HTTP transports", () => {
  assert.equal(isDirectTransport(TRANSPORT_KINDS.CHAT_COMPLETIONS), true);
  assert.equal(isDirectTransport(TRANSPORT_KINDS.RESPONSES), true);
  assert.equal(isDirectTransport(TRANSPORT_KINDS.RUNTIME), false);
});

test("listRegisteredModelIds filters direct and runtime catalogs", () => {
  const goDirect = listRegisteredModelIds("go", { directOnly: true });
  const goRuntime = listRegisteredModelIds("go", { runtimeOnly: true });
  assert.ok(goDirect.includes("kimi-k2.7-code"));
  assert.ok(!goDirect.includes("minimax-m3"));
  assert.ok(goRuntime.includes("minimax-m3"));
  assert.ok(!goRuntime.includes("kimi-k2.7-code"));
});

test("toRuntimeModelRef and resolveRuntimeProduct are reversible for Go/Zen", () => {
  assert.equal(toRuntimeModelRef("go", "minimax-m3"), "opencode-go/minimax-m3");
  assert.equal(toRuntimeModelRef("zen", "claude-haiku-4-5"), "opencode/claude-haiku-4-5");
  assert.equal(resolveRuntimeProduct("opencode-go/minimax-m3"), "go");
  assert.equal(resolveRuntimeProduct("opencode/claude-haiku-4-5"), "zen");
});
