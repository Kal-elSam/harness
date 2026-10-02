import assert from "node:assert/strict";
import { test } from "node:test";
import { createConversationService } from "../src/global/conversation/service.js";
import {
  ENTITLEMENT,
  ANALYZE_PROBE_TIMEOUT_MS
} from "../src/global/observability/claude-model-entitlement.js";

// T23: discovery never probes; verification is an explicit, confirmed,
// deduplicated entry point. Every provider call is a spy/fake here.

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const FRESH = iso(-60_000);
const STALE = iso(-60 * 60_000);
const VERY_STALE = iso(-90 * 24 * 60 * 60_000);

const AA = {
  status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
  models: [
    { slug: "composer-2.5", name: "Composer 2.5", intelligenceIndex: 90, codingIndex: 95, mathIndex: null },
    { slug: "gpt-5.3-codex", name: "Codex 5.3", intelligenceIndex: 80, codingIndex: 85, mathIndex: null }
  ]
};

function harness({
  claudeModels = [{ id: "claude-a", displayName: "Claude A" }, { id: "claude-b", displayName: "Claude B" }],
  cursorModels = [
    { id: "composer-2.5", displayName: "Composer 2.5" },
    { id: "composer-3", displayName: "Composer 3" },
    { id: "gpt-5.3-codex", displayName: "Codex 5.3" },
    { id: "gpt-5.4", displayName: "GPT 5.4" }
  ],
  claudeCache = null,
  cursorCache = null,
  adapters = ["claude", "cursor"],
  claudeProbe = async ({ modelIds }) => modelIds.map((modelId) => ({ modelId, status: ENTITLEMENT.ALLOWED, reason: null, probedAt: iso(0) })),
  cursorProbe = async ({ pool }) => ({ pool, status: "available", reason: null, probedAt: iso(0) })
} = {}) {
  const calls = { claude: [], cursor: [] };
  const writes = { claude: [], cursor: [] };
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    now: () => NOW,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => adapters.map((id) => ({ id, available: true, launchable: true, reason: null })),
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => claudeCache,
    writeClaudeEntitlementCache: async (_home, doc) => { writes.claude.push(doc); },
    readCursorAccessCache: async () => cursorCache,
    writeCursorAccessCache: async (_home, doc) => { writes.cursor.push(doc); },
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: claudeModels }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: cursorModels }),
    probeClaudeModelEntitlements: async (args) => {
      calls.claude.push(args.modelIds);
      return claudeProbe(args);
    },
    probeCursorPoolAccess: async (args) => {
      calls.cursor.push({ pool: args.pool, modelId: args.modelId });
      return cursorProbe(args);
    },
    readArtificialAnalysisModels: async () => AA,
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });
  return { service, calls, writes };
}

const cursorCacheDoc = (entries) => ({ fetchedAt: FRESH, pools: entries });
const claudeCacheDoc = (models) => ({ fetchedAt: FRESH, subscriptionType: "pro", models });

test("snapshot, preflight (full and catalog) never spawn a Claude or Cursor probe, even with missing caches", async () => {
  const { service, calls } = harness();
  await service.snapshot({ cwd: "/repo" });
  await service.preflightProject({ cwd: "/repo", mode: "catalog" });
  await service.preflightProject({ cwd: "/repo" });
  assert.deepEqual(calls, { claude: [], cursor: [] });
});

test("fresh cached Cursor evidence is reused as-is: no probe, real status projected", async () => {
  const { service, calls } = harness({
    cursorCache: cursorCacheDoc({
      cursor_models: { status: "available", reason: null, probedAt: FRESH },
      other_models: { status: "exhausted", reason: "usage limit", probedAt: FRESH }
    })
  });
  const snap = await service.snapshot({ cwd: "/repo" });
  assert.equal(snap.modelIntelligence.cursorAccess.cursor_models.status, "available");
  assert.equal(snap.modelIntelligence.cursorAccess.other_models.status, "exhausted");
  assert.equal(snap.modelIntelligence.modelEntitlement.cursor["composer-2.5"].status, ENTITLEMENT.ALLOWED);
  assert.equal(snap.modelIntelligence.modelEntitlement.cursor["gpt-5.4"].status, ENTITLEMENT.DENIED);
  assert.deepEqual(calls.cursor, []);
});

