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
 * This test simulates a ctx that becomes stale after bindSession's async work.
 * With the buggy code it would throw on ctx.cwd; with the fix it must not.
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

function makeStaleCtx({ piSessionId, cwd = "/repo", makeStaleAfterMs = 5 }) {
  let stale = false;
  setTimeout(() => { stale = true; }, makeStaleAfterMs);
  const ui = {
    setWidget: () => {},
    setStatus: () => {},
    notify: () => {},
  };
  return {
    get cwd() {
      if (stale) throw new Error("This extension ctx is stale after session replacement or reload.");
      return cwd;
    },
    get ui() {
      if (stale) throw new Error("This extension ctx is stale after session replacement or reload.");
      return ui;
    },
    sessionManager: {
      getSessionId: () => piSessionId,
    },
    _isStale: () => stale,
  };
}

test("regression: session_start with /new must not use stale ctx after async (RED 002a779, GREEN b7435ed)", async () => {
  const { pi, events } = fakePi();
  const KAIRO_A = "aaaaaaaa-0000-4000-8000-000000000001";
  const PI_A = "pi-session-a";
  const PI_B = "pi-session-b";

  let seenSessionIds = [];
  let widgetCalls = 0;

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
    createSessionImpl: async () => ({ id: "bbbbbbbb-0000-4000-8000-000000000002", mode: "ask" }),
    getSessionImpl: async () => ({ id: KAIRO_A, mode: "ask" }),
    lookupPiBindingImpl: async () => null,
    recordPiBindingImpl: async () => ({ kairoSessionId: KAIRO_A, boundAt: "2026-09-24T00:00:00.000Z" }),
  });

  const handler = events.get("session_start");
  assert.ok(handler, "session_start handler must be registered");

  // Startup with Pi A — should bind to env and not throw stale
  const ctxStartup = makeStaleCtx({ piSessionId: PI_A, makeStaleAfterMs: 50 });
  await handler({ reason: "startup" }, ctxStartup);
  // Give time for the handler's async rerender (which would trigger stale if buggy)
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(seenSessionIds.length > 0, "startup should have refreshed workspace without stale error");

  // Now simulate /new with Pi B — the critical case that previously threw at index.js:186
  seenSessionIds = [];
  const ctxNew = makeStaleCtx({ piSessionId: PI_B, makeStaleAfterMs: 5 });
  // The handler will await bindSession (which does async createSession), then try to
  // use ctx.cwd/ui. With the buggy code, the second access after ~5ms would be stale and throw.
  // With the fix (b7435ed), it captures cwd/ui synchronously and must not throw.
  await assert.doesNotReject(async () => {
    await handler({ reason: "new" }, ctxNew);
    // Wait for the post-new rerender which also uses ctxBag, not stale ctx
    await new Promise((r) => setTimeout(r, 100));
  }, "session_start with /new must not throw stale ctx (GREEN b7435ed)");

  assert.ok(seenSessionIds.includes("bbbbbbbb-0000-4000-8000-000000000002"), "new should have created and bound a fresh Kairo session");
});

test("regression: Pi newSession() does not create JSONL — patch must write header and set flushed=true together", async () => {
  // This documents the Pi blocking for step 2, not a direct Kairo test.
  // Pi's SessionManager.newSession() in session-manager.js:691-715 only prepares
  // header + sessionFile and leaves flushed=false, without writing the file.
  // _persist at 788-798 only writes when an assistant message arrives.
  // A correct patch must write the header immediately and set flushed=true,
  // otherwise the first subsequent append will try openSync with "wx" on the
  // same path and fail with EEXIST or duplicate the header.
  // This test is a placeholder that documents the expectation; the actual Pi
  // patch test will be in the Pi fork (Node >=22.19).
  assert.ok(true, "documented: Pi patch must write header and set flushed=true together");
});
