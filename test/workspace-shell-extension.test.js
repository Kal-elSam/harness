import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createKairoWorkspaceExtension } from "../src/global/host/extension/index.js";

const IDENTITY_THEME = { fg: (_role, text) => text, bold: (text) => text };

const snapshot = {
  project: { label: "agentic-harness" },
  session: { state: "bound", id: "11111111", title: "Ship workspace", mode: "agent" },
  team: {
    state: "active",
    assignments: [
      { role: "Builder", model: "GPT-6 Terra", via: "codex" },
      { role: "Reviewer", model: "MiniMax-M3", via: "opencode-go" }
    ],
    rows: [
      { role: "Builder", model: "GPT-6 Terra", via: "codex", accessMode: "automatic", availability: { state: "checking", warning: null } },
      { role: "Reviewer", model: "MiniMax-M3", via: "opencode-go", accessMode: "automatic", availability: { state: "blocked", warning: "Unavailable — Cursor Models quota exhausted" } }
    ]
  },
  usage: [{ provider: "codex", totalTokens: 2400 }],
  subscriptions: {
    state: "ready",
    segments: ["Codex 5h 58% / W 86%", "Claude S 34% / W 65%", "Go 100% / 100% / 96%"],
    usageModel: [
      { name: "Codex", windows: [{ label: "5h", remainingPercent: 58, level: "normal" }, { label: "W", remainingPercent: 86, level: "normal" }], fallbackStatus: "usage unknown" },
      { name: "Claude", windows: [{ label: "S", remainingPercent: 34, level: "low" }, { label: "W", remainingPercent: 65, level: "normal" }], fallbackStatus: "usage unknown" },
      { name: "Go", windows: [{ label: null, remainingPercent: 100, level: "normal" }, { label: null, remainingPercent: 100, level: "normal" }, { label: null, remainingPercent: 96, level: "normal" }], fallbackStatus: "usage unknown" }
    ]
  },
  memory: { status: "configured" }
};

function fakePi() {
  const commands = new Map();
  const events = new Map();
  const providers = new Map();
  return {
    commands,
    events,
    providers,
    pi: {
      registerCommand(name, definition) { commands.set(name, definition); },
      registerProvider(name, definition) { providers.set(name, definition); providers.registrations = (providers.registrations ?? 0) + 1; },
      unregisterProvider(name) { providers.delete(name); },
      on(name, handler) { events.set(name, handler); }
    }
  };
}

/** A fakeable `ctx.sessionManager`, mirroring Pi's real
 * `ReadonlySessionManager.getSessionId()` contract used by the P02 binding
 * lifecycle. `piSessionId: null` mimics a ctx with no sessionManager at all
 * (pre-P02 test fixtures), matching `ctx?.sessionManager?.getSessionId?.()
 * ?? null` in the extension. */
function fakeSessionManager(piSessionId) {
  if (piSessionId == null) return undefined;
  return { getSessionId: () => piSessionId };
}

function fakeCtx({ cwd = "/repo", piSessionId = null, notifications = [], widgetCalls = [], statusCalls = [] } = {}) {
  return {
    cwd,
    sessionManager: fakeSessionManager(piSessionId),
    ui: {
      setStatus: (...args) => statusCalls.push(args),
      setWidget: (...args) => widgetCalls.push(args),
      notify: (...args) => notifications.push(args)
    }
  };
}

/** Renders whatever `ctx.ui.setWidget` received (a component factory or a
 * plain string array) into lines, the way Pi itself would, so tests can
 * assert on real rendered text either way. */
function renderWidgetCall(content, width = 160) {
  if (Array.isArray(content)) return content;
  const component = content(/* tui */ undefined, IDENTITY_THEME);
  return component.render(width);
}

test("extension registers only Kairo workspace commands and refreshes their matching compact view", async () => {
  const { pi, commands } = fakePi();
  createKairoWorkspaceExtension(pi, { loadSnapshot: async () => snapshot });

  assert.deepEqual([...commands.keys()], [
    "kairo", "kairo-team", "kairo-sessions", "kairo-usage", "kairo-route", "kairo-memory"
  ]);

  const teamCalls = [];
  await commands.get("kairo-team").handler("", {
    cwd: "/repo",
    ui: { setWidget: (...args) => teamCalls.push(args), notify: () => {} }
  });
  assert.equal(teamCalls[0][0], "kairo-workspace");
  const teamLines = renderWidgetCall(teamCalls[0][1]);
  assert.deepEqual(teamLines, [
    "KAIRO TEAM · active",
    "Builder · GPT-6 Terra · codex · checking",
    "Reviewer · MiniMax-M3 · opencode-go · BLOCKED",
    "  Unavailable — Cursor Models quota exhausted",
    "session: 11111111 · agent"
  ]);

  const usageCalls = [];
  await commands.get("kairo-usage").handler("", {
    cwd: "/repo",
    ui: { setWidget: (...args) => usageCalls.push(args), notify: () => {} }
  });
  assert.deepEqual(usageCalls, [["kairo-workspace", [
    "KAIRO USAGE",
    "USAGE · Codex 5h 58% / W 86% │ Claude S 34% / W 65% │ Go 100% / 100% / 96%",
    "codex 2400 tokens",
    "session: 11111111 · agent"
  ]]]);
});

