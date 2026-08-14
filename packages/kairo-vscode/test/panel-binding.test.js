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
    providerRegistered: true
  });
  assert.equal(inferred.state, "unbound");
  assert.equal(inferred.writable, false);

  const unbound = buildPanelModel(
    readyStatus,
    [{ id: "agent", state: "connected" }],
    null,
    brokenNext,
    null,
    { folders: [], registration: { state: "unbound", reason: "empty_window" } }
  );
  assert.equal(unbound.headline, "Needs attention");
  assert.equal(unbound.workspaceBinding.state, "unbound");
  assert.ok(!unbound.actions.some((a) => a.id === "repair-integration"));
  assert.equal(unbound.actions[0].id, "open-folder");
  const html = renderPanelHtml(unbound, "n");
  assert.match(html, /Open folder/);
  assert.doesNotMatch(html, /kairo mcp install/);
  assert.doesNotMatch(html, />Bound</);

  const ambiguous = buildPanelModel(
    readyStatus,
    [{ id: "agent", state: "connected" }],
    null,
    brokenNext,
    null,
    {
      folders: [{ uri: { fsPath: "/a" } }, { uri: { fsPath: "/b" } }],
      registration: { state: "ambiguous", reason: "multi_root" }
    }
  );
  assert.equal(ambiguous.workspaceBinding.state, "ambiguous");
  assert.equal(primaryActionsFromModel(ambiguous)[0].id, "open-folder");
});

test("Bound requires registered state; recoveries match reason", () => {
  const bound = buildPanelModel(
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
    {
      folders: [{ uri: { fsPath: "/ws/only" } }],
      registration: { state: "registered", registered: true }
    }
  );
  assert.equal(bound.workspaceBinding.state, "bound");
  assert.equal(bound.workspaceBinding.label, "Bound");
  assert.match(renderPanelHtml(bound, "n"), />Bound</);
  assert.doesNotMatch(JSON.stringify(bound.workspaceBinding), /live|PID|ready/i);

  const missingApi = buildPanelModel(
    readyStatus,
    [{ id: "agent", state: "connected" }],
    null,
    null,
    null,
    {
      folders: [{ uri: { fsPath: "/ws/only" } }],
      registration: { state: "unbound", reason: "api_unavailable" }
    }
  );
  assert.equal(primaryActionsFromModel(missingApi)[0].id, "upgrade-cursor");
  assert.ok(!missingApi.actions.some((a) => a.id === "repair-integration"));

  const failed = describeWorkspaceBinding({
    folders: [{ uri: { fsPath: "/ws/only" } }],
    registration: { state: "registration_failed", reason: "register_failed" }
  });
  assert.equal(failed.recovery.id, "reload-window");

  const untrusted = describeWorkspaceBinding({
    folders: [{ uri: { fsPath: "/ws/only" } }],
    registration: { state: "unbound", reason: "workspace_untrusted" }
  });
  assert.equal(untrusted.recovery.id, "trust-workspace");

  const remote = describeWorkspaceBinding({
    folders: [{ uri: { fsPath: "/ws/only" } }],
    registration: { state: "unbound", reason: "unsupported_scheme" }
  });
  assert.match(remote.attention.message, /not a local file folder/);

  const registering = describeWorkspaceBinding({
    folders: [{ uri: { fsPath: "/ws/only" } }],
    registration: { state: "registering" }
  });
  assert.equal(registering.state, "unbound");
  assert.equal(registering.recovery, null);
  assert.equal(registering.label, undefined);

  const pending = buildPanelModel(
    readyStatus,
    [{ id: "agent", state: "connected" }],
    null,
    brokenNext,
    null,
    {
      folders: [{ uri: { fsPath: "/ws/only" } }],
      registration: { state: "registering" }
    }
  );
  assert.notEqual(pending.headline, "Needs attention");
  assert.ok(!pending.actions.some((a) => a.id === "repair-integration"));
});