test("stale cached Cursor evidence is unverified with reason 'stale', never allowed, and never probed on discovery", async () => {
  const { service, calls } = harness({
    cursorCache: cursorCacheDoc({ cursor_models: { status: "available", reason: null, probedAt: VERY_STALE } })
  });
  const snap = await service.snapshot({ cwd: "/repo" });
  assert.equal(snap.modelIntelligence.cursorAccess.cursor_models.status, "unverified");
  assert.equal(snap.modelIntelligence.cursorAccess.cursor_models.reason, "stale");
  assert.equal(snap.modelIntelligence.modelEntitlement.cursor["composer-2.5"].status, ENTITLEMENT.UNVERIFIED);
  assert.deepEqual(calls.cursor, []);
});

test("planAccessVerification: Cursor is one check per POOL (deduplicated), Claude one per MODEL, reusable evidence listed, nothing probed", async () => {
  const { service, calls } = harness({
    claudeCache: claudeCacheDoc({ "claude-a": { status: "allowed", reason: null, probedAt: FRESH } }),
    cursorCache: cursorCacheDoc({ other_models: { status: "available", reason: null, probedAt: FRESH } })
  });
  const plan = await service.planAccessVerification({ cwd: "/repo" });
  assert.deepEqual(calls, { claude: [], cursor: [] });
  assert.equal(plan.mayConsumeQuota, true);
  assert.equal(plan.pendingCount, 2, "claude-b (model) + cursor_models (pool)");
  assert.equal(plan.reusableCount, 2, "claude-a + other_models are fresh");
  const claude = plan.subscriptions.find((s) => s.adapterId === "claude");
  const cursor = plan.subscriptions.find((s) => s.adapterId === "cursor");
  assert.equal(claude.granularity, "model");
  assert.deepEqual(claude.checks.map((c) => [c.modelId, c.state]), [["claude-a", "reusable"], ["claude-b", "pending"]]);
  assert.equal(cursor.granularity, "pool");
  assert.equal(cursor.checks.length, 2, "4 Cursor models collapse to 2 pool checks");
  assert.deepEqual(cursor.checks.map((c) => [c.pool, c.state]), [["cursor_models", "pending"], ["other_models", "reusable"]]);
  assert.equal(cursor.checks.find((c) => c.pool === "cursor_models").modelId, "composer-2.5", "a real representative model of the pool");
  assert.equal(cursor.checks.find((c) => c.pool === "other_models").cachedStatus, "allowed");
});

test("planAccessVerification marks stale evidence pending with reason 'stale' and never-verified with 'never_verified'", async () => {
  const { service } = harness({
    claudeCache: claudeCacheDoc({ "claude-a": { status: "allowed", reason: null, probedAt: VERY_STALE } }),
    cursorCache: null
  });
  const plan = await service.planAccessVerification({ cwd: "/repo" });
  const claude = plan.subscriptions.find((s) => s.adapterId === "claude");
  assert.equal(claude.checks.find((c) => c.modelId === "claude-a").reason, "stale");
  assert.equal(claude.checks.find((c) => c.modelId === "claude-b").reason, "never_verified");
});

test("planAccessVerification with everything fresh has no pending checks and no quota flag", async () => {
  const { service } = harness({
    claudeCache: claudeCacheDoc({
      "claude-a": { status: "allowed", reason: null, probedAt: FRESH },
      "claude-b": { status: "denied", reason: "credits_required", probedAt: FRESH }
    }),
    cursorCache: cursorCacheDoc({
      cursor_models: { status: "available", reason: null, probedAt: FRESH },
      other_models: { status: "available", reason: null, probedAt: FRESH }
    })
  });
  const plan = await service.planAccessVerification({ cwd: "/repo" });
  assert.equal(plan.pendingCount, 0);
  assert.equal(plan.mayConsumeQuota, false);
  assert.equal(plan.reusableCount, 4);
});

test("an adapter that is not usable at all contributes no verification checks", async () => {
  const { service } = harness({ adapters: ["cursor"] });
  const plan = await service.planAccessVerification({ cwd: "/repo" });
  assert.equal(plan.subscriptions.some((s) => s.adapterId === "claude"), false);
});

test("preflightProject exposes the same plan additively as verificationPlan", async () => {
  const { service, calls } = harness();
  const preflight = await service.preflightProject({ cwd: "/repo", mode: "catalog" });
  assert.equal(preflight.verificationPlan.pendingCount, 4);
  assert.deepEqual(calls, { claude: [], cursor: [] });
});

test("verifyAccess without confirmed === true refuses: no probe, no write", async () => {
  const { service, calls, writes } = harness();
  for (const confirmed of [undefined, false, "yes", 1]) {
    const result = await service.verifyAccess({ cwd: "/repo", confirmed });
    assert.equal(result.ran, false);
    assert.equal(result.status, "confirmation_required");
  }
  assert.deepEqual(calls, { claude: [], cursor: [] });
  assert.deepEqual(writes, { claude: [], cursor: [] });
});