test("the overview command renders the themed two-panel widget as a component factory, never a plain string array", async () => {
  const { pi, commands } = fakePi();
  createKairoWorkspaceExtension(pi, { loadSnapshot: async () => snapshot });

  const calls = [];
  await commands.get("kairo").handler("", {
    cwd: "/repo",
    ui: { setWidget: (...args) => calls.push(args), notify: () => {} }
  });

  assert.equal(calls[0][0], "kairo-workspace");
  assert.equal(typeof calls[0][1], "function", "overview must be a component factory, not a string array");
  const lines = renderWidgetCall(calls[0][1]);
  for (const line of lines) assert.ok(visibleWidth(line) <= 160);
  assert.ok(lines.some((line) => line.includes("USAGE")));
  assert.ok(lines.some((line) => line.includes("TEAM")));
  assert.ok(lines.some((line) => line.includes("Builder")));
  assert.ok(lines.some((line) => line.includes("Reviewer") && line.includes("BLOCKED")));
});

test("a command refresh has no fresh availability, so it never re-notifies blocked roles", async () => {
  const { pi, commands } = fakePi();
  createKairoWorkspaceExtension(pi, { loadSnapshot: async () => snapshot });

  const notifications = [];
  await commands.get("kairo").handler("", {
    cwd: "/repo",
    ui: { setWidget: () => {}, notify: (...args) => notifications.push(args) }
  });
  assert.deepEqual(notifications, []);
});

const GO_LIMIT = { provider: "opencode-go", window: "monthly", remainingPercent: 0, resetsAt: null };
function goBlockedSnapshot() {
  return {
    ...snapshot,
    team: {
      ...snapshot.team,
      rows: [
        { role: "Builder", model: "GLM-5.3", via: "opencode-go", accessMode: "automatic", availability: { state: "blocked", warning: "Unavailable — OpenCode Go monthly window is rate-limited", limit: GO_LIMIT } },
        { role: "Reviewer", model: "Kimi K3", via: "opencode-go", accessMode: "automatic", availability: { state: "blocked", warning: "Unavailable — OpenCode Go monthly window is rate-limited", limit: GO_LIMIT } }
      ]
    }
  };
}

test("live availability notifies once per provider and window per episode, and again only after it clears and returns", async () => {
  const { pi, events } = fakePi();
  let current = goBlockedSnapshot();
  const extension = createKairoWorkspaceExtension(pi, {
    loadSnapshot: async () => current,
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => ({ eligibility: { "opencode-go": { ok: false, limit: GO_LIMIT } } }),
    loadRouteModels: async () => [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }],
    recoverTeam: async () => ({ outcome: "skipped", reason: "retry-later" })
  });
  const notifications = [];
  const ctx = { cwd: "/repo", ui: { setStatus: () => {}, setWidget: () => {}, notify: (...args) => notifications.push(args) } };

  await events.get("session_start")({}, ctx);
  await extension.recovery();
  assert.equal(notifications.length, 1, "two blocked roles on the same provider window make ONE notice");
  assert.match(notifications[0][0], /Builder \(GLM-5\.3\), Reviewer \(Kimi K3\)/);
  assert.equal(notifications[0][1], "warning");

  await events.get("session_start")({}, ctx);
  await extension.recovery();
  assert.equal(notifications.length, 1, "the same limit on a later live refresh is not repeated");

  current = { ...snapshot, team: { ...snapshot.team, rows: [] } };
  await events.get("session_start")({}, ctx);
  current = goBlockedSnapshot();
  await events.get("session_start")({}, ctx);
  await extension.recovery();
  assert.equal(notifications.length, 2, "a limit that cleared and came back is a new episode");
});

