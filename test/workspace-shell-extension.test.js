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

test("workspace opening surface lists every role on its own row instead of a count", () => {
  assert.deepEqual(formatKairoWorkspaceLines(snapshot), [
    "KAIRO WORKSPACE · agentic-harness",
    "SESSION · session 11111111 · agent",
    "TEAM · active",
    "Builder · GPT-6 Terra · codex · checking",
    "Reviewer · MiniMax-M3 · opencode-go · BLOCKED",
    "Details: /kairo-team · /kairo-route · /kairo-usage · /kairo-memory"
  ]);
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

test("extension replaces a missing Pi route with an actionable Kairo state, but still shows the team rows", async () => {
  const { pi, events } = fakePi();
  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async () => snapshot,
    loadTeamAvailability: async () => ({ eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {} }),
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
    loadTeamAvailability: async () => ({ eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {} }),
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
  // real availability resolved — never fewer than both.
  assert.deepEqual(calls[0], ["status", "kairo", "Kairo · agentic-harness · agent"]);
  assert.deepEqual(calls[1], ["widget", "kairo-workspace", formatKairoWorkspaceLines(snapshot)]);
  assert.deepEqual(calls[2], ["status", "kairo", "Kairo · agentic-harness · agent"]);
  assert.deepEqual(calls[3], ["widget", "kairo-workspace", formatKairoWorkspaceLines(snapshot)]);
  assert.equal(calls.length, 4);
});

test("extension renders team availability in two phases: checking immediately, then real availability", async () => {
  const { pi, events } = fakePi();
  const widgetCalls = [];
  const checkingSnapshot = {
    ...snapshot,
    team: { ...snapshot.team, rows: [{ role: "Builder", model: "GPT-6 Terra", via: "codex", accessMode: "automatic", availability: { state: "checking", warning: null } }] }
  };
  const resolvedSnapshot = {
    ...snapshot,
    team: { ...snapshot.team, rows: [{ role: "Builder", model: "GPT-6 Terra", via: "codex", accessMode: "automatic", availability: { state: "available", warning: null } }] }
  };

  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async ({ intelligence } = {}) => (intelligence === undefined ? checkingSnapshot : resolvedSnapshot),
    loadTeamAvailability: async () => ({ eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {} }),
    loadRouteModels: async () => [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }]
  });

  await events.get("session_start")({}, {
    cwd: "/repo",
    ui: { setStatus: () => {}, setWidget: (...args) => widgetCalls.push(args) }
  });

  assert.equal(widgetCalls.length, 2);
  assert.ok(widgetCalls[0][1].some((line) => line.includes("checking")), "first render shows checking");
  assert.ok(widgetCalls[1][1].some((line) => line.includes("available")), "second render shows real availability");
});

test("extension shows unknown rows plus one explanatory line when the live availability check fails", async () => {
  const { pi, events } = fakePi();
  const widgetCalls = [];
  const failedSnapshot = {
    ...snapshot,
    team: {
      ...snapshot.team,
      rows: snapshot.team.rows.map((row) => ({ ...row, availability: { state: "unknown", warning: null } }))
    }
  };

  createKairoWorkspaceExtension(pi, {
    loadSnapshot: async ({ intelligence } = {}) => (intelligence === null ? failedSnapshot : snapshot),
    loadTeamAvailability: async () => null,
    loadRouteModels: async () => [{ id: "codex::gpt-6-astra", kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra" } }]
  });

  await events.get("session_start")({}, {
    cwd: "/repo",
    ui: { setStatus: () => {}, setWidget: (...args) => widgetCalls.push(args) }
  });

  const finalLines = widgetCalls.at(-1)[1];
  assert.ok(finalLines.some((line) => line.includes("unknown")), "unknown status shown for every row");
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

  const calls = [];
  await commands.get("kairo-team").handler("", {
    cwd: "/repo",
    ui: { setWidget: (...args) => calls.push(args) }
  });
  assert.deepEqual(calls, [["kairo-workspace", [
    "KAIRO TEAM · active",
    "Builder · GPT-6 Terra · codex · checking",
    "Reviewer · MiniMax-M3 · opencode-go · BLOCKED",
    "  Unavailable — Cursor Models quota exhausted"
  ]]]);
});
