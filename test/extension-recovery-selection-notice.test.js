import assert from "node:assert/strict";
import { test } from "node:test";
import { createKairoWorkspaceExtension } from "../src/global/host/extension/index.js";

// T4f (item e): the automatic refresh no longer analyzes (D3/D5). When recovery
// needs an analyst the human must pick, Pi must SAY so instead of staying
// silent, and must never start an analysis on its own.
function setup(recoverResult) {
  const events = new Map();
  const pi = {
    on: (name, fn) => events.set(name, fn),
    registerCommand: () => {},
    registerProvider: () => {},
    unregisterProvider: () => {}
  };
  const notices = [];
  const recoverCalls = [];
  const extension = createKairoWorkspaceExtension(pi, {
    env: {},
    loadSnapshot: async () => ({
      project: { label: "p" },
      session: { state: "unbound" },
      team: { state: "not_analyzed", rows: [] },
      subscriptions: { state: "checking" },
      usage: [],
      memory: { status: "ok" }
    }),
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => ({ eligibility: {}, claudeEntitlement: {}, cursorAccess: {} }),
    loadRouteModels: async () => [],
    readPendingRecovery: async () => null,
    recoverTeam: async (args) => { recoverCalls.push(args); return recoverResult; },
    resolveHomeDirImpl: () => "/home/kairo",
    resolveProjectRootImpl: async () => "/repo"
  });
  const ctx = {
    cwd: "/repo",
    ui: { setStatus() {}, setWidget() {}, notify: (message, level) => notices.push({ message, level }) }
  };
  return { handler: events.get("session_start"), extension, ctx, notices, recoverCalls };
}

for (const result of [
  { outcome: "analyst_selection_required", fingerprint: "fp1", suggestedAnalyst: null, analystCatalog: { models: [] }, affected: [] },
  { outcome: "skipped", reason: "awaiting-explicit-request", fingerprint: "fp2" }
]) {
  test(`auto-refresh surfaces the analyst selection required state (${result.outcome}/${result.reason ?? "-"}) without analyzing`, async () => {
    const { handler, extension, ctx, notices, recoverCalls } = setup(result);
    await handler({}, ctx);
    await extension.recovery();
    assert.equal(notices.length, 1, JSON.stringify(notices));
    assert.equal(notices[0].level, "warning");
    assert.match(notices[0].message, /analyst/i);
    assert.match(notices[0].message, /press R/);
    assert.match(notices[0].message, /Nothing was analyzed/);
    // The refresh only asks for the state: no explicit request, no analyst choice.
    assert.deepEqual(recoverCalls, [{ cwd: "/repo" }]);
  });
}

test("the analyst selection notice is said once per availability change", async () => {
  const { handler, extension, ctx, notices } = setup({ outcome: "skipped", reason: "awaiting-explicit-request", fingerprint: "fp3" });
  await handler({}, ctx);
  await extension.recovery();
  await handler({}, ctx);
  await extension.recovery();
  assert.equal(notices.length, 1);
});

test("an unrelated skip stays quiet", async () => {
  const { handler, extension, ctx, notices } = setup({ outcome: "skipped", reason: "backoff", fingerprint: "fp4" });
  await handler({}, ctx);
  await extension.recovery();
  assert.deepEqual(notices, []);
});