test("extension registers only Kairo-routed provider models", async () => {
  const { pi, providers } = fakePi();
  const extension = createKairoWorkspaceExtension(pi, {
    loadRouteModels: async ({ cwd }) => {
      assert.equal(cwd, "/repo");
      return [{ id: "codex::gpt-6-astra", name: "GPT-6 Astra · Builder", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }];
    },
    createProvider: ({ models, cwd }) => ({ models, cwd })
  });

  assert.equal(await extension.registerRoutes("/repo"), true);
  assert.deepEqual([...providers.keys()], ["kairo"]);
  assert.deepEqual(providers.get("kairo").models.map((model) => model.id), ["codex::gpt-6-astra"]);
  assert.equal(await extension.registerRoutes("/repo"), true);
  assert.equal(providers.registrations, 1, "unchanged routes are not re-registered");
});

test("routes follow the active team: changed models re-register, no models unregister", async () => {
  const { pi, providers } = fakePi();
  let models = [{ id: "opencode-go::glm", kairoRoute: { adapterId: "opencode-go", modelId: "glm" } }];
  const extension = createKairoWorkspaceExtension(pi, {
    loadRouteModels: async () => models,
    createProvider: ({ models: registered }) => ({ models: registered })
  });
  await extension.registerRoutes("/repo");
  models = [{ id: "claude::claude-opus-5", kairoRoute: { adapterId: "claude", modelId: "claude-opus-5" } }];
  assert.equal(await extension.registerRoutes("/repo"), true);
  assert.equal(providers.registrations, 2);
  assert.deepEqual(providers.get("kairo").models.map((model) => model.id), ["claude::claude-opus-5"]);

  models = [];
  assert.equal(await extension.registerRoutes("/repo"), false);
  assert.equal(providers.has("kairo"), false, "a team with no automatic route leaves no stale Pi route behind");
});

async function sessionWithRecovery(recoverTeam, { liveData = { eligibility: { codex: { ok: true } } }, routeModels } = {}) {
  const { pi, events, providers } = fakePi();
  const recoverCalls = [];
  let routeLoads = 0;
  const extension = createKairoWorkspaceExtension(pi, {
    loadSnapshot: async () => ({ ...snapshot, team: { ...snapshot.team, rows: [] } }),
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => liveData,
    loadRouteModels: async () => {
      routeLoads += 1;
      return routeModels ? routeModels(routeLoads) : [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }];
    },
    createProvider: ({ models }) => ({ models }),
    recoverTeam: async (args) => { recoverCalls.push(args); return recoverTeam(); }
  });
  const notifications = [];
  const ctx = { cwd: "/repo", ui: { setStatus: () => {}, setWidget: () => {}, notify: (...args) => notifications.push(args) } };
  await events.get("session_start")({}, ctx);
  await extension.recovery();
  return { notifications, recoverCalls, providers, extension, events, ctx, routeLoads: () => routeLoads };
}

test("fresh live availability triggers one team recovery; an activated team re-syncs Pi routes and says what changed", async () => {
  const recovered = { status: "active", projectTeam: [{ role: "Builder", model: { displayName: "Claude Opus 5", adapterId: "claude", modelId: "claude-opus-5" } }] };
  const { notifications, recoverCalls, providers } = await sessionWithRecovery(
    () => ({ outcome: "activated", fingerprint: "claude=ok|opencode-go=limited:monthly", strategy: recovered }),
    { routeModels: (load) => (load === 1
      ? [{ id: "opencode-go::glm", kairoRoute: { adapterId: "opencode-go", modelId: "glm" } }]
      : [{ id: "claude::claude-opus-5", kairoRoute: { adapterId: "claude", modelId: "claude-opus-5" } }]) }
  );
  assert.deepEqual(recoverCalls, [{ cwd: "/repo" }]);
  assert.deepEqual(providers.get("kairo").models.map((model) => model.id), ["claude::claude-opus-5"], "Pi routes follow the recovered team");
  const [message, level] = notifications.at(-1);
  assert.equal(level, "info");
  assert.match(message, /recovered the project team/);
  assert.match(message, /Builder → Claude Opus 5/);
});

test("a recovery that keeps the previous team says why and what to do, once", async () => {
  const kept = await sessionWithRecovery(() => ({ outcome: "kept-previous", reason: "Bootstrap Analyst did not answer: timeout", fingerprint: "fp-a" }));
  assert.equal(kept.notifications.length, 1);
  assert.equal(kept.notifications[0][1], "warning");
  assert.match(kept.notifications[0][0], /could not recover the project team/);
  assert.match(kept.notifications[0][0], /did not answer: timeout/);
  assert.match(kept.notifications[0][0], /retries on a later refresh/);

  await kept.events.get("session_start")({}, kept.ctx);
  await kept.extension.recovery();
  assert.equal(kept.notifications.length, 1, "the same outcome for the same availability is not repeated");
});

