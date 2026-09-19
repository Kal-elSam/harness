import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENTITLEMENT,
  classifyClaudeEntitlementResponse,
  probeClaudeModelEntitlement,
  probeClaudeModelEntitlements
} from "../src/global/observability/claude-model-entitlement.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function loadFixture(name) {
  return JSON.parse(await readFile(join(fixturesDir, name), "utf8"));
}

function fakeSpawn({ stdout = "", stderr = "", errorEvent = null, code = 0, signal = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setTimeout(() => {
    if (stdout) child.stdout.emit("data", stdout);
    if (stderr) child.stderr.emit("data", stderr);
    if (errorEvent) child.emit("error", errorEvent);
    else child.emit("close", code, signal);
  }, 0);
  return child;
}

test("classifyClaudeEntitlementResponse marks real Fable credits_required (429) as denied with the CLI's own message", async () => {
  const parsed = await loadFixture("claude-entitlement-denied-fable.json");
  const result = classifyClaudeEntitlementResponse(parsed);
  assert.equal(result.status, ENTITLEMENT.DENIED);
  assert.equal(
    result.reason,
    "Fable 5.1 requires usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue."
  );
});

test("classifyClaudeEntitlementResponse marks real allowed Haiku JSON as allowed", async () => {
  const parsed = await loadFixture("claude-entitlement-allowed-haiku.json");
  const result = classifyClaudeEntitlementResponse(parsed);
  assert.equal(result.status, ENTITLEMENT.ALLOWED);
  assert.equal(result.reason, null);
});

test("classifyClaudeEntitlementResponse marks 529 overload as unverified — never denied", async () => {
  const parsed = await loadFixture("claude-entitlement-overloaded-529.json");
  const result = classifyClaudeEntitlementResponse(parsed);
  assert.equal(result.status, ENTITLEMENT.UNVERIFIED);
  assert.notEqual(result.status, ENTITLEMENT.DENIED);
});

test("classifyClaudeEntitlementResponse returns unverified for invalid or empty payloads", () => {
  assert.equal(classifyClaudeEntitlementResponse(null).status, ENTITLEMENT.UNVERIFIED);
  assert.equal(classifyClaudeEntitlementResponse({}).status, ENTITLEMENT.UNVERIFIED);
  assert.equal(classifyClaudeEntitlementResponse({ is_error: true, api_error_status: 500 }).status, ENTITLEMENT.UNVERIFIED);
});

test("probeClaudeModelEntitlement classifies a denied spawn from the real Fable fixture", async () => {
  const parsed = await loadFixture("claude-entitlement-denied-fable.json");
  const result = await probeClaudeModelEntitlement({
    modelId: "claude-fable-5-1",
    spawn: () => fakeSpawn({ stdout: JSON.stringify(parsed), code: 0 })
  });
  assert.equal(result.modelId, "claude-fable-5-1");
  assert.equal(result.status, ENTITLEMENT.DENIED);
  assert.match(result.reason, /Fable 5\.1 requires usage credits/);
});

test("probeClaudeModelEntitlement classifies an allowed spawn from the real Haiku fixture", async () => {
  const parsed = await loadFixture("claude-entitlement-allowed-haiku.json");
  const result = await probeClaudeModelEntitlement({
    modelId: "claude-haiku-4-5",
    spawn: () => fakeSpawn({ stdout: JSON.stringify(parsed), code: 0 })
  });
  assert.equal(result.status, ENTITLEMENT.ALLOWED);
  assert.equal(result.reason, null);
});

test("probeClaudeModelEntitlement returns unverified on timeout, ENOENT, or broken JSON — never allowed", async () => {
  const timedOut = await probeClaudeModelEntitlement({
    modelId: "claude-opus-5",
    timeoutMs: 5,
    spawn: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      return child;
    }
  });
  assert.equal(timedOut.status, ENTITLEMENT.UNVERIFIED);

  const missing = await probeClaudeModelEntitlement({
    modelId: "claude-opus-5",
    spawn: () => fakeSpawn({ errorEvent: Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }) })
  });
  assert.equal(missing.status, ENTITLEMENT.UNVERIFIED);

  const broken = await probeClaudeModelEntitlement({
    modelId: "claude-opus-5",
    spawn: () => fakeSpawn({ stdout: "not-json{", code: 0 })
  });
  assert.equal(broken.status, ENTITLEMENT.UNVERIFIED);
  assert.notEqual(broken.status, ENTITLEMENT.ALLOWED);
});

test("probeClaudeModelEntitlements runs sequentially in catalog order — never Promise.all", async () => {
  const order = [];
  const allowed = await loadFixture("claude-entitlement-allowed-haiku.json");
  const denied = await loadFixture("claude-entitlement-denied-fable.json");
  const byId = {
    "claude-haiku-4-5": allowed,
    "claude-fable-5-1": denied
  };
  const results = await probeClaudeModelEntitlements({
    modelIds: ["claude-haiku-4-5", "claude-fable-5-1"],
    maxProbes: 12,
    onProgress: ({ modelId }) => order.push(modelId),
    spawn: (_cmd, args) => {
      const modelId = args[args.indexOf("--model") + 1];
      order.push(`spawn:${modelId}`);
      return fakeSpawn({ stdout: JSON.stringify(byId[modelId]), code: 0 });
    }
  });
  assert.deepEqual(order, [
    "spawn:claude-haiku-4-5",
    "claude-haiku-4-5",
    "spawn:claude-fable-5-1",
    "claude-fable-5-1"
  ]);
  assert.equal(results[0].status, ENTITLEMENT.ALLOWED);
  assert.equal(results[1].status, ENTITLEMENT.DENIED);
});

test("probeClaudeModelEntitlement uses the exact measured argv shape", async () => {
  let seenArgs = null;
  const allowed = await loadFixture("claude-entitlement-allowed-haiku.json");
  await probeClaudeModelEntitlement({
    modelId: "claude-haiku-4-5",
    spawn: (_cmd, args) => {
      seenArgs = args;
      return fakeSpawn({ stdout: JSON.stringify(allowed), code: 0 });
    }
  });
  assert.deepEqual(seenArgs, ["-p", "hi", "--model", "claude-haiku-4-5", "--output-format", "json"]);
});
