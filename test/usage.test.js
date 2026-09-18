import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyUsageTier, createProviderUsageRecord, isProviderExhausted, USAGE_TIERS
} from "../src/global/runtime/usage-types.js";
import { listProviderUsage, readProviderUsage, writeProviderUsage } from "../src/global/runtime/usage-store.js";
import {
  assertProviderNotExhausted, getProviderUsageState, recordProviderUsage
} from "../src/global/runtime/usage-manager.js";

async function harnessHome() {
  return mkdtemp(join(tmpdir(), "kairo-usage-home-"));
}

test("classifyUsageTier: no configured budget is always HEALTHY, regardless of real consumption", () => {
  assert.equal(classifyUsageTier(0, null), USAGE_TIERS.HEALTHY);
  assert.equal(classifyUsageTier(1_000_000, null), USAGE_TIERS.HEALTHY);
});

test("classifyUsageTier: real thresholds against a real configured budget", () => {
  const budget = 1000;
  assert.equal(classifyUsageTier(0, budget), USAGE_TIERS.HEALTHY);
  assert.equal(classifyUsageTier(499, budget), USAGE_TIERS.HEALTHY);
  assert.equal(classifyUsageTier(500, budget), USAGE_TIERS.MODERATE);
  assert.equal(classifyUsageTier(749, budget), USAGE_TIERS.MODERATE);
  assert.equal(classifyUsageTier(750, budget), USAGE_TIERS.CONSERVE);
  assert.equal(classifyUsageTier(899, budget), USAGE_TIERS.CONSERVE);
  assert.equal(classifyUsageTier(900, budget), USAGE_TIERS.CRITICAL);
  assert.equal(classifyUsageTier(999, budget), USAGE_TIERS.CRITICAL);
  assert.equal(classifyUsageTier(1000, budget), USAGE_TIERS.EXHAUSTED);
  assert.equal(classifyUsageTier(5000, budget), USAGE_TIERS.EXHAUSTED);
});

test("isProviderExhausted only true for the EXHAUSTED tier", () => {
  assert.equal(isProviderExhausted(USAGE_TIERS.CRITICAL), false);
  assert.equal(isProviderExhausted(USAGE_TIERS.EXHAUSTED), true);
});

test("usage-store: readProviderUsage returns null for a provider with no real usage yet", async () => {
  const homeDir = await harnessHome();
  assert.equal(await readProviderUsage(homeDir, "codex"), null);
});

test("usage-store: writeProviderUsage persists and readProviderUsage reads back exactly", async () => {
  const homeDir = await harnessHome();
  const record = createProviderUsageRecord("codex");
  await writeProviderUsage(homeDir, "codex", { ...record, totalTokens: 42 });
  const read = await readProviderUsage(homeDir, "codex");
  assert.equal(read.totalTokens, 42);
  assert.equal(read.provider, "codex");
});

test("usage-store: rejects an unknown provider id — the same closed-list defense-in-depth as worktree/task ids", async () => {
  const homeDir = await harnessHome();
  await assert.rejects(() => readProviderUsage(homeDir, "not-a-real-provider"), /Unknown provider/);
  await assert.rejects(() => writeProviderUsage(homeDir, "not-a-real-provider", {}), /Unknown provider/);
});

test("REGRESSION: usage-store accepts opencode-go and opencode-zen as real, distinct usage-tracking providers — they share one real execution adapter object but have genuinely separate budgets (Go subscription vs Zen pay-per-token), so real task runs (which use these ids, never bare 'opencode') must never be rejected here", async () => {
  const homeDir = await harnessHome();
  await writeProviderUsage(homeDir, "opencode-go", { ...createProviderUsageRecord("opencode-go"), totalTokens: 5 });
  await writeProviderUsage(homeDir, "opencode-zen", { ...createProviderUsageRecord("opencode-zen"), totalTokens: 7 });
  assert.equal((await readProviderUsage(homeDir, "opencode-go")).totalTokens, 5);
  assert.equal((await readProviderUsage(homeDir, "opencode-zen")).totalTokens, 7);
  const listed = await listProviderUsage(homeDir);
  assert.deepEqual(new Set(listed.map((r) => r.provider)), new Set(["opencode-go", "opencode-zen"]));
});

