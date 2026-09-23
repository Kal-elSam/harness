import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createKairoWorkspaceExtension,
  formatKairoWorkspaceLines
} from "../src/global/host/extension/index.js";

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
    segments: ["Codex 5h 58% / W 86%", "Claude S 34% / W 65%", "Go 100% / 100% / 96%"]
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

test("workspace opening surface always shows subscription usage right after the session line, plus every team role", () => {
  assert.deepEqual(formatKairoWorkspaceLines(snapshot), [
    "KAIRO WORKSPACE · agentic-harness",
    "SESSION · session 11111111 · agent",
    "USAGE · Codex 5h 58% / W 86% │ Claude S 34% / W 65% │ Go 100% / 100% / 96%",
    "TEAM · active",
    "Builder · GPT-6 Terra · codex · checking",
    "Reviewer · MiniMax-M3 · opencode-go · BLOCKED",
    "Details: /kairo-team · /kairo-route · /kairo-usage · /kairo-memory"
  ]);
});

test("workspace opening surface shows USAGE · checking before live data, and USAGE · unknown on a failed check", () => {
  const checking = { ...snapshot, subscriptions: { state: "checking", segments: [] } };
  const unknown = { ...snapshot, subscriptions: { state: "unknown", segments: [] } };

  assert.equal(formatKairoWorkspaceLines(checking)[2], "USAGE · checking");
  assert.equal(formatKairoWorkspaceLines(unknown)[2], "USAGE · unknown");
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

test("extension replaces a missing Pi route with an actionable Kairo state, but still shows usage and the team rows", async () => {
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
      setWidget: (...args) => calls.push(args)
    }
  });

  assert.deepEqual(calls.at(-1), ["kairo-workspace", [
    "KAIRO ROUTES · unavailable",
    "No verified automatic route is available for this project.",
    "Next: run kairo --legacy-cockpit, then /project analyze.",
    "USAGE · Codex 5h 58% / W 86% │ Claude S 34% / W 65% │ Go 100% / 100% / 96%",
    "TEAM · active",
    "Builder · GPT-6 Terra · codex · checking",
    "Reviewer · MiniMax-M3 · opencode-go · BLOCKED"
  ]]);
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
      setWidget: (...args) => calls.push(["widget", ...args])
    }
  });

  // Two-phase: the immediate "checking" render, then the re-render once
  // real availability/usage resolved — never fewer than both.
  assert.deepEqual(calls[0], ["status", "kairo", "Kairo · agentic-harness · agent"]);
  assert.deepEqual(calls[1], ["widget", "kairo-workspace", formatKairoWorkspaceLines(snapshot)]);
  assert.deepEqual(calls[2], ["status", "kairo", "Kairo · agentic-harness · agent"]);
  assert.deepEqual(calls[3], ["widget", "kairo-workspace", formatKairoWorkspaceLines(snapshot)]);
  assert.equal(calls.length, 4);
});

test("extension renders live data in two phases: checking immediately, then real team availability and usage", async () => {
  const { pi, events } = fakePi();
  const widgetCalls = [];
  const checkingSnapshot = {
    ...snapshot,
    team: { ...snapshot.team, rows: [{ role: "Builder", model: "GPT-6 Terra", via: "codex", accessMode: "automatic", availability: { state: "checking", warning: null } }] },
    subscriptions: { state: "checking", segments: [] }
  };
  const resolvedSnapshot = {
    ...snapshot,
    team: { ...snapshot.team, rows: [{ role: "Builder", model: "GPT-6 Terra", via: "codex", accessMode: "automatic", availability: { state: "available", warning: null } }] },
    subscriptions: { state: "ready", segments: ["Codex 5h 58% / W 86%", "Claude S 34% / W 65%", "Go 100% / 100% / 96%"] }
  };

  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async ({ intelligence } = {}) => (intelligence === undefined ? checkingSnapshot : resolvedSnapshot),
    loadLiveData: async () => ({ eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {}, usage: {}, providers: {} }),
    loadRouteModels: async () => [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }]
  });

  await events.get("session_start")({}, {
    cwd: "/repo",
    ui: { setStatus: () => {}, setWidget: (...args) => widgetCalls.push(args) }
  });

  assert.equal(widgetCalls.length, 2);
  assert.ok(widgetCalls[0][1].some((line) => line === "USAGE · checking"), "first render shows USAGE · checking");
  assert.ok(widgetCalls[0][1].some((line) => line.includes("checking")), "first render shows team checking too");
  assert.ok(widgetCalls[1][1].some((line) => line.includes("Codex 5h 58%")), "second render shows real usage");
  assert.ok(widgetCalls[1][1].some((line) => line.includes("available")), "second render shows real team availability");
});

test("extension shows unknown rows, USAGE · unknown, and one explanatory line when the live data check fails", async () => {
  const { pi, events } = fakePi();
  const widgetCalls = [];
  const failedSnapshot = {
    ...snapshot,
    team: {
      ...snapshot.team,
      rows: snapshot.team.rows.map((row) => ({ ...row, availability: { state: "unknown", warning: null } }))
    },
    subscriptions: { state: "unknown", segments: [] }
  };

  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async ({ intelligence } = {}) => (intelligence === null ? failedSnapshot : snapshot),
    loadLiveData: async () => null,
    loadRouteModels: async () => [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }]
  });

  await events.get("session_start")({}, {
    cwd: "/repo",
    ui: { setStatus: () => {}, setWidget: (...args) => widgetCalls.push(args) }
  });

  const finalLines = widgetCalls.at(-1)[1];
  assert.ok(finalLines.includes("USAGE · unknown"), "usage shown as unknown");
  assert.ok(finalLines.some((line) => line.includes("unknown")), "unknown status shown for every team row");
  assert.ok(
    finalLines.some((line) => line.toLowerCase().includes("availability check failed")),
    "one line explains the failed check"
  );
});

test("extension registers only Kairo workspace commands and refreshes their matching compact view", async () => {
  const { pi, commands } = fakePi();
  createKairoWorkspaceExtension(pi, { loadSnapshot: async () => snapshot });

  assert.deepEqual([...commands.keys()], [
    "kairo", "kairo-team", "kairo-sessions", "kairo-usage", "kairo-route", "kairo-memory"
  ]);

  const teamCalls = [];
  await commands.get("kairo-team").handler("", {
    cwd: "/repo",
    ui: { setWidget: (...args) => teamCalls.push(args) }
  });
  assert.deepEqual(teamCalls, [["kairo-workspace", [
    "KAIRO TEAM · active",
    "Builder · GPT-6 Terra · codex · checking",
    "Reviewer · MiniMax-M3 · opencode-go · BLOCKED",
    "  Unavailable — Cursor Models quota exhausted"
  ]]]);

  const usageCalls = [];
  await commands.get("kairo-usage").handler("", {
    cwd: "/repo",
    ui: { setWidget: (...args) => usageCalls.push(args) }
  });
  assert.deepEqual(usageCalls, [["kairo-workspace", [
    "KAIRO USAGE",
    "USAGE · Codex 5h 58% / W 86% │ Claude S 34% / W 65% │ Go 100% / 100% / 96%",
    "codex 2400 tokens"
  ]]]);
});
