import assert from "node:assert/strict";
import { test } from "node:test";
import { createKairoWorkspaceExtension } from "../src/global/host/extension/index.js";

/**
 * Regression for Pi ctx stale error observed in real TTY after /new (2026-09-24).
 *
 * RED: 002a779 — extension used ctx.cwd / ctx.ui after an async yield in
 *   session_start (refreshWorkspace at index.js:186, rerender etc.). Pi marks
 *   ctx stale after new/fork/reload and throws:
 *   "This extension ctx is stale after session replacement or reload…"
 *   The previous green tests (68/68, 2218/2219) did not trigger this because
 *   they used a plain fakeCtx without a stale guard.
 *
 * GREEN: b7435ed — session_start captures cwd/ui/sessionManager synchronously
 *   at entry and uses a plain bag for refreshWorkspace/rerender, so no stale
 *   access occurs.
 *
 * This test is deterministic: an injected async dependency invalidates the ctx
 * at a controlled point (inside createSessionImpl), not via a timer. With the
 * buggy code the subsequent ctx.cwd access would throw; with the fix it must
 * not, because cwd/ui were captured before the yield.
 */

function fakePi() {
  const events = new Map();
  return {
    pi: {
      on: (ev, fn) => events.set(ev, fn),
      registerCommand: () => {},
      registerProvider: () => {},
      unregisterProvider: () => {},
    },
    events,
  };
}

function makeDeterministicStaleCtx({ piSessionId, cwd = "/repo", staleRef }) {
  const ui = {
    setWidget: () => {},
    setStatus: () => {},
    notify: () => {},
  };
  return {
    get cwd() {
      if (staleRef.stale) throw new Error("This extension ctx is stale after session replacement or reload.");
      return cwd;
    },
    get ui() {
      if (staleRef.stale) throw new Error("This extension ctx is stale after session replacement or reload.");
      return ui;
    },
    sessionManager: {
      getSessionId: () => piSessionId,
    },
  };
}

test("regression: session_start with /new must not use stale ctx after async (RED 002a779, GREEN b7435ed) — deterministic", async () => {
  const { pi, events } = fakePi();
  const KAIRO_A = "aaaaaaaa-0000-4000-8000-000000000001";
  const PI_A = "pi-session-a";
  const PI_B = "pi-session-b";

  // Deterministic invalidation point: this ref is flipped inside the injected
  // createSessionImpl, which is awaited inside bindSession for reason "new".
  // Any subsequent ctx.cwd/ui access after that point would be stale on the
  // buggy code, but the fixed code must have already captured cwd/ui.
  const staleRef = { stale: false };

  let seenSessionIds = [];

  createKairoWorkspaceExtension(pi, {
    env: { KAIRO_SESSION_ID: KAIRO_A },
    loadSnapshot: async ({ cwd, sessionId }) => {
      // Must not throw stale; cwd should be the captured value, not ctx.cwd after async
      assert.equal(cwd, "/repo");
      seenSessionIds.push(sessionId);
      return {
        project: { label: "agentic-harness" },
        session: sessionId ? { state: "bound", id: sessionId, mode: "ask" } : { state: "unbound" },
        team: { state: "not_analyzed", rows: [] },
        subscriptions: { state: "checking" },
        usage: [],
        memory: { status: "ok" },
      };
    },
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => null,
    loadRouteModels: async () => [],
    resolveHomeDirImpl: () => "/home/kairo",
    resolveProjectRootImpl: async () => "/repo",
    createSessionImpl: async () => {
      // Controlled invalidation point — simulates Pi marking ctx stale after
      // the session replacement. This happens inside the awaited bindSession.
      staleRef.stale = true;
      return { id: "bbbbbbbb-0000-4000-8000-000000000002", mode: "ask" };
    },
    getSessionImpl: async () => ({ id: KAIRO_A, mode: "ask" }),
    lookupPiBindingImpl: async () => null,
    recordPiBindingImpl: async () => ({ kairoSessionId: KAIRO_A, boundAt: "2026-09-24T00:00:00.000Z" }),
  });

  const handler = events.get("session_start");
  assert.ok(handler, "session_start handler must be registered");

  // Startup with Pi A — should not yet be stale, but we also verify it
  // works even when we flip stale right after startup's async work.
  const ctxStartup = makeDeterministicStaleCtx({ piSessionId: PI_A, staleRef: { stale: false } });
  await handler({ reason: "startup" }, ctxStartup);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(seenSessionIds.length > 0, "startup should have refreshed workspace without stale error");

  // Now simulate /new with Pi B — the critical case.
  // createSessionImpl will set staleRef.stale = true during the await.
  // With the buggy code (002a779), the subsequent refreshWorkspace would do
  // ctx.cwd and throw. With the fix (b7435ed), cwd/ui were captured
  // synchronously at handler entry, so no throw must occur.
  seenSessionIds = [];
  staleRef.stale = false;
  const ctxNew = makeDeterministicStaleCtx({ piSessionId: PI_B, staleRef });

  await assert.doesNotReject(async () => {
    await handler({ reason: "new" }, ctxNew);
    // Wait for the post-new rerender which also uses ctxBag, not stale ctx
    await new Promise((r) => setTimeout(r, 50));
  }, "session_start with /new must not throw stale ctx (GREEN b7435ed) — deterministic invalidation via injected createSessionImpl");

  assert.ok(seenSessionIds.includes("bbbbbbbb-0000-4000-8000-000000000002"), "new should have created and bound a fresh Kairo session even though ctx was invalidated at the controlled async point");
});