test("exhausted retries point to the manual next step; quiet outcomes stay quiet", async () => {
  const exhausted = await sessionWithRecovery(() => ({ outcome: "skipped", reason: "retries-exhausted", lastOutcome: "no-analyst", fingerprint: "fp-b" }));
  assert.equal(exhausted.notifications.length, 1);
  assert.match(exhausted.notifications[0][0], /stopped retrying/);
  assert.match(exhausted.notifications[0][0], /no-analyst/);
  assert.match(exhausted.notifications[0][0], /project analyze/);

  for (const reason of ["baseline", "already-handled", "retry-later", "analysis-in-progress", "no-active-team"]) {
    const quiet = await sessionWithRecovery(() => ({ outcome: reason === "baseline" ? "baseline" : "skipped", reason, fingerprint: "fp-c" }));
    assert.deepEqual(quiet.notifications, [], reason);
  }
});

test("no recovery is attempted when the live availability probe failed", async () => {
  const { recoverCalls } = await sessionWithRecovery(() => ({ outcome: "activated" }), { liveData: null });
  assert.deepEqual(recoverCalls, []);
});



test("extension replaces a missing Pi route with an actionable Kairo state, but still shows usage and the team rows, unbounded", async () => {
  const { pi, events } = fakePi();
  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async () => snapshot,
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => ({ eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {} }),
    loadRouteModels: async () => []
  });

  const calls = [];
  await events.get("session_start")({}, {
    cwd: "/repo",
    ui: {
      setStatus: () => {},
      setWidget: (...args) => calls.push(args),
      notify: () => {}
    }
  });

  const finalCall = calls.at(-1);
  assert.equal(finalCall[0], "kairo-workspace");
  assert.equal(typeof finalCall[1], "function", "an unavailable-routes render with 2 real roles must use the component path");
  const lines = renderWidgetCall(finalCall[1]);
  assert.deepEqual(lines, [
    "KAIRO ROUTES · unavailable",
    "No verified automatic route is available for this project.",
    "Next: run kairo --legacy-cockpit, then /project analyze.",
    "USAGE · Codex 5h 58% / W 86% │ Claude S 34% / W 65% │ Go 100% / 100% / 96%",
    "KAIRO TEAM · active",
    "Builder · GPT-6 Terra · codex · checking",
    "Reviewer · MiniMax-M3 · opencode-go · BLOCKED",
    "  Unavailable — Cursor Models quota exhausted",
    "session: 11111111 · agent"
  ]);
});

test("extension renders a Kairo status/widget on session start using the explicit host session", async () => {
  const { pi, events } = fakePi();
  const calls = [];
  createKairoWorkspaceExtension(pi, {
    env: { KAIRO_SESSION_ID: "11111111-1111-4111-8111-111111111111" },
    loadSnapshot: async (input) => {
      assert.equal(input.cwd, "/repo");
      assert.equal(input.sessionId, "11111111-1111-4111-8111-111111111111");
      return snapshot;
    },
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => ({ eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {} }),
    loadRouteModels: async () => [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }]
  });

  await events.get("session_start")({}, {
    cwd: "/repo",
    ui: {
      setStatus: (...args) => calls.push(["status", ...args]),
      setWidget: (...args) => calls.push(["widget", ...args]),
      notify: () => {}
    }
  });

  // Three phases: the immediate "checking" render, then one re-render for
  // each of usage and availability resolving independently — never fewer
  // than all three (see the P01.2 split tests below for resolution order).
  assert.deepEqual(calls[0], ["status", "kairo", "Kairo · agentic-harness · session: 11111111 · agent"]);
  assert.equal(calls[1][0], "widget");
  assert.equal(typeof calls[1][2], "function", "the overview render is a component factory");
  assert.deepEqual(calls[2], ["status", "kairo", "Kairo · agentic-harness · session: 11111111 · agent"]);
  assert.equal(calls[3][0], "widget");
  assert.deepEqual(calls[4], ["status", "kairo", "Kairo · agentic-harness · session: 11111111 · agent"]);
  assert.equal(calls[5][0], "widget");
  assert.equal(calls.length, 6);

  const firstLines = renderWidgetCall(calls[1][2]);
  const lastLines = renderWidgetCall(calls[5][2]);
  assert.deepEqual(firstLines, lastLines, "loadSnapshot returns the same fixture snapshot in every phase here");
  assert.ok(firstLines.some((line) => line.includes("Builder")));
});