test("verifyAccess runs each pending check at most once (Cursor per pool, Claude per model), skips reusable evidence, persists real results", async () => {
  const { service, calls, writes } = harness({
    claudeCache: claudeCacheDoc({ "claude-a": { status: "allowed", reason: null, probedAt: FRESH } }),
    cursorCache: cursorCacheDoc({ other_models: { status: "available", reason: null, probedAt: FRESH } })
  });
  const result = await service.verifyAccess({ cwd: "/repo", confirmed: true });
  assert.equal(result.ran, true);
  assert.deepEqual(calls.claude, [["claude-b"]]);
  assert.deepEqual(calls.cursor, [{ pool: "cursor_models", modelId: "composer-2.5" }]);
  assert.equal(writes.claude.length, 1);
  assert.equal(writes.cursor.length, 1);
  const cursor = result.outcomes.find((o) => o.adapterId === "cursor");
  assert.deepEqual(cursor.results.map((r) => [r.id, r.status]), [["cursor::cursor_models", "allowed"]]);
  const claude = result.outcomes.find((o) => o.adapterId === "claude");
  assert.deepEqual(claude.results.map((r) => [r.id, r.status]), [["claude::claude-b", "allowed"]]);
});

test("verifyAccess reports denied and unverified-with-real-reason per subscription, persists only real allowed/denied, never invents", async () => {
  const { service, writes } = harness({
    claudeProbe: async ({ modelIds }) => modelIds.map((modelId) => (
      modelId === "claude-a"
        ? { modelId, status: ENTITLEMENT.DENIED, reason: "credits_required", probedAt: iso(0) }
        : { modelId, status: ENTITLEMENT.UNVERIFIED, reason: "probe timed out after 30000ms", probedAt: iso(0) }
    )),
    cursorProbe: async ({ pool }) => ({ pool, status: "unverified", reason: "login required", probedAt: iso(0) })
  });
  const result = await service.verifyAccess({ cwd: "/repo", confirmed: true });
  const claude = result.outcomes.find((o) => o.adapterId === "claude");
  assert.deepEqual(claude.results.map((r) => [r.id, r.status, r.reason]), [
    ["claude::claude-a", "denied", "credits_required"],
    ["claude::claude-b", "unverified", "probe timed out after 30000ms"]
  ]);
  const cursor = result.outcomes.find((o) => o.adapterId === "cursor");
  assert.ok(cursor.results.every((r) => r.status === "unverified" && r.reason === "login required"));
  assert.equal(writes.cursor.length, 1, "unverified Cursor attempts are persisted with a short TTL");
  assert.equal(writes.claude.length, 1);
  assert.deepEqual(Object.keys(writes.claude[0].models).sort(), ["claude-a", "claude-b"], "denied and unverified attempts both reach the cache");
});

test("after an all-unverified sweep the next planAccessVerification has pendingCount 0 until TTL expires", async () => {
  let claudeCache = null;
  const stateful = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    now: () => NOW,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => claudeCache,
    writeClaudeEntitlementCache: async (_home, doc) => { claudeCache = doc; },
    readCursorAccessCache: async () => null,
    writeCursorAccessCache: async () => {},
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [{ id: "claude-a", displayName: "Claude A" }] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [] }),
    probeClaudeModelEntitlements: async ({ modelIds }) => modelIds.map((modelId) => ({
      modelId, status: ENTITLEMENT.UNVERIFIED, reason: "probe timed out after 30000ms", probedAt: iso(0)
    })),
    probeCursorPoolAccess: async () => ({ pool: "cursor_models", status: "unverified", reason: "timeout", probedAt: iso(0) }),
    readArtificialAnalysisModels: async () => AA,
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });
  assert.equal((await stateful.planAccessVerification({ cwd: "/repo" })).pendingCount, 1);
  await stateful.verifyAccess({ cwd: "/repo", confirmed: true });
  const after = await stateful.planAccessVerification({ cwd: "/repo" });
  assert.equal(after.pendingCount, 0, "recent unverified attempts are reused, not re-probed");
  assert.equal(after.mayConsumeQuota, false);
});

test("verifyAccess turns a thrown probe into unverified with the real reason and keeps going", async () => {
  const { service, calls } = harness({
    claudeProbe: async () => { throw new Error("spawn EACCES"); }
  });
  const result = await service.verifyAccess({ cwd: "/repo", confirmed: true });
  const claude = result.outcomes.find((o) => o.adapterId === "claude");
  assert.ok(claude.results.every((r) => r.status === "unverified" && /EACCES/.test(r.reason)));
  assert.equal(calls.cursor.length, 2, "the other subscription is still verified");
});

