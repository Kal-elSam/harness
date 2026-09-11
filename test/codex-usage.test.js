import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { normalizeCodexRateLimits, readCodexUsage } from "../src/global/observability/codex-usage.js";

function fakeSpawn({ response, malformed = false, close = false, delay = 0, seenIds = [] } = {}) {
  const stdout = new EventEmitter();
  const child = new EventEmitter();
  child.stdout = stdout;
  child.stdin = {
    write(raw) {
      const request = JSON.parse(raw);
      seenIds.push(request.id);
      if (malformed) return stdout.emit("data", "not-json\n");
      if (request.method === "initialize") {
        stdout.emit("data", `${JSON.stringify({ method: "initialized" })}\n`);
        setTimeout(() => stdout.emit("data", `${JSON.stringify({ id: request.id, result: {} })}\n`), delay);
      } else if (request.method === "account/rateLimits/read") {
        assert.deepEqual(request.params, {
          excludeResetCreditDetails: true,
          supportsLunaReserve: false
        });
        setTimeout(() => stdout.emit("data", `${JSON.stringify({ id: request.id, result: response })}\n`), delay);
      }
    }
  };
  child.kill = () => { if (close) child.emit("close"); };
  return child;
}

test("reads measured primary and weekly windows without exposing account fields", async () => {
  const result = await readCodexUsage({
    spawn: () => fakeSpawn({ response: {
      ordinaryUsageAllowed: true,
      accountId: "must-not-leak",
      rateLimits: {
        primary: { usedPercent: 6, windowDurationMins: 300, resetsAt: 1789173666 },
        secondary: { usedPercent: 24, windowDurationMins: 10080, resetsAt: 1789173666 }
      }
    } })
  });
  assert.equal(result.status, "measured");
  assert.equal(result.primary.remainingPercent, 94);
  assert.equal(result.secondary.remainingPercent, 76);
  assert.equal(result.primary.windowDurationMins, 300);
  assert.equal(result.primary.resetsAt, 1789173666);
  assert.equal(result.primary.resetsAtIso, new Date(1789173666 * 1000).toISOString());
  assert.equal(result.source, "codex app-server account/rateLimits/read");
  assert.equal("accountId" in result, false);
});

test("ordinaryUsageAllowed false is authoritative and out-of-order notifications are ignored", async () => {
  const seenIds = [];
  const result = await readCodexUsage({
    spawn: () => fakeSpawn({ seenIds, response: {
      ordinaryUsageAllowed: false,
      rateLimits: { primary: { usedPercent: 140 } }
    } })
  });
  assert.equal(result.status, "exhausted");
  assert.equal(result.ordinaryUsageAllowed, false);
  assert.equal(result.primary.usedPercent, 100);
  assert.deepEqual(seenIds, [1, 2]);
});

test("malformed output and timeout fail closed", async () => {
  const malformed = await readCodexUsage({ spawn: () => fakeSpawn({ malformed: true }) });
  assert.equal(malformed.status, "unknown");
  const timedOut = await readCodexUsage({ spawn: () => fakeSpawn({ delay: 100 }), timeoutMs: 5 });
  assert.equal(timedOut.status, "unknown");
});

test("normalizer clamps percentages and rejects empty responses", () => {
  const normalized = normalizeCodexRateLimits({ rateLimits: {
    primary: { usedPercent: -4 }, secondary: { usedPercent: 150 }
  } });
  assert.equal(normalized.primary.usedPercent, 0);
  assert.equal(normalized.secondary.usedPercent, 100);
  assert.equal(normalizeCodexRateLimits({}), null);
});

test("invalid epoch ranges are safe and unusable successful responses become unknown", async () => {
  const normalized = normalizeCodexRateLimits({
    ordinaryUsageAllowed: true,
    rateLimits: { primary: { usedPercent: 1, resetsAt: Number.MAX_VALUE } }
  });
  assert.equal(normalized.primary.resetsAtIso, null);
  const result = await readCodexUsage({ spawn: () => fakeSpawn({ response: {} }) });
  assert.equal(result.status, "unknown");
  assert.match(result.error, /unusable rate limits/);
});