// P01.2: usage and team availability now resolve from two INDEPENDENT
// sources (loadUsageData ~5s, loadLiveData ~20s) instead of one combined
// probe — each re-renders the widget as soon as IT arrives, never waiting
// on the other. `loadSnapshot` below derives its rendered state from
// `usageIntelligence`/`availabilityIntelligence` instead of the old single
// `intelligence` field, mirroring workspace-snapshot.js's real split.
function snapshotFor({ usageIntelligence, availabilityIntelligence } = {}) {
  return {
    ...snapshot,
    subscriptions: usageIntelligence ? snapshot.subscriptions : { state: "checking", segments: [], usageModel: [] },
    team: {
      ...snapshot.team,
      rows: snapshot.team.rows.map((row) => ({
        ...row,
        availability: availabilityIntelligence === undefined
          ? { state: "checking", warning: null }
          : availabilityIntelligence === null
            ? { state: "unknown", warning: null }
            : { state: "available", warning: null }
      }))
    }
  };
}

test("extension renders usage as soon as it arrives, without waiting on the still-pending availability probe", async () => {
  const { pi, events } = fakePi();
  const widgetCalls = [];
  let resolveAvailability;
  const availabilityPromise = new Promise((resolve) => { resolveAvailability = resolve; });

  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async (args) => snapshotFor(args),
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => availabilityPromise,
    loadRouteModels: async () => [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }]
  });

  const startPromise = events.get("session_start")({}, {
    cwd: "/repo",
    ui: { setStatus: () => {}, setWidget: (...args) => widgetCalls.push(args), notify: () => {} }
  });

  // The usage probe above resolves immediately; give its microtasks a
  // chance to run while availability is still deliberately pending.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(widgetCalls.length, 2, "phase 1 (checking) + usage arriving, availability still pending");
  const afterUsage = renderWidgetCall(widgetCalls[1][1]);
  assert.ok(afterUsage.some((line) => line.includes("58%")), "usage now shows real data");
  assert.ok(afterUsage.some((line) => line.includes("checking")), "team still checking while availability is pending");

  resolveAvailability({ eligibility: { codex: { ok: true } } });
  await startPromise;
  assert.equal(widgetCalls.length, 3, "availability resolving re-renders once more");
  const finalLines = renderWidgetCall(widgetCalls[2][1]);
  assert.ok(!finalLines.some((line) => line.includes("checking")), "nothing left checking once both resolved");
});

test("extension renders availability as soon as it arrives, without waiting on the still-pending usage probe", async () => {
  const { pi, events } = fakePi();
  const widgetCalls = [];
  let resolveUsage;
  const usagePromise = new Promise((resolve) => { resolveUsage = resolve; });

  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async (args) => snapshotFor(args),
    loadUsageData: async () => usagePromise,
    loadLiveData: async () => ({ eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {} }),
    loadRouteModels: async () => [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }]
  });

  const startPromise = events.get("session_start")({}, {
    cwd: "/repo",
    ui: { setStatus: () => {}, setWidget: (...args) => widgetCalls.push(args), notify: () => {} }
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(widgetCalls.length, 2, "phase 1 (checking) + availability arriving, usage still pending");
  const afterAvailability = renderWidgetCall(widgetCalls[1][1]);
  assert.ok(afterAvailability.some((line) => line.includes("usage checking")), "usage still checking while its probe is pending");

  resolveUsage({ usage: {}, providers: {} });
  await startPromise;
  assert.equal(widgetCalls.length, 3, "usage resolving re-renders once more");
});

test("extension shows unknown team rows and one explanatory line when the availability probe fails, independent of usage", async () => {
  const { pi, events } = fakePi();
  const widgetCalls = [];

  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async (args) => snapshotFor(args),
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => null,
    loadRouteModels: async () => [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }]
  });

  await events.get("session_start")({}, {
    cwd: "/repo",
    ui: { setStatus: () => {}, setWidget: (...args) => widgetCalls.push(args), notify: () => {} }
  });

  const finalLines = renderWidgetCall(widgetCalls.at(-1)[1]);
  assert.ok(finalLines.some((line) => line.includes("58%")), "usage still shows real data — availability failing never blanks it");
  assert.ok(
    finalLines.some((line) => line.toLowerCase().includes("availability check failed")),
    "one line explains the failed availability check"
  );
});

// P02-T3: Pi session -> Kairo session binding lifecycle. Every test below
// injects resolveHomeDirImpl/resolveProjectRootImpl/createSessionImpl/
// getSessionImpl/lookupPiBindingImpl/recordPiBindingImpl so no real disk or
// git is touched — mirroring the deps-injection convention used throughout
// this file and in session-cli.test.js.

const KAIRO_ID_A = "aaaaaaaa-0000-4000-8000-000000000001";
const KAIRO_ID_B = "bbbbbbbb-0000-4000-8000-000000000002";
const PI_ID_A = "pi-session-a";