test("after verification the next preflight sees the persisted evidence and still spawns nothing", async () => {
  let claudeCache = null;
  let cursorCache = null;
  const { service, calls } = harness({});
  // Wire a stateful cache via a fresh service that shares store fakes.
  const stateful = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    now: () => NOW,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }, { id: "cursor", available: true, launchable: true, reason: null }],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => claudeCache,
    writeClaudeEntitlementCache: async (_home, doc) => { claudeCache = doc; },
    readCursorAccessCache: async () => cursorCache,
    writeCursorAccessCache: async (_home, doc) => { cursorCache = doc; },
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [{ id: "claude-a", displayName: "Claude A" }] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] }),
    probeClaudeModelEntitlements: async ({ modelIds }) => modelIds.map((modelId) => ({ modelId, status: ENTITLEMENT.ALLOWED, reason: null, probedAt: iso(0) })),
    probeCursorPoolAccess: async ({ pool }) => ({ pool, status: "available", reason: null, probedAt: iso(0) }),
    readArtificialAnalysisModels: async () => AA,
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });
  assert.equal((await stateful.planAccessVerification({ cwd: "/repo" })).pendingCount, 2);
  await stateful.verifyAccess({ cwd: "/repo", confirmed: true });
  const after = await stateful.planAccessVerification({ cwd: "/repo" });
  assert.equal(after.pendingCount, 0, "verified evidence is reused, not re-requested");
  assert.equal(after.mayConsumeQuota, false);
  assert.deepEqual(calls, { claude: [], cursor: [] }, "the unrelated first harness never ran anything");
  void service;
});

test("verifyAccess scope=analyze runs only Claude pending checks — Cursor pools stay for Settings/snapshot", async () => {
  const { service, calls } = harness({
    claudeCache: claudeCacheDoc({ "claude-a": { status: "allowed", reason: null, probedAt: FRESH } }),
    cursorCache: null
  });
  const events = [];
  const result = await service.verifyAccess({
    cwd: "/repo",
    confirmed: true,
    scope: "analyze",
    onProgress: (event) => events.push(structuredClone(event))
  });
  assert.equal(result.ran, true);
  assert.deepEqual(calls.claude, [["claude-b"]], "exactly one Claude model probe");
  assert.deepEqual(calls.cursor, [], "analyze scope must not probe Cursor pools");
  assert.ok(events.every((event) => event.total === 1), "progress total matches the consented Claude-only plan");
  assert.equal(events.at(-1)?.completed, 1);
  assert.ok(events.every((event) => (event.active ?? []).every((a) => a.adapterId === "claude")));
  assert.ok(!result.outcomes.some((o) => o.adapterId === "cursor"));
  const claude = result.outcomes.find((o) => o.adapterId === "claude");
  assert.deepEqual(claude.results.map((r) => [r.id, r.status]), [["claude::claude-b", "allowed"]]);
});

test("verifyAccess scope=analyze passes ANALYZE_PROBE_TIMEOUT_MS to Claude probes", async () => {
  let seenTimeout = "unset";
  const { service, calls } = harness({
    claudeCache: null,
    cursorCache: cursorCacheDoc({
      cursor_models: { status: "available", reason: null, probedAt: FRESH },
      other_models: { status: "available", reason: null, probedAt: FRESH }
    }),
    claudeProbe: async (args) => {
      seenTimeout = args.timeoutMs;
      return args.modelIds.map((modelId) => ({
        modelId, status: ENTITLEMENT.ALLOWED, reason: null, probedAt: iso(0)
      }));
    }
  });
  await service.verifyAccess({ cwd: "/repo", confirmed: true, scope: "analyze" });
  assert.ok(calls.claude.length >= 1);
  assert.equal(seenTimeout, ANALYZE_PROBE_TIMEOUT_MS);
});

test("verifyAccess without analyze scope does not override Claude probe timeout", async () => {
  let seenTimeout = "unset";
  const { service } = harness({
    claudeCache: null,
    cursorCache: cursorCacheDoc({
      cursor_models: { status: "available", reason: null, probedAt: FRESH },
      other_models: { status: "available", reason: null, probedAt: FRESH }
    }),
    claudeProbe: async (args) => {
      seenTimeout = args.timeoutMs;
      return args.modelIds.map((modelId) => ({
        modelId, status: ENTITLEMENT.ALLOWED, reason: null, probedAt: iso(0)
      }));
    }
  });
  await service.verifyAccess({ cwd: "/repo", confirmed: true });
  assert.equal(seenTimeout, undefined);
});

