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
      registerProvider(name, definition) { providers.set(name, definition); },
      on(name, handler) { events.set(name, handler); }
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
    "  Unavailable — Cursor Models quota exhausted"
  ]);

  const usageCalls = [];
  await commands.get("kairo-usage").handler("", {
    cwd: "/repo",
    ui: { setWidget: (...args) => usageCalls.push(args), notify: () => {} }
  });
  assert.deepEqual(usageCalls, [["kairo-workspace", [
    "KAIRO USAGE",
    "USAGE · Codex 5h 58% / W 86% │ Claude S 34% / W 65% │ Go 100% / 100% / 96%",
    "codex 2400 tokens"
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

test("extension notifies once per blocked role on every refresh, with role, model, Kairo's warning, and the next step", async () => {
  const { pi, commands } = fakePi();
  createKairoWorkspaceExtension(pi, { loadSnapshot: async () => snapshot });

  const notifications = [];
  await commands.get("kairo").handler("", {
    cwd: "/repo",
    ui: { setWidget: () => {}, notify: (...args) => notifications.push(args) }
  });

  assert.equal(notifications.length, 1);
  const [message, level] = notifications[0];
  assert.equal(level, "warning");
  assert.match(message, /Reviewer/);
  assert.match(message, /MiniMax-M3/);
  assert.match(message, /Cursor Models quota exhausted/);
  assert.match(message, /project analyze/);
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
  assert.equal(await extension.registerRoutes("/other"), true);
});

test("extension replaces a missing Pi route with an actionable Kairo state, but still shows usage and the team rows, unbounded", async () => {
  const { pi, events } = fakePi();
  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async () => snapshot,
    loadLiveData: async () => ({ eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {}, usage: {}, providers: {} }),
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
    "  Unavailable — Cursor Models quota exhausted"
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
    loadLiveData: async () => ({ eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {}, usage: {}, providers: {} }),
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

  // Two-phase: the immediate "checking" render, then the re-render once
  // real availability/usage resolved — never fewer than both.
  assert.deepEqual(calls[0], ["status", "kairo", "Kairo · agentic-harness · agent"]);
  assert.equal(calls[1][0], "widget");
  assert.equal(typeof calls[1][2], "function", "the overview render is a component factory");
  assert.deepEqual(calls[2], ["status", "kairo", "Kairo · agentic-harness · agent"]);
  assert.equal(calls[3][0], "widget");
  assert.equal(calls.length, 4);

  const firstLines = renderWidgetCall(calls[1][2]);
  const secondLines = renderWidgetCall(calls[3][2]);
  assert.deepEqual(firstLines, secondLines, "loadSnapshot returns the same fixture snapshot in both phases here");
  assert.ok(firstLines.some((line) => line.includes("Builder")));
});

test("extension renders live data in two phases: checking immediately, then real team availability and usage", async () => {
  const { pi, events } = fakePi();
  const widgetCalls = [];
  const checkingSnapshot = {
    ...snapshot,
    team: { ...snapshot.team, rows: [{ role: "Builder", model: "GPT-6 Terra", via: "codex", accessMode: "automatic", availability: { state: "checking", warning: null } }] },
    subscriptions: { state: "checking", segments: [], usageModel: [] }
  };
  const resolvedSnapshot = {
    ...snapshot,
    team: { ...snapshot.team, rows: [{ role: "Builder", model: "GPT-6 Terra", via: "codex", accessMode: "automatic", availability: { state: "available", warning: null } }] },
    subscriptions: snapshot.subscriptions
  };

  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async ({ intelligence } = {}) => (intelligence === undefined ? checkingSnapshot : resolvedSnapshot),
    loadLiveData: async () => ({ eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {}, usage: {}, providers: {} }),
    loadRouteModels: async () => [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }]
  });

  await events.get("session_start")({}, {
    cwd: "/repo",
    ui: { setStatus: () => {}, setWidget: (...args) => widgetCalls.push(args), notify: () => {} }
  });

  assert.equal(widgetCalls.length, 2);
  const firstLines = renderWidgetCall(widgetCalls[0][1]);
  const secondLines = renderWidgetCall(widgetCalls[1][1]);
  assert.ok(firstLines.some((line) => line.includes("usage checking")), "first render shows usage checking");
  assert.ok(firstLines.some((line) => line.includes("checking")), "first render shows team checking too");
  assert.ok(secondLines.some((line) => line.includes("58%")), "second render shows real usage");
  assert.ok(!secondLines.some((line) => line.includes("available")), "the resolved-available row prints no 'available' marker (only exceptions do)");
});

test("extension shows unknown rows, usage unknown, and one explanatory line when the live data check fails", async () => {
  const { pi, events } = fakePi();
  const widgetCalls = [];
  const failedSnapshot = {
    ...snapshot,
    team: {
      ...snapshot.team,
      rows: snapshot.team.rows.map((row) => ({ ...row, availability: { state: "unknown", warning: null } }))
    },
    subscriptions: { state: "unknown", segments: [], usageModel: [] }
  };

  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async ({ intelligence } = {}) => (intelligence === null ? failedSnapshot : snapshot),
    loadLiveData: async () => null,
    loadRouteModels: async () => [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }]
  });

  await events.get("session_start")({}, {
    cwd: "/repo",
    ui: { setStatus: () => {}, setWidget: (...args) => widgetCalls.push(args), notify: () => {} }
  });

  const finalLines = renderWidgetCall(widgetCalls.at(-1)[1]);
  assert.ok(finalLines.some((line) => line.includes("usage unknown")), "usage shown as unknown");
  assert.ok(
    finalLines.some((line) => line.toLowerCase().includes("availability check failed")),
    "one line explains the failed check"
  );
});
