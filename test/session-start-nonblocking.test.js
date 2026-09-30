import assert from "node:assert/strict";
import { test } from "node:test";
import { createKairoWorkspaceExtension } from "../src/global/host/extension/index.js";

function setup(overrides = {}) {
  const events = new Map();
  const pi = {
    on: (name, fn) => events.set(name, fn),
    registerCommand: () => {},
    registerProvider: () => {},
    unregisterProvider: () => {}
  };
  const snapshots = [];
  const extension = createKairoWorkspaceExtension(pi, {
    env: {},
    loadSnapshot: async ({ usageIntelligence, availabilityIntelligence }) => {
      snapshots.push({ usageIntelligence, availabilityIntelligence });
      return {
        project: { label: "p" },
        session: { state: "unbound" },
        team: { state: "not_analyzed", rows: [] },
        subscriptions: { state: "checking" },
        usage: [],
        memory: { status: "ok" }
      };
    },
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => null,
    loadRouteModels: async () => [],
    readPendingRecovery: async () => null,
    resolveHomeDirImpl: () => "/home/kairo",
    resolveProjectRootImpl: async () => "/repo",
    ...overrides
  });
  const ctx = { cwd: "/repo", ui: { setStatus() {}, setWidget() {}, notify() {} } };
  return { handler: events.get("session_start"), extension, snapshots, ctx };
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test("session_start returns before slow usage and availability probes settle", async () => {
  const never = new Promise(() => {});
  const { handler, ctx } = setup({ loadUsageData: () => never, loadLiveData: () => never });
  const outcome = await Promise.race([
    handler({}, ctx).then(() => "returned"),
    tick(500).then(() => "blocked")
  ]);
  assert.equal(outcome, "returned");
});

test("late-resolving probes still update state after session_start returned", async () => {
  let resolveUsage;
  let resolveLive;
  const usage = { usage: { marker: "late-usage" }, providers: {} };
  const live = { eligibility: {}, claudeEntitlement: {}, cursorAccess: {} };
  const { handler, snapshots, ctx } = setup({
    loadUsageData: () => new Promise((resolve) => { resolveUsage = resolve; }),
    loadLiveData: () => new Promise((resolve) => { resolveLive = resolve; })
  });
  await handler({}, ctx);
  assert.ok(snapshots.every((s) => !s.usageIntelligence && !s.availabilityIntelligence), "phase 1 renders without probe data");
  resolveUsage(usage);
  resolveLive(live);
  await tick();
  assert.ok(snapshots.some((s) => s.usageIntelligence === usage), "usage re-render happened");
  assert.ok(snapshots.some((s) => s.availabilityIntelligence === live), "availability re-render happened");
});

test("recovery() still awaits the background probes", async () => {
  let resolveLive;
  const recovered = [];
  const { handler, extension, ctx } = setup({
    loadLiveData: () => new Promise((resolve) => { resolveLive = resolve; }),
    recoverTeam: async () => { recovered.push(true); return { outcome: "unchanged" }; }
  });
  await handler({}, ctx);
  const pending = extension.recovery();
  resolveLive({ eligibility: {}, claudeEntitlement: {}, cursorAccess: {} });
  const result = await pending;
  assert.deepEqual(result, { outcome: "unchanged" });
  assert.equal(recovered.length, 1);
});

test("rejecting probes do not produce unhandled rejections", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const { handler, ctx } = setup({
      loadUsageData: () => Promise.reject(new Error("usage boom")),
      loadLiveData: () => Promise.reject(new Error("live boom")),
      readPendingRecovery: () => Promise.reject(new Error("record boom"))
    });
    await assert.doesNotReject(handler({}, ctx));
    await tick(50);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a superseding session_start before late probes resolve does not throw", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const resolvers = [];
    const { handler, ctx } = setup({
      loadUsageData: () => new Promise((resolve) => resolvers.push(() => resolve({ usage: {}, providers: {} }))),
      loadLiveData: () => new Promise((resolve) => resolvers.push(() => resolve(null)))
    });
    await handler({ reason: "startup" }, ctx);
    await handler({ reason: "new" }, ctx);
    resolvers.forEach((resolve) => resolve());
    await tick(50);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
