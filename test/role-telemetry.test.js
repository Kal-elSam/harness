import test from "node:test";
import assert from "node:assert/strict";
import { MIN_ROLE_RUNS, buildRoleTelemetry, kairoRunToTelemetryRecord, runCostUsd } from "../src/global/intelligence/role-telemetry.js";

const models = [
  { adapterId: "claude", modelId: "opus", priceInputPerMTok: 4, priceOutputPerMTok: 20 },
  { adapterId: "codex", modelId: "terra", priceInputPerMTok: 2, priceOutputPerMTok: 12 },
  { adapterId: "codex", modelId: "unpriced", priceInputPerMTok: null, priceOutputPerMTok: 12 }
];
const run = (role, provider, model, tokens, extra = {}) => ({
  source: "x", provider, model, role, completedAt: "2026-10-19T00:00:00Z", outcome: "completed", tokens, ...extra
});
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));

test("MIN_ROLE_RUNS is the assumed threshold of 5", () => assert.equal(MIN_ROLE_RUNS, 5));

test("runCostUsd: Claude charges cache at the input price", () => {
  const record = { provider: "claude", tokens: { input: 1_000_000, output: 100_000, cacheRead: 500_000, cacheWrite: 500_000 } };
  assert.equal(runCostUsd(record, models[0]), 2_000_000 * 4 / 1e6 + 100_000 * 20 / 1e6);
});

test("runCostUsd: Codex treats cache and reasoning as subsets", () => {
  const record = { provider: "codex", tokens: { input: 1_000_000, output: 100_000, cacheRead: 900_000, cacheWrite: 10, reasoning: 50_000 } };
  assert.equal(runCostUsd(record, models[1]), 1_000_000 * 2 / 1e6 + 100_000 * 12 / 1e6);
});

test("runCostUsd: null when either price is missing", () => {
  assert.equal(runCostUsd({ provider: "codex", tokens: { input: 1, output: 1 } }, models[2]), null);
  assert.equal(runCostUsd({ provider: "codex", tokens: { input: 1, output: 1 } }, { priceInputPerMTok: 1 }), null);
});

test("buildRoleTelemetry: 4 runs ignored, 5 counted, median cost and tokens", () => {
  const make = i => run("Builder", "claude", "opus", { input: (i + 1) * 1_000_000, output: 0, total: (i + 1) * 1_000_000 });
  assert.deepEqual(buildRoleTelemetry(many(4, make), models).roles, {});
  const { roles } = buildRoleTelemetry(many(5, make), models);
  assert.deepEqual([...roles.Builder.keys()], ["claude::opus"]);
  assert.deepEqual(roles.Builder.get("claude::opus"), { runs: 5, medianCostUsd: 12, medianTokens: 3_000_000 });
});

test("buildRoleTelemetry: unattributed, unmatched, unfinished and unpriced records are ignored", () => {
  const tokens = { input: 1000, output: 1000, total: 2000 };
  const records = [
    ...many(5, () => run(null, "claude", "opus", tokens)),
    ...many(5, () => run("Builder", "claude", "ghost", tokens)),
    ...many(5, () => run("Builder", "claude", "opus", tokens, { completedAt: null })),
    ...many(5, () => run("Builder", "codex", "unpriced", tokens))
  ];
  assert.deepEqual(buildRoleTelemetry(records, models), { roles: {}, volumes: null });
});

test("buildRoleTelemetry: measured volumes need two roles and Builder", () => {
  const builder = many(5, () => run("Builder", "claude", "opus", { input: 100, output: 0, total: 1000 }));
  const tester = many(5, () => run("Test Runner", "codex", "terra", { input: 100, output: 0, total: 500 }));
  const reviewer = many(5, () => run("Reviewer", "codex", "terra", { input: 100, output: 0, total: 200 }));
  assert.equal(buildRoleTelemetry(builder, models).volumes, null);
  assert.deepEqual(buildRoleTelemetry([...builder, ...tester], models).volumes, { Builder: 1, "Test Runner": .5 });
  assert.equal(buildRoleTelemetry([...tester, ...reviewer], models).volumes, null);
});

test("kairoRunToTelemetryRecord keeps only terminal attributed metered runs", () => {
  const base = { role: "Builder", model: "opus", provider: "claude", state: "completed", tokenUsage: { input: 10, output: 5, total: 15 } };
  assert.equal(kairoRunToTelemetryRecord(base).tokens.total, 15);
  assert.equal(kairoRunToTelemetryRecord({ ...base, state: "running" }), null);
  assert.equal(kairoRunToTelemetryRecord({ ...base, role: null }), null);
  assert.equal(kairoRunToTelemetryRecord({ ...base, tokenUsage: null }), null);
  assert.equal(kairoRunToTelemetryRecord({ ...base, model: null }), null);
});


test("C7c correction: persisted Kairo provider labels join by agentId and five terminal runs qualify", () => {
  const records = many(5, () => kairoRunToTelemetryRecord({
    agentId: "claude", provider: "Claude Code", role: "Builder", model: "opus",
    state: "completed", tokenUsage: { input: 1000, output: 500, total: 1500 }
  }));
  assert.equal(records[0].provider, "claude");
  assert.equal(buildRoleTelemetry(records, models).roles.Builder?.get("claude::opus")?.runs, 5);
});

test("C7c correction: timestamped sessions without completed outcomes do not qualify", () => {
  for (const outcome of ["unknown", undefined]) {
    const records = many(5, () => run("Builder", "claude", "opus", { input: 10, output: 5, total: 15 }, { outcome }));
    assert.deepEqual(buildRoleTelemetry(records, models), { roles: {}, volumes: null });
  }
});
