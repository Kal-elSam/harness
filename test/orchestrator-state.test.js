import test from "node:test";
import assert from "node:assert/strict";
import {
  ORCHESTRATOR_MENU,
  ORCHESTRATOR_VIEWS,
  formatDiagnosticsLines,
  resolveMenuItem,
  resolveMenuItemView,
  shiftMenuIndex
} from "../src/global/ink/orchestrator-state.js";

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
  intelligence: {
    summary: {
      localAvailable: true,
      cloudAuthenticated: false
    },
    routingPreview: {
      reason: "local backend ready",
      canInvoke: true
    },
    backends: [
      {
        label: "Ollama",
        state: "available",
        models: ["llama3"]
      }
    ]
  },
  recommendations: ["Start Ollama for local inference."]
};

test("Diagnostics menu item opens diagnostics view instead of home", () => {
  const diagnosticsItem = ORCHESTRATOR_MENU.find((item) => item.id === "status");

  assert.ok(diagnosticsItem);
  assert.equal(diagnosticsItem.view, ORCHESTRATOR_VIEWS.DIAGNOSTICS);
  assert.notEqual(diagnosticsItem.view, ORCHESTRATOR_VIEWS.HOME);
  assert.equal(resolveMenuItemView(0), ORCHESTRATOR_VIEWS.DIAGNOSTICS);
});

test("formatDiagnosticsLines includes summary, intelligence, and agent capabilities", () => {
  const lines = formatDiagnosticsLines(sampleDiagnostics);
  const text = lines.join("\n");

  assert.match(text, /Summary/);
  assert.match(text, /CLI version: 0\.2\.0/);
  assert.match(text, /Agents detected: 2\/2/);
  assert.match(text, /Intelligence availability/);
  assert.match(text, /Local available: yes/);
  assert.match(text, /Agent capabilities/);
  assert.match(text, /Cursor/);
  assert.match(text, /Codex/);
  assert.match(text, /Recommendations/);
  assert.match(text, /Start Ollama/);
});

test("shiftMenuIndex clamps selection within menu bounds", () => {
  const menuLength = ORCHESTRATOR_MENU.length;

  assert.equal(shiftMenuIndex(0, "up", menuLength), 0);
  assert.equal(shiftMenuIndex(0, "down", menuLength), 1);
  assert.equal(shiftMenuIndex(menuLength - 1, "down", menuLength), menuLength - 1);
  assert.equal(shiftMenuIndex(2, "up", menuLength), 1);
});

test("resolveMenuItem returns setup action for plan entry", () => {
  const planIndex = ORCHESTRATOR_MENU.findIndex((item) => item.id === "plan-setup");

  assert.ok(planIndex >= 0);
  assert.equal(resolveMenuItem(planIndex)?.action, "setup");
  assert.equal(resolveMenuItem(planIndex)?.view, ORCHESTRATOR_VIEWS.PLAN);
  assert.equal(resolveMenuItem(999), null);
});

test("resolveMenuItemView maps each menu entry to its configured view", () => {
  for (const [index, item] of ORCHESTRATOR_MENU.entries()) {
    assert.equal(resolveMenuItemView(index), item.view);
  }
});
