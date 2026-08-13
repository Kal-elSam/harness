"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { fleetReportFromControlPlane } = require("../src/control-plane-cache.js");
const { buildPanelModel } = require("../src/panel-model.js");
const { panelStyles } = require("../src/panel-styles.js");
const {
  primaryActionsFromModel,
  renderFleetTree,
  renderPanelHtml,
  renderWorkflowSection
} = require("../src/panel-html.js");

test("buildPanelModel + render never show No platforms when fleets exist", () => {
  const controlPlane = {
    schema: "kairo.control-plane/v1",
    ok: true,
    sections: {
      work: { ok: true },
      workflow: { ok: true },
      team: { ok: true },
      attention: { ok: true }
    },
    workflow: { kind: "none", active: false, label: "No active workflow", review: null },
    attention: {
      items: [],
      primaryActions: [{ id: "models", label: "Models", command: "kairo fleet models" }],
      secondaryActions: [{ id: "setup", label: "Setup", command: "kairo setup" }]
    },
    team: {
      platforms: [{
        platform: "cursor",
        honesty: "opaque",
        orchestrator: { id: "auto", honesty: "opaque" },
        agents: [{ id: "sdd-apply", honesty: "declared" }]
      }],
      connections: [{ id: "agent", state: "connected", label: "Agent" }],
      orchestratorAuthority: "gentle-ai"
    },
    work: {
      schema: "kairo.next/v1",
      ok: true,
      goal: "Ship",
      progress: [],
      now: "Panel",
      blockers: [],
      next: "Accept",
      conversationId: "c1",
      updatedAt: "2026-08-12T00:00:00.000Z",
      integration: {
        state: "active",
        showRepair: false,
        mcpConnected: true,
        enrolled: true
      }
    }
  };
  const fleetReport = fleetReportFromControlPlane(controlPlane);
  const model = buildPanelModel(
    { installed: true, overall: "ok", nextAction: "All clear", checks: [], cliVersion: "0.16.0" },
    fleetReport.connections,
    fleetReport,
    controlPlane.work,
    controlPlane
  );
  assert.equal(model.hideEmptyPlatforms, true);
  assert.equal(model.fleetNodes[0].honesty, "opaque");
  assert.equal(model.fleetNodes[0].minionCount, 1);
  assert.match(model.fleetNodes[0].subtitle, /1 agent/);
  const html = renderPanelHtml(model, "n1");
  assert.match(html, /id="ahora"/);
  assert.match(html, /id="workflow"/);
  assert.match(html, /Equipo/);
  assert.match(html, /id="atencion"/);
  assert.match(html, /No active workflow/);
  assert.match(html, /Opaque/);
  assert.match(html, /1 agent/);
  assert.doesNotMatch(html, /No platforms detected/);
  assert.doesNotMatch(html, /Connections loading…/);
  assert.equal(primaryActionsFromModel(model).length, 1);
});

test("renderFleetTree hides empty platforms when hideEmptyPlatforms", () => {
  const html = renderFleetTree([], { hideEmptyPlatforms: true });
  assert.match(html, /Team section degraded/);
  assert.doesNotMatch(html, /No platforms detected/);
});

test("renderWorkflowSection shows receipt only with Gentle evidence", () => {
  const none = renderWorkflowSection({ kind: "none", active: false, label: "No active workflow" });
  assert.match(none, /No active workflow/);
  const withReceipt = renderWorkflowSection({
    kind: "review",
    active: true,
    label: "Review",
    changeName: "cp",
    phase: null,
    nextTransition: null,
    review: { state: "approved", gate: "pre-commit", receipt: "sha256:abcdef0123456789" }
  });
  assert.match(withReceipt, /gate pre-commit/);
  assert.match(withReceipt, /receipt sha256:abcdef0123456789/);
  const degraded = renderWorkflowSection(
    { kind: "none", active: false },
    { degraded: true, error: "gentle_unavailable" }
  );
  assert.match(degraded, /degraded/);
  assert.match(degraded, /Install gentle-ai separately/);
  assert.match(degraded, /Work and Equipo remain/);
});

test("renderWorkflowSection fixtures: upgrade / incompatible / official next_transition", () => {
  const upgrade = renderWorkflowSection(
    { kind: "none", active: false, provider: "upgrade_required" },
    { degraded: true, error: "gentle_upgrade_required" }
  );
  assert.match(upgrade, /Upgrade Gentle/);
  assert.doesNotMatch(upgrade, /Review/);

  const incompatible = renderWorkflowSection(
    { kind: "none", active: false, provider: "incompatible" },
    { degraded: true, error: "gentle_incompatible" }
  );
  assert.match(incompatible, /incompatible/);
  assert.match(incompatible, /Fail closed/);

  const command = "gentle-ai review start --contract=gentle-ai.review-integration/v2 --target=sha256:37367ed91a1878791655f52b33cc0123456789abcdef0123456789abcdef0123 --consent=relay --agent claude-code";
  const connected = renderWorkflowSection({
    kind: "review",
    active: true,
    label: "Review",
    nextTransition: {
      kind: "execute",
      reason_code: "fresh_target_ready",
      execute: { operation: "review.start", command }
    },
    review: { receipt: null, gate: null }
  });
  assert.match(connected, /fresh_target_ready/);
  assert.match(connected, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(connected, /<pre class="next-cmd">/);
  assert.doesNotMatch(connected, /next-cmd[^>]*>[^<]*…/);
  assert.doesNotMatch(connected, /\[object Object\]/);
  const css = panelStyles();
  assert.match(css, /\.next-cmd\s*\{[^}]*white-space:\s*pre-wrap/);
  assert.match(css, /\.next-cmd\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(css, /overflow-x:\s*hidden/);
  assert.doesNotMatch(renderPanelHtml({
    headline: "Ready", overall: "ok", entries: [], connections: [], fleetNodes: [],
    attention: { items: [], primaryActions: [], secondaryActions: [] },
    workflow: { kind: "review", active: true, nextTransition: { execute: { command } } },
    work: { present: true }
  }, "n-wrap"), /overflow-x:\s*hidden/);
});
