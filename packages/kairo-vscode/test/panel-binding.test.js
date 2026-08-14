"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildPanelModel } = require("../src/panel-model.js");
const { describeWorkspaceBinding } = require("../src/panel-binding.js");
const {
  primaryActionsFromModel,
  renderPanelHtml
} = require("../src/panel-html.js");

const readyStatus = {
  installed: true,
  overall: "ok",
  nextAction: "All clear",
  checks: []
};

const brokenNext = {
  schema: "kairo.next/v1",
  ok: false,
  goal: null,
  progress: [],
  now: null,
  blockers: [],
  next: null,
  integration: {
    state: "broken",
    showRepair: true,
    mcpConnected: true,
    detail: "Could not read mcp.json"
  }
};

test("unbound and ambiguous show attention, not Repair-for-registration", () => {
  const inferred = describeWorkspaceBinding({
    folders: [{ uri: { fsPath: "/ws/only" } }],
    mcpApiAvailable: true,
    providerRegistered: false
  });
  assert.equal(inferred.state, "unbound");
  assert.equal(inferred.writable, false);

  const unbound = buildPanelModel(
    readyStatus,
    [{ id: "agent", state: "connected" }],
    null,
    brokenNext,
    null,
    { folders: [], mcpApiAvailable: true, providerRegistered: false }
  );
  assert.equal(unbound.headline, "Needs attention");
  assert.equal(unbound.workspaceBinding.state, "unbound");
  assert.ok(!unbound.actions.some((a) => a.id === "repair-integration"));
  assert.equal(unbound.actions[0].id, "open-folder");
  assert.equal(unbound.work.goal, null);
  const html = renderPanelHtml(unbound, "n");
  assert.match(html, /Open folder/);
  assert.doesNotMatch(html, /kairo mcp install/);

  const ambiguous = buildPanelModel(
    readyStatus,
    [{ id: "agent", state: "connected" }],
    null,
    brokenNext,
    null,
    {
      folders: [{ uri: { fsPath: "/a" } }, { uri: { fsPath: "/b" } }],
      mcpApiAvailable: true,
      providerRegistered: false
    }
  );
  assert.equal(ambiguous.workspaceBinding.state, "ambiguous");
  assert.ok(!ambiguous.actions.some((a) => a.id === "repair-integration"));
  assert.equal(primaryActionsFromModel(ambiguous)[0].id, "open-folder");
});

test("ready requires observed registration; missing API offers Upgrade Cursor", () => {
  const ready = buildPanelModel(
    readyStatus,
    [{ id: "agent", state: "not_connected" }],
    null,
    {
      schema: "kairo.next/v1",
      ok: true,
      goal: "Ship",
      progress: [],
      now: "Panel",
      blockers: [],
      next: "Accept",
      integration: { state: "active", showRepair: false, mcpConnected: false }
    },
    null,
    { folders: [{ uri: { fsPath: "/ws/only" } }], mcpApiAvailable: true, providerRegistered: true }
  );
  assert.equal(ready.headline, "Ready");
  assert.equal(ready.workspaceBinding.state, "ready");
  assert.ok(!ready.attention?.items?.some((item) => item.id === "workspace-binding"));
  assert.ok(ready.actions.some((a) => a.id === "connect-agent"));
  assert.doesNotMatch(JSON.stringify(ready.workspaceBinding), /live process|PID/i);

  const missingApi = buildPanelModel(
    readyStatus,
    [{ id: "agent", state: "connected" }],
    null,
    null,
    null,
    { folders: [{ uri: { fsPath: "/ws/only" } }], mcpApiAvailable: false, providerRegistered: false }
  );
  assert.equal(missingApi.workspaceBinding.state, "unbound");
  assert.equal(primaryActionsFromModel(missingApi)[0].id, "upgrade-cursor");
  assert.ok(!missingApi.actions.some((a) => a.id === "reload-window"));
  assert.ok(!missingApi.actions.some((a) => a.id === "repair-integration"));
});
