import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENTITLEMENT,
  TEMPORARY_LIMIT,
  DEFAULT_PROBE_CONCURRENCY,
  ANALYZE_PROBE_TIMEOUT_MS,
  classifyClaudeEntitlementResponse,
  probeClaudeModelEntitlement,
  probeClaudeModelEntitlements
} from "../src/global/observability/claude-model-entitlement.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function loadFixture(name) {
  return JSON.parse(await readFile(join(fixturesDir, name), "utf8"));
}

function fakeSpawn({ stdout = "", stderr = "", errorEvent = null, code = 0, signal = null, delayMs = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setTimeout(() => {
    if (stdout) child.stdout.emit("data", stdout);
    if (stderr) child.stderr.emit("data", stderr);
    if (errorEvent) child.emit("error", errorEvent);
    else child.emit("close", code, signal);
  }, delayMs);
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

test("DEFAULT_PROBE_CONCURRENCY is 2 and ANALYZE_PROBE_TIMEOUT_MS is 20s", () => {
  assert.equal(DEFAULT_PROBE_CONCURRENCY, 2);
  assert.equal(ANALYZE_PROBE_TIMEOUT_MS, 20_000);
});

test("probeClaudeModelEntitlements with concurrency 1 stays sequential in catalog order", async () => {
  const order = [];
  const allowed = await loadFixture("claude-entitlement-allowed-haiku.json");
  const denied = await loadFixture("claude-entitlement-denied-fable.json");
  const byId = {
    "claude-haiku-4-5": allowed,
    "claude-fable-5-1": denied
  };
  const results = await probeClaudeModelEntitlements({
    modelIds: ["claude-haiku-4-5", "claude-fable-5-1"],
    concurrency: 1,
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

test("probeClaudeModelEntitlements caps concurrent in-flight at concurrency 2", async () => {
  const allowed = await loadFixture("claude-entitlement-allowed-haiku.json");
  let inFlight = 0;
  let maxInFlight = 0;
  await probeClaudeModelEntitlements({
    modelIds: ["m1", "m2", "m3", "m4"],
    concurrency: 2,
    spawn: () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setTimeout(() => {
        child.stdout.emit("data", JSON.stringify(allowed));
        child.emit("close", 0, null);
        inFlight -= 1;
      }, 40);
      return child;
    }
  });
  assert.equal(maxInFlight, 2);
});

test("probeClaudeModelEntitlements keeps catalog result order when completions finish out of order", async () => {
  const allowed = await loadFixture("claude-entitlement-allowed-haiku.json");
  const denied = await loadFixture("claude-entitlement-denied-fable.json");
  const progress = [];
  const delays = {
    "claude-haiku-4-5": 60,
    "claude-fable-5-1": 10,
    "claude-opus-5": 30
  };
  const bodies = {
    "claude-haiku-4-5": allowed,
    "claude-fable-5-1": denied,
    "claude-opus-5": allowed
  };
  const results = await probeClaudeModelEntitlements({
    modelIds: ["claude-haiku-4-5", "claude-fable-5-1", "claude-opus-5"],
    concurrency: 2,
    onProgress: ({ modelId, index }) => progress.push({ modelId, index }),
    spawn: (_cmd, args) => {
      const modelId = args[args.indexOf("--model") + 1];
      return fakeSpawn({
        stdout: JSON.stringify(bodies[modelId]),
        code: 0,
        delayMs: delays[modelId]
      });
    }
  });
  assert.deepEqual(results.map((r) => r.modelId), [
    "claude-haiku-4-5",
    "claude-fable-5-1",
    "claude-opus-5"
  ]);
  assert.equal(results[0].status, ENTITLEMENT.ALLOWED);
  assert.equal(results[1].status, ENTITLEMENT.DENIED);
  assert.equal(results[2].status, ENTITLEMENT.ALLOWED);
  // Progress may complete out of catalog order (fast fable before slow haiku).
  assert.ok(progress.length === 3);
  const firstDone = progress[0].modelId;
  assert.ok(firstDone === "claude-fable-5-1" || firstDone === "claude-opus-5" || firstDone === "claude-haiku-4-5");
  assert.notDeepEqual(progress.map((p) => p.modelId), [
    "claude-haiku-4-5",
    "claude-fable-5-1",
    "claude-opus-5"
  ], "with staggered delays, progress should not be strictly sequential");
});

test("probeClaudeModelEntitlements cuts new launches to concurrency 1 after a temporary 429", async () => {
  const allowed = await loadFixture("claude-entitlement-allowed-haiku.json");
  const temporary = {
    type: "result",
    subtype: "error",
    is_error: true,
    api_error_status: 429,
    api_error_code: null,
    result: "Rate limited — try again shortly.",
    retry_after: 30
  };
  const bodies = {
    m1: temporary,
    m2: allowed,
    m3: allowed,
    m4: allowed
  };
  let inFlight = 0;
  let maxAfterTemporary = 0;
  let sawTemporary = false;

  const results = await probeClaudeModelEntitlements({
    modelIds: ["m1", "m2", "m3", "m4"],
    concurrency: 2,
    spawn: (_cmd, args) => {
      const modelId = args[args.indexOf("--model") + 1];
      inFlight += 1;
      if (sawTemporary) maxAfterTemporary = Math.max(maxAfterTemporary, inFlight);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      // m1 finishes first (temporary); peers stay longer so cutover is observable.
      const delayMs = modelId === "m1" ? 10 : 50;
      setTimeout(() => {
        child.stdout.emit("data", JSON.stringify(bodies[modelId]));
        child.emit("close", 0, null);
        if (modelId === "m1") sawTemporary = true;
        inFlight -= 1;
      }, delayMs);
      return child;
    }
  });

  assert.equal(results[0].status, ENTITLEMENT.UNVERIFIED);
  assert.equal(results[0].limit, TEMPORARY_LIMIT);
  assert.ok(sawTemporary);
  assert.equal(maxAfterTemporary, 1, "after temporary 429, only one new probe may be in flight");
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
