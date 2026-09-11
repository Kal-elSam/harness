import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { normalizeOpenCodeGoUsage, parseOpenCodeStats, readOpenCodeUsage } from "../src/global/observability/opencode-usage.js";

function childWithOutput(output) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => {};
  process.nextTick(() => { child.stdout.emit("data", output); child.emit("close"); });
  return child;
}

test("normalizes measured Go usage and rate-limited windows", () => {
  const value = normalizeOpenCodeGoUsage({ usage: {
    rolling: { status: "ok", percent: 6, resetsAt: "2030-01-01T00:00:00Z" },
    weekly: { status: "ok", percent: 24, resetsAt: "2030-01-02T00:00:00Z" },
    monthly: { status: "rate-limited", percent: 140, resetsAt: "2030-01-03T00:00:00Z" }
  } });
  assert.equal(value.status, "rate-limited");
  assert.equal(value.primary.remainingPercent, 94);
  assert.equal(value.monthly.usedPercent, 100);
});

test("Go auth is read-only and secrets never appear in errors", async () => {
  let request;
  const value = await readOpenCodeUsage({
    authPath: "/auth.json",
    readFile: async () => JSON.stringify({ opencode: { type: "api", key: "OTHER" }, "opencode-go": { type: "api", key: "SECRET_KEY" } }),
    fetchImpl: async (_url, options) => {
      request = options;
      return { ok: true, json: async () => ({ usage: { rolling: { status: "ok", percent: 0 } } }) };
    },
    spawn: () => childWithOutput("no opencode-go rows\n")
  });
  assert.match(request.headers.Authorization, /SECRET_KEY/);
  assert.equal(value.go.status, "measured");
  assert.equal(value.zen.status, "unknown");
});

test("missing auth and HTTP failure are unknown without leaking credentials", async () => {
  const value = await readOpenCodeUsage({
    readFile: async () => { throw Object.assign(new Error("x SECRET_KEY"), { code: "ENOENT" }); },
    fetchImpl: async () => { throw new Error("SECRET_KEY"); },
    spawn: () => childWithOutput("opencode-go/x $0.02 123 tokens\n")
  });
  assert.equal(value.go.status, "unknown");
  assert.doesNotMatch(value.go.error, /SECRET_KEY/);
});

test("stats parser only includes opencode-go and labels local history as non-billing", () => {
  const value = parseOpenCodeStats("│ opencode/qwen\n│  Input Tokens 123\n│  Output Tokens 10\n│  Cost $0.02\n│ opencode-go/other\n│  Input Tokens 999\n│  Output Tokens 1\n│  Cost $9.99\n");
  assert.equal(value.status, "local_recorded");
  assert.equal(value.totalTokens, 133);
  assert.equal(value.totalCost, 0.02);
  assert.equal(value.billing, "PAYG");
  assert.equal(value.kairoPolicy, "PAYG blocked");
});

test("parses realistic multiline stats, ANSI, and excludes Go from Zen totals", () => {
  const value = parseOpenCodeStats("\u001b[90m│ opencode/qwen3.8-max\u001b[0m\n│  Messages 76\n│  Input Tokens 524.5K\n│  Output Tokens 60.2K\n│  Cache Read 6.5M\n│  Cost $3.0427\n│ opencode-go/qwen3.8-max\n│  Input Tokens 1M\n│  Output Tokens 2K\n│  Cost $88.00\n");
  assert.equal(value.status, "local_recorded");
  assert.equal(value.totalTokens, 7084700);
  assert.equal(value.totalCost, 3.0427);
  assert.equal(value.goRecords.length, 1);
});

test("malformed stats are unknown", () => {
  assert.equal(parseOpenCodeStats("garbage"), null);
});
