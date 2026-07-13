import test from "node:test";
import assert from "node:assert/strict";
import {
  ORCHESTRATOR_MENU,
  ORCHESTRATOR_VIEWS,
  formatDashboardSnapshot,
  formatDiagnosticsLines,
  formatProviderLines,
  formatRunLines,
  isRunCancellable,
  resolveMenuItem,
  resolveMenuItemView,
  shiftMenuIndex
} from "../src/global/ink/orchestrator-state.js";
import { RUN_STATES } from "../src/global/runtime/run-types.js";

const sampleDiagnostics = {
  cliVersion: "0.2.0",
  diagnostics: {
    detected: 2,
    available: 1,
    unknown: 1,
    errors: 0
  },
  capabilities: [
    {
      id: "cursor",
      label: "Cursor",
      state: "available",
      version: "1.0.0",
      authenticated: true
    },
    {
      id: "codex",
      label: "Codex",
      state: "unknown",
      version: null,
      authenticated: null
    }
  ],
  recommendations: ["Install Codex CLI."]
};

test("runtime menu exposes operations views", () => {
  const activeItem = ORCHESTRATOR_MENU.find((item) => item.id === "active");
  const diagnosticsItem = ORCHESTRATOR_MENU.find((item) => item.id === "diagnostics");

  assert.equal(activeItem.label, "Running now");
  assert.equal(diagnosticsItem.label, "System health");
  assert.equal(activeItem.view, ORCHESTRATOR_VIEWS.ACTIVE_RUNS);
  assert.equal(diagnosticsItem.view, ORCHESTRATOR_VIEWS.DIAGNOSTICS);
  assert.equal(resolveMenuItemView(0), ORCHESTRATOR_VIEWS.ACTIVE_RUNS);
});

test("formatDiagnosticsLines separates agents, intelligence, auth, and configuration", () => {
  const lines = formatDiagnosticsLines({
    ...sampleDiagnostics,
    intelligence: {
      summary: { localAvailable: false, cloudAuthenticated: false },
      routingPreview: { reason: "No backend" }
    },
    profile: { sources: ["global"] }
  });
  const text = lines.join("\n");

  assert.match(text, /^Agents$/m);
  assert.match(text, /Detected: 2\/2/);
  assert.match(text, /^Intelligence$/m);
  assert.match(text, /^Authentication$/m);
  assert.match(text, /^Configuration$/m);
  assert.match(text, /CLI version: 0\.2\.0/);
  assert.match(text, /Cursor/);
  assert.match(text, /Codex/);
  assert.match(text, /Recommendations/);
});

test("formatRunLines and provider helpers render dashboard data", () => {
  const runs = formatRunLines([
    {
      runId: "run_1",
      state: RUN_STATES.RUNNING,
      agentId: "cursor",
      taskDigest: "abc123def456",
      taskLength: 11
    }
  ]);

  assert.match(runs[0], /run_1/);
  assert.match(runs[0], /content not stored/);
  assert.doesNotMatch(runs[0], /Review code/);

  const readable = formatRunLines([
    {
      runId: "run_1",
      state: RUN_STATES.FAILED,
      agentId: "codex",
      taskDigest: "abc123def456",
      taskLength: 11
    }
  ], { readable: true });
  assert.match(readable[0], /Codex · Failed/);
  assert.doesNotMatch(readable[0], /run_1/);

  const providers = formatProviderLines([
    { label: "Cursor", compatible: true, available: true, launchable: true, reason: null },
    { label: "OpenCode", compatible: false, available: true, launchable: false, reason: "limited" }
  ]);

  assert.match(providers[0], /launchable/);
  assert.match(providers[1], /limited/);

  const snapshot = formatDashboardSnapshot({
    activeRuns: [{ runId: "run_1" }],
    recentRuns: [],
    providers: [{ compatible: true }, { compatible: false }]
  });

  assert.match(snapshot.join("\n"), /Active runs: 1/);
  assert.match(snapshot.join("\n"), /Auditable providers: 1\/2/);
});

test("isRunCancellable only allows active states", () => {
  assert.equal(isRunCancellable({ state: RUN_STATES.RUNNING }), true);
  assert.equal(isRunCancellable({ state: RUN_STATES.COMPLETED }), false);
});

test("shiftMenuIndex clamps selection within menu bounds", () => {
  const menuLength = ORCHESTRATOR_MENU.length;

  assert.equal(shiftMenuIndex(0, "up", menuLength), 0);
  assert.equal(shiftMenuIndex(0, "down", menuLength), 1);
  assert.equal(shiftMenuIndex(menuLength - 1, "down", menuLength), menuLength - 1);
  assert.equal(shiftMenuIndex(2, "up", menuLength), 1);
});

test("resolveMenuItem returns launch action", () => {
  const launchIndex = ORCHESTRATOR_MENU.findIndex((item) => item.id === "launch");

  assert.ok(launchIndex >= 0);
  assert.equal(resolveMenuItem(launchIndex)?.action, "launch");
  assert.equal(resolveMenuItem(launchIndex)?.view, ORCHESTRATOR_VIEWS.LAUNCH);
  assert.equal(resolveMenuItem(999), null);
});

test("resolveMenuItemView maps each menu entry to its configured view", () => {
  for (const [index, item] of ORCHESTRATOR_MENU.entries()) {
    assert.equal(resolveMenuItemView(index), item.view);
  }
});