test("usage-store: listProviderUsage returns every real persisted provider record", async () => {
  const homeDir = await harnessHome();
  await writeProviderUsage(homeDir, "codex", { ...createProviderUsageRecord("codex"), totalTokens: 10 });
  await writeProviderUsage(homeDir, "claude", { ...createProviderUsageRecord("claude"), totalTokens: 20 });
  const listed = await listProviderUsage(homeDir);
  assert.equal(listed.length, 2);
  assert.deepEqual(new Set(listed.map((r) => r.provider)), new Set(["codex", "claude"]));
});

test("recordProviderUsage accumulates real usage across multiple real runs", async () => {
  const homeDir = await harnessHome();
  await recordProviderUsage(homeDir, "codex", { input: 10, output: 5, total: 15, cost: 0.01 });
  await recordProviderUsage(homeDir, "codex", { input: 20, output: 10, total: 30, cost: 0.02 });

  const record = await readProviderUsage(homeDir, "codex");
  assert.equal(record.totalInputTokens, 30);
  assert.equal(record.totalOutputTokens, 15);
  assert.equal(record.totalTokens, 45);
  assert.equal(record.runCount, 2);
  assert.ok(Math.abs(record.totalCost - 0.03) < 1e-9);
});

test("recordProviderUsage skips entirely when a run has no real usage data at all", async () => {
  const homeDir = await harnessHome();
  const result = await recordProviderUsage(homeDir, "codex", { input: null, output: null, total: null, cost: null });
  assert.equal(result, null);
  assert.equal(await readProviderUsage(homeDir, "codex"), null, "no real consumption means no record is ever created");
});

test("getProviderUsageState: HEALTHY with no real consumption yet and no configured budget", async () => {
  const homeDir = await harnessHome();
  const state = await getProviderUsageState({ homeDir, provider: "codex" });
  assert.equal(state.tier, USAGE_TIERS.HEALTHY);
  assert.equal(state.consumedTokens, 0);
  assert.equal(state.budgetTokens, null);
});

test("getProviderUsageState: resolves the budget from profile.providerTokenBudgets for that exact provider only", async () => {
  const homeDir = await harnessHome();
  await recordProviderUsage(homeDir, "codex", { total: 950, cost: null });
  const profile = { providerTokenBudgets: { codex: 1000, claude: 5000 } };

  const codexState = await getProviderUsageState({ homeDir, provider: "codex", profile });
  assert.equal(codexState.tier, USAGE_TIERS.CRITICAL);

  const claudeState = await getProviderUsageState({ homeDir, provider: "claude", profile });
  assert.equal(claudeState.tier, USAGE_TIERS.HEALTHY, "claude has its own budget and zero real consumption — codex's usage must never bleed into it");
});

test("assertProviderNotExhausted allows a run through under every tier except EXHAUSTED", async () => {
  const homeDir = await harnessHome();
  await recordProviderUsage(homeDir, "codex", { total: 950, cost: null });
  const profile = { providerTokenBudgets: { codex: 1000 } };
  const state = await assertProviderNotExhausted({ homeDir, provider: "codex", profile });
  assert.equal(state.tier, USAGE_TIERS.CRITICAL);
});

test("assertProviderNotExhausted rejects once real cumulative consumption reaches the configured budget", async () => {
  const homeDir = await harnessHome();
  await recordProviderUsage(homeDir, "codex", { total: 1000, cost: null });
  const profile = { providerTokenBudgets: { codex: 1000 } };

  await assert.rejects(
    () => assertProviderNotExhausted({ homeDir, provider: "codex", profile }),
    /exhausted its configured token budget/
  );
});