test("verifyAccess without scope still probes Cursor (Settings / full consent path)", async () => {
  const { service, calls } = harness({
    claudeCache: claudeCacheDoc({ "claude-a": { status: "allowed", reason: null, probedAt: FRESH } }),
    cursorCache: null
  });
  await service.verifyAccess({ cwd: "/repo", confirmed: true });
  assert.deepEqual(calls.claude, [["claude-b"]]);
  assert.equal(calls.cursor.length, 2);
});

// ---- T24: progress records while a consented verification runs ----

test("verifyAccess reports progress: completed/total plus the active check label; reusable evidence is not counted", async () => {
  const { service } = harness({
    claudeCache: claudeCacheDoc({ "claude-a": { status: "allowed", reason: null, probedAt: FRESH } })
  });
  const events = [];
  await service.verifyAccess({ cwd: "/repo", confirmed: true, onProgress: (event) => events.push(structuredClone(event)) });
  assert.ok(events.length >= 4, "a start event plus one per finished check");
  assert.ok(events.every((event) => event.total === 3), "1 pending Claude model + 2 Cursor pools; the reusable Claude check is not a call");
  assert.deepEqual(events[0], {
    completed: 0, total: 3,
    active: [{ id: "claude::claude-b", label: "Claude B", adapterId: "claude", provider: "Claude" }],
    done: null
  });
  const completed = events.map((event) => event.completed);
  assert.deepEqual([...completed].sort((a, b) => a - b), completed, "completed never goes backwards");
  assert.equal(events.at(-1).completed, 3);
  assert.deepEqual(events.at(-1).active, []);
  const finished = events.filter((event) => event.done).map((event) => event.done);
  assert.equal(finished.length, 3);
  assert.deepEqual(finished.map((d) => d.status), ["allowed", "allowed", "allowed"]);
  const cursorStart = events.find((event) => event.active.some((a) => a.adapterId === "cursor"));
  assert.equal(cursorStart.active.length, 2, "Cursor pools run concurrently: both are active");
  assert.ok(cursorStart.active.every((a) => a.provider === "Cursor" && a.label.length > 0));
});

test("verifyAccess progress carries the real status and reason of a failed check; a throwing listener never breaks the run", async () => {
  const { service } = harness({
    claudeProbe: async ({ modelIds }) => modelIds.map((modelId) => (
      modelId === "claude-a"
        ? { modelId, status: ENTITLEMENT.DENIED, reason: "credits_required", probedAt: iso(0) }
        : { modelId, status: ENTITLEMENT.UNVERIFIED, reason: "probe timed out after 30000ms", probedAt: iso(0) }
    ))
  });
  const events = [];
  const result = await service.verifyAccess({
    cwd: "/repo", confirmed: true,
    onProgress: (event) => { events.push(structuredClone(event)); throw new Error("listener exploded"); }
  });
  assert.equal(result.ran, true, "the run is unaffected by the listener");
  const failed = events.filter((event) => event.done && event.done.status !== "allowed").map((event) => [event.done.label, event.done.status, event.done.reason]);
  assert.deepEqual(failed, [["Claude A", "denied", "credits_required"], ["Claude B", "unverified", "probe timed out after 30000ms"]]);
});

test("verifyAccess progress is live: a Claude model reported by the probe is visible before the probe batch finishes", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const events = [];
  const { service } = harness({
    cursorModels: [],
    claudeProbe: async ({ modelIds, onProgress }) => {
      onProgress?.({ modelId: modelIds[0], index: 0, total: modelIds.length, result: { modelId: modelIds[0], status: ENTITLEMENT.ALLOWED, reason: null } });
      await gate;
      return modelIds.map((modelId) => ({ modelId, status: ENTITLEMENT.ALLOWED, reason: null, probedAt: iso(0) }));
    }
  });
  const run = service.verifyAccess({ cwd: "/repo", confirmed: true, onProgress: (event) => events.push(structuredClone(event)) });
  for (let i = 0; i < 100 && !events.some((event) => event.completed === 1); i += 1) await new Promise((r) => setTimeout(r, 5));
  const live = events.find((event) => event.completed === 1);
  assert.ok(live, "first model reported while the batch is still running");
  assert.equal(live.total, 2);
  assert.deepEqual(live.active.map((a) => a.label), ["Claude B"], "the next Claude model is the active one");
  release();
  await run;
  assert.equal(events.at(-1).completed, 2);
});