function bindingHarness(overrides = {}) {
  const { pi, events } = fakePi();
  const recordCalls = [];
  const seenSessionIds = [];
  const extension = createKairoWorkspaceExtension(pi, {
    loadSnapshot: async (input) => {
      seenSessionIds.push(input.sessionId);
      return snapshot;
    },
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => null,
    loadRouteModels: async () => [],
    resolveHomeDirImpl: () => "/home/kairo",
    resolveProjectRootImpl: async () => "/repo",
    recordPiBindingImpl: async (homeDir, projectRoot, piSessionId, kairoSessionId) => {
      recordCalls.push({ homeDir, projectRoot, piSessionId, kairoSessionId });
      return { kairoSessionId, boundAt: "2026-09-24T00:00:00.000Z" };
    },
    lookupPiBindingImpl: async () => null,
    createSessionImpl: async () => { throw new Error("createSessionImpl not stubbed for this test"); },
    getSessionImpl: async () => { throw new Error("getSessionImpl not stubbed for this test"); },
    ...overrides
  });
  return { events, extension, recordCalls, seenSessionIds };
}

test("startup binds to env KAIRO_SESSION_ID and records it for the current Pi session id", async () => {
  const { pi, events } = fakePi();
  const recordCalls = [];
  createKairoWorkspaceExtension(pi, {
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    loadSnapshot: async () => snapshot,
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => null,
    loadRouteModels: async () => [],
    resolveHomeDirImpl: () => "/home/kairo",
    resolveProjectRootImpl: async () => "/repo",
    recordPiBindingImpl: async (homeDir, projectRoot, piSessionId, kairoSessionId) => {
      recordCalls.push({ homeDir, projectRoot, piSessionId, kairoSessionId });
    }
  });

  const notifications = [];
  const ctx = fakeCtx({ piSessionId: PI_ID_A, notifications });
  await events.get("session_start")({ reason: "startup" }, ctx);

  assert.deepEqual(recordCalls, [{
    homeDir: "/home/kairo", projectRoot: "/repo", piSessionId: PI_ID_A, kairoSessionId: KAIRO_ID_A
  }]);
  assert.deepEqual(notifications, [], "a normal startup binding is silent");
});

test("startup with no KAIRO_SESSION_ID stays unbound, silently — never an implied session", async () => {
  const { pi, events } = fakePi();
  let sawSessionId;
  createKairoWorkspaceExtension(pi, {
    env: {},
    loadSnapshot: async (input) => { sawSessionId = input.sessionId; return snapshot; },
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => null,
    loadRouteModels: async () => []
  });

  const notifications = [];
  const ctx = fakeCtx({ piSessionId: PI_ID_A, notifications });
  await events.get("session_start")({ reason: "startup" }, ctx);

  assert.equal(sawSessionId, null);
  assert.deepEqual(notifications, []);
});

// Pi reloads the extension on /reload, so `boundKairoSessionId` is lost —
// reload must recover the CURRENT Pi session's own recorded binding first,
// never blindly fall back to the launch-time env id. Falling back to env
// unconditionally would silently rebind to the original launch session
// after a /new or /fork in the same process, which is exactly the "reuse
// another Kairo identity" case P02 forbids.

test("reload with an existing Pi->Kairo mapping rebinds to that session, never env — REGRESSION for /new then reload", async () => {
  const { events, seenSessionIds } = bindingHarness({
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    lookupPiBindingImpl: async (homeDir, projectRoot, piSessionId) => {
      assert.equal(piSessionId, PI_ID_A);
      return KAIRO_ID_B;
    },
    getSessionImpl: async (homeDir, projectRoot, sessionId) => {
      assert.equal(sessionId, KAIRO_ID_B);
      return { id: KAIRO_ID_B, mode: "agent" };
    }
  });
  const notifications = [];
  const ctx = fakeCtx({ piSessionId: PI_ID_A, notifications });
  await events.get("session_start")({ reason: "reload" }, ctx);

  assert.ok(seenSessionIds.includes(KAIRO_ID_B), "reload must bind to the /new session, not the launch-time env id");
  assert.ok(!seenSessionIds.includes(KAIRO_ID_A));
  assert.deepEqual(notifications, [], "a real, existing mapping rebinds silently");
});

test("reload with a mapping pointing at a forked session rebinds to the fork — REGRESSION for /fork then reload", async () => {
  const { events, seenSessionIds } = bindingHarness({
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    lookupPiBindingImpl: async () => KAIRO_ID_B,
    getSessionImpl: async () => ({ id: KAIRO_ID_B, mode: "plan" })
  });
  const ctx = fakeCtx({ piSessionId: "pi-session-forked" });
  await events.get("session_start")({ reason: "reload" }, ctx);

  assert.ok(seenSessionIds.includes(KAIRO_ID_B));
  assert.ok(!seenSessionIds.includes(KAIRO_ID_A));
});

