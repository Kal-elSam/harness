import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadKairoWorkspaceSnapshot } from "../src/global/host/workspace-snapshot.js";
import { readCachedAvailability, writeCachedAvailability } from "../src/global/host/workspace-cache.js";
import { mergeEntitlementResults, writeClaudeEntitlementCache } from "../src/global/observability/claude-entitlement-store.js";

const MODEL_ID = "claude-opus-5-5";
const OLD = "2026-10-14T22:52:38Z";
const NEW = "2026-10-21T22:53:35Z";
const NOW = Date.parse("2026-10-21T22:56:00Z");
const MODEL = { adapterId: "claude", modelId: MODEL_ID, displayName: "Claude Opus 5.5" };
const AUTH = { subscriptionType: "max", accountIdentifier: "test-account" };
const stale = () => ({
  eligibility: { claude: { ok: true } }, cursorAccess: {},
  claudeEntitlement: { [MODEL_ID]: { status: "unverified", reason: "stale", age: "7d", probedAt: OLD } }
});
const fresh = () => ({ ...stale(), claudeEntitlement: {
  [MODEL_ID]: { status: "allowed", reason: null, age: "<1h", probedAt: NEW }
} });

async function setup(t) {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-availability-refresh-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const cwd = join(homeDir, "project");
  const deps = {
    resolveHomeDir: () => homeDir, resolveProjectRoot: async () => cwd,
    readProjectStrategy: async () => ({ status: "active", bootstrapAnalyst: MODEL, orchestrator: MODEL,
      projectTeam: [{ role: "Builder", model: MODEL }] }),
    listProviderUsage: async () => [], inspectEngramIntegration: () => ({ status: "unknown" }),
    readWork: async () => null, verifyClaudeSubscriptionAuth: async () => AUTH, now: () => NOW
  };
  await writeCachedAvailability(homeDir, cwd, stale(), { now: () => Date.parse(OLD) });
  return { homeDir, cwd, deps };
}

function assertUsable(snapshot) {
  assert.ok(snapshot.team.rows.every((row) => row.availability.state === "available"));
  assert.equal(snapshot.team.assignments[0].availability.label, "usable");
}

test("newer entitlement probe replaces stale first-paint rows and persisted availability", async (t) => {
  const { homeDir, cwd, deps } = await setup(t);
  await writeClaudeEntitlementCache(homeDir, mergeEntitlementResults(null, {
    ...AUTH, results: [{ modelId: MODEL_ID, status: "allowed", probedAt: NEW }]
  }));
  const snapshot = await loadKairoWorkspaceSnapshot({ cwd }, deps);
  const persisted = await readCachedAvailability(homeDir, cwd);
  assertUsable(snapshot);
  assert.equal(persisted.value.claudeEntitlement[MODEL_ID].status, "allowed");
  assert.equal(persisted.value.claudeEntitlement[MODEL_ID].probedAt, NEW);
});

test("without a newer probe cached availability remains the first paint without auth work", async (t) => {
  const { homeDir, cwd, deps } = await setup(t);
  deps.verifyClaudeSubscriptionAuth = async () => { assert.fail("first paint must not run auth without newer evidence"); };
  const before = await readCachedAvailability(homeDir, cwd);
  const snapshot = await loadKairoWorkspaceSnapshot({ cwd }, deps);
  assert.equal(snapshot.team.cached, true);
  assert.ok(snapshot.team.rows.every((row) => row.availability.state === "blocked"));
  assert.equal(snapshot.team.assignments[0].availability.label, "bloqueado");
  assert.deepEqual(await readCachedAvailability(homeDir, cwd), before);
});

test("a live availability result still replaces the stale cache", async (t) => {
  const { homeDir, cwd, deps } = await setup(t);
  assertUsable(await loadKairoWorkspaceSnapshot({ cwd, availabilityIntelligence: fresh() }, deps));
  assert.deepEqual((await readCachedAvailability(homeDir, cwd)).value, fresh());
});

test("older supplied intelligence and an explicit old cache cannot override a newer persisted probe", async (t) => {
  const { homeDir, cwd, deps } = await setup(t);
  const oldCache = await readCachedAvailability(homeDir, cwd);
  await writeCachedAvailability(homeDir, cwd, fresh(), { now: () => NOW });
  assertUsable(await loadKairoWorkspaceSnapshot({ cwd, availabilityCache: oldCache }, deps));
  assertUsable(await loadKairoWorkspaceSnapshot({ cwd, availabilityIntelligence: stale() }, deps));
  assert.equal((await readCachedAvailability(homeDir, cwd)).value.claudeEntitlement[MODEL_ID].probedAt, NEW);
});

test("newer entitlement evidence from another account does not unlock cached rows", async (t) => {
  const { homeDir, cwd, deps } = await setup(t);
  await writeClaudeEntitlementCache(homeDir, mergeEntitlementResults(null, {
    subscriptionType: "max", accountIdentifier: "another-account",
    results: [{ modelId: MODEL_ID, status: "allowed", probedAt: NEW }]
  }));
  const snapshot = await loadKairoWorkspaceSnapshot({ cwd }, deps);
  assert.ok(snapshot.team.rows.every((row) => row.availability.state === "blocked"));
  assert.equal((await readCachedAvailability(homeDir, cwd)).value.claudeEntitlement[MODEL_ID].status, "unverified");
});

test("cached allowed evidence cannot override a live account-invalidated entitlement", async (t) => {
  const { homeDir, cwd, deps } = await setup(t);
  await writeCachedAvailability(homeDir, cwd, fresh(), { now: () => NOW });
  const live = { ...stale(), claudeEntitlement: {
    [MODEL_ID]: { status: "unverified", reason: null, age: null, probedAt: null }
  } };
  const snapshot = await loadKairoWorkspaceSnapshot({ cwd, availabilityIntelligence: live }, deps);
  assert.ok(snapshot.team.rows.every((row) => row.availability.state === "blocked"));
  assert.deepEqual((await readCachedAvailability(homeDir, cwd)).value, live);
});

test("a later cache write timestamp cannot hide an explicit cache's newer probe", async (t) => {
  const { homeDir, cwd, deps } = await setup(t);
  await writeCachedAvailability(homeDir, cwd, stale(), { now: () => NOW });
  const snapshot = await loadKairoWorkspaceSnapshot({ cwd,
    availabilityCache: { value: fresh(), savedAt: Date.parse(OLD) }
  }, deps);
  assertUsable(snapshot);
  assert.equal((await readCachedAvailability(homeDir, cwd)).value.claudeEntitlement[MODEL_ID].probedAt, NEW);
});