test("reload with no recorded mapping falls back to the launch-time env session and records it", async () => {
  const { events, recordCalls, seenSessionIds } = bindingHarness({
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    lookupPiBindingImpl: async () => null
  });
  const ctx = fakeCtx({ piSessionId: PI_ID_A });
  await events.get("session_start")({ reason: "reload" }, ctx);

  assert.ok(seenSessionIds.includes(KAIRO_ID_A));
  assert.deepEqual(recordCalls, [{
    homeDir: "/home/kairo", projectRoot: "/repo", piSessionId: PI_ID_A, kairoSessionId: KAIRO_ID_A
  }]);
});

test("reload with a mapping to a Kairo session that no longer exists fails closed to unbound, never falls back to env", async () => {
  const { events, seenSessionIds } = bindingHarness({
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    lookupPiBindingImpl: async () => KAIRO_ID_B,
    getSessionImpl: async () => null
  });
  const notifications = [];
  const ctx = fakeCtx({ piSessionId: PI_ID_A, notifications });
  await events.get("session_start")({ reason: "reload" }, ctx);

  assert.ok(!seenSessionIds.includes(KAIRO_ID_A), "a missing mapped session must never fall back to reusing env");
  assert.ok(!seenSessionIds.includes(KAIRO_ID_B));
  assert.equal(seenSessionIds.at(-1), null, "fails closed to unbound");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][1], "error");
});

test("a Pi /new creates and binds a fresh Kairo session, recorded against the Pi session id", async () => {
  const { events, recordCalls, seenSessionIds } = bindingHarness({
    createSessionImpl: async (homeDir, projectRoot, opts) => {
      assert.deepEqual(opts, {});
      return { id: KAIRO_ID_A, mode: "ask" };
    }
  });
  const ctx = fakeCtx({ piSessionId: PI_ID_A });
  await events.get("session_start")({ reason: "new" }, ctx);

  assert.deepEqual(recordCalls, [{
    homeDir: "/home/kairo", projectRoot: "/repo", piSessionId: PI_ID_A, kairoSessionId: KAIRO_ID_A
  }]);
  assert.ok(seenSessionIds.includes(KAIRO_ID_A));
});

test("a Pi /resume rebinds to the Kairo session already recorded for that Pi session, when it still exists", async () => {
  const { events, seenSessionIds } = bindingHarness({
    lookupPiBindingImpl: async () => KAIRO_ID_A,
    getSessionImpl: async (homeDir, projectRoot, sessionId) => {
      assert.equal(sessionId, KAIRO_ID_A);
      return { id: KAIRO_ID_A, mode: "plan" };
    }
  });
  const notifications = [];
  const ctx = fakeCtx({ piSessionId: PI_ID_A, notifications });
  await events.get("session_start")({ reason: "resume" }, ctx);

  assert.ok(seenSessionIds.includes(KAIRO_ID_A));
  assert.deepEqual(notifications, [], "rebinding a real, existing session is silent");
});

test("a Pi /resume with no recorded (or missing) Kairo session creates a new one and notifies visibly", async () => {
  const { events, recordCalls, seenSessionIds } = bindingHarness({
    lookupPiBindingImpl: async () => null,
    createSessionImpl: async () => ({ id: KAIRO_ID_B, mode: "ask" })
  });
  const notifications = [];
  const ctx = fakeCtx({ piSessionId: PI_ID_A, notifications });
  await events.get("session_start")({ reason: "resume" }, ctx);

  assert.deepEqual(recordCalls, [{
    homeDir: "/home/kairo", projectRoot: "/repo", piSessionId: PI_ID_A, kairoSessionId: KAIRO_ID_B
  }]);
  assert.ok(seenSessionIds.includes(KAIRO_ID_B));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][1], "info");
  assert.match(notifications[0][0], /started a new one/i);
});

test("a Pi /resume whose recorded Kairo session no longer exists creates a new one instead of reusing the stale binding", async () => {
  const { events, seenSessionIds } = bindingHarness({
    lookupPiBindingImpl: async () => KAIRO_ID_A,
    getSessionImpl: async () => null,
    createSessionImpl: async () => ({ id: KAIRO_ID_B, mode: "ask" })
  });
  const notifications = [];
  const ctx = fakeCtx({ piSessionId: PI_ID_A, notifications });
  await events.get("session_start")({ reason: "resume" }, ctx);

  assert.ok(seenSessionIds.includes(KAIRO_ID_B));
  assert.ok(!seenSessionIds.includes(KAIRO_ID_A));
  assert.equal(notifications.length, 1);
});

test("a Pi /fork creates a new Kairo session inheriting the previous binding's mode, records it, and notifies", async () => {
  const { pi, events } = fakePi();
  const recordCalls = [];
  const createCalls = [];
  const extension = createKairoWorkspaceExtension(pi, {
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    loadSnapshot: async () => snapshot,
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => null,
    loadRouteModels: async () => [],
    resolveHomeDirImpl: () => "/home/kairo",
    resolveProjectRootImpl: async () => "/repo",
    recordPiBindingImpl: async (homeDir, projectRoot, piSessionId, kairoSessionId) => {
      recordCalls.push({ piSessionId, kairoSessionId });
    },
    getSessionImpl: async (homeDir, projectRoot, sessionId) => {
      assert.equal(sessionId, KAIRO_ID_A);
      return { id: KAIRO_ID_A, mode: "agent" };
    },
    createSessionImpl: async (homeDir, projectRoot, opts) => {
      createCalls.push(opts);
      return { id: KAIRO_ID_B, mode: opts.mode };
    }
  });

  // First bind via startup (so boundKairoSessionId = KAIRO_ID_A), then fork.
  await events.get("session_start")({ reason: "startup" }, fakeCtx({ piSessionId: PI_ID_A }));
  const notifications = [];
  await events.get("session_start")({ reason: "fork" }, fakeCtx({ piSessionId: "pi-session-forked", notifications }));

  assert.deepEqual(createCalls, [{ mode: "agent" }], "fork inherits the previous binding's mode");
  assert.deepEqual(recordCalls.at(-1), { piSessionId: "pi-session-forked", kairoSessionId: KAIRO_ID_B });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][1], "info");
  assert.match(notifications[0][0], /Forked/);
  void extension;
});

test("any binding failure leaves the extension unbound with a visible error, never the previous Kairo id", async () => {
  const { pi, events } = fakePi();
  let sawSessionId;
  createKairoWorkspaceExtension(pi, {
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    loadSnapshot: async (input) => { sawSessionId = input.sessionId; return snapshot; },
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => null,
    loadRouteModels: async () => [],
    resolveHomeDirImpl: () => "/home/kairo",
    resolveProjectRootImpl: async () => "/repo",
    recordPiBindingImpl: async () => { throw new Error("disk full"); }
  });

  const notifications = [];
  const ctx = fakeCtx({ piSessionId: PI_ID_A, notifications });
  await events.get("session_start")({ reason: "startup" }, ctx);

  assert.equal(sawSessionId, null, "a failed binding renders as unbound, never the id that failed to record");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][1], "error");
  assert.match(notifications[0][0], /disk full/);
});

test("an invalid KAIRO_SESSION_ID fails closed to unbound with a visible error", async () => {
  const { pi, events } = fakePi();
  let sawSessionId;
  createKairoWorkspaceExtension(pi, {
    env: { KAIRO_SESSION_ID: "../../etc" },
    loadSnapshot: async (input) => { sawSessionId = input.sessionId; return snapshot; },
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => null,
    loadRouteModels: async () => []
  });

  const notifications = [];
  const ctx = fakeCtx({ piSessionId: PI_ID_A, notifications });
  await events.get("session_start")({ reason: "startup" }, ctx);

  assert.equal(sawSessionId, null);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][1], "error");
});

// P02-T4: unbound presentation — status bar never implies a default "ask"
// mode, and /kairo-sessions stays consistent with the footer/status bar.

test("the status bar shows an explicit unbound state, never a default ask mode", async () => {
  const { pi, events } = fakePi();
  createKairoWorkspaceExtension(pi, {
    env: {},
    loadSnapshot: async () => ({ ...snapshot, session: { state: "unbound" } }),
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => null,
    loadRouteModels: async () => []
  });

  const statusCalls = [];
  const ctx = fakeCtx({ piSessionId: null, statusCalls });
  await events.get("session_start")({ reason: "startup" }, ctx);

  assert.ok(statusCalls.length > 0);
  for (const [, message] of statusCalls) {
    assert.ok(message.includes("unbound"), `expected an explicit unbound status, got "${message}"`);
    assert.ok(!message.endsWith("· ask"), `status bar must never default to ask when unbound, got "${message}"`);
  }
});

test("/kairo-sessions reports unbound consistently with the footer and status bar", async () => {
  const { pi, commands } = fakePi();
  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async () => ({ ...snapshot, session: { state: "unbound" } })
  });

  const calls = [];
  await commands.get("kairo-sessions").handler("", {
    cwd: "/repo",
    ui: { setWidget: (...args) => calls.push(args), notify: () => {} }
  });
  const lines = renderWidgetCall(calls[0][1]);
  assert.ok(lines.some((line) => /no kairo session is bound/i.test(line)));
  assert.ok(!lines.some((line) => /· ask/i.test(line)));
});
