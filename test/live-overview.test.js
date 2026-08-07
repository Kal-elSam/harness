import test from "node:test";
import assert from "node:assert/strict";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";
import { buildControlCenterModel } from "../src/global/ink/cockpit-control-center.js";
import {
  createCockpitUiState,
  reduceCockpitUi
} from "../src/global/ink/cockpit-controller.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";
import { ActionList } from "../src/global/ink/ux/semantic.js";
import { buildFooterModel, COCKPIT_REGIONS } from "../src/global/ink/cockpit-models.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import {
  overviewBrandTitle,
  shouldShowWordmark,
  wordmarkLines
} from "../src/global/ink/brand/wordmark.js";
import {
  adaptControlCenterToOverview,
  buildOverviewDetails,
  humanizeCompanionNeed,
  humanizeHealthTitle,
  mapHealthTone,
  partitionCompanionLines,
  SemanticOverviewPanel
} from "../src/global/ink/ux/live-overview.js";

function modelFor(health, extras = {}) {
  const ctaByHealth = {
    [CONTROL_PLANE_HEALTH.NOT_CONFIGURED]: {
      kind: "setup", title: "Finish local setup", detail: "Configure agents.", destination: "setup"
    },
    [CONTROL_PLANE_HEALTH.ACTION_REQUIRED]: {
      kind: "repair",
      title: "Review and repair drift",
      detail: 'Run "kairo sync" to repair managed content.',
      destination: "changes"
    },
    [CONTROL_PLANE_HEALTH.CHECK_FAILED]: {
      kind: "verify", title: "Investigate failed checks", detail: "Run kairo doctor.", destination: "control-center"
    },
    [CONTROL_PLANE_HEALTH.HEALTHY]: {
      kind: "idle", title: "Ecosystem healthy", detail: "No action needed.", destination: "control-center"
    },
    [CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES]: {
      kind: "review", title: "Review notes", detail: "Open Changes.", destination: "control-center"
    }
  };
  return buildControlCenterModel({
    projectName: "demo",
    snapshot: {
      health,
      coverage: { governedAgents: 1, detectedAgents: 2 },
      diff: { hasChanges: health === CONTROL_PLANE_HEALTH.ACTION_REQUIRED },
      cta: ctaByHealth[health] ?? ctaByHealth[CONTROL_PLANE_HEALTH.HEALTHY],
      ...extras
    },
    alerts: extras.alerts
  });
}

test("adapter maps health tones and plain-language titles", () => {
  assert.equal(mapHealthTone(CONTROL_PLANE_HEALTH.CHECK_FAILED), "danger");
  assert.equal(mapHealthTone(CONTROL_PLANE_HEALTH.ACTION_REQUIRED), "warn");
  assert.equal(mapHealthTone(CONTROL_PLANE_HEALTH.NOT_CONFIGURED), "warn");
  assert.equal(mapHealthTone(CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES), "warn");
  assert.equal(mapHealthTone(CONTROL_PLANE_HEALTH.HEALTHY), "ready");
  assert.equal(humanizeHealthTitle(CONTROL_PLANE_HEALTH.ACTION_REQUIRED), "Needs attention");
  assert.equal(humanizeHealthTitle(CONTROL_PLANE_HEALTH.HEALTHY), "Ready");

  const failed = adaptControlCenterToOverview(modelFor(CONTROL_PLANE_HEALTH.CHECK_FAILED), {
    hasGlobalState: true,
    snapshot: { coverage: { detectedAgents: 2 }, diff: { hasChanges: false } }
  });
  assert.equal(failed.callout.tone, "danger");
  assert.equal(failed.callout.title, "Something failed");
  assert.match(failed.primary.label, /Check what failed|Fix|Start/i);
  assert.match(failed.purpose, /coordina/i);
  assert.equal(failed.buttons.length, 2);
  assert.equal(failed.buttons[1].intent, "settings");

  const missing = adaptControlCenterToOverview(buildControlCenterModel({ projectName: "x" }), {
    hasGlobalState: false
  });
  assert.equal(missing.callout.tone, "danger");
  assert.equal(missing.callout.title, "Something failed");
  assert.match(missing.primary.label, /Check what failed/i);
  assert.equal(missing.buttons[0].intent, "setup");
  assert.ok(missing.metrics.some((m) => /Nothing else needs you|more in Details/i.test(m.label)));
  assert.doesNotMatch(JSON.stringify(missing), /\/Users|alertId|run-|Paths and IDs/i);

  const withEvidence = adaptControlCenterToOverview(modelFor(CONTROL_PLANE_HEALTH.ACTION_REQUIRED, {
    alerts: [{ state: "open" }, { state: "open" }]
  }), {
    hasGlobalState: true,
    snapshot: {
      coverage: { detectedAgents: 2 },
      diff: { hasChanges: true, changeCount: 1 }
    }
  });
  assert.equal(withEvidence.callout.title, "Needs attention");
  assert.equal(withEvidence.primary.label, "Fix drift");
  assert.match(withEvidence.primary.detail, /kairo sync/i);
  assert.equal(withEvidence.buttons[0].intent, "governance");
  assert.match(withEvidence.buttons[0].label, /Repair/i);
  assert.ok(withEvidence.details.some((line) => /Open alerts · 2/.test(line)));
  assert.ok(withEvidence.details.some((line) => /Opens · Governance/.test(line)));
  assert.deepEqual(buildOverviewDetails({}), ["Nothing else to show right now."]);
});

test("companion needs are plain language; system noise stays in Details", () => {
  assert.equal(
    humanizeCompanionNeed("Obsidian · unconfigured"),
    "Obsidian not connected · open Settings to choose your vault"
  );
  assert.match(humanizeCompanionNeed("Updates · 1 available"), /kairo updates check/);
  assert.equal(humanizeCompanionNeed("System · RAM 1.4% free · critical"), null);
  assert.equal(humanizeCompanionNeed("Advisor · critical · Free disk space"), null);
  assert.equal(humanizeCompanionNeed("Gentle · available"), null);
  assert.equal(humanizeCompanionNeed("  · cursor x16"), null);

  const { needs, rest } = partitionCompanionLines([
    "Gentle · available",
    "System · RAM 1% free · critical",
    "Advisor · critical · Free disk",
    "Obsidian · unconfigured",
    "Updates · 1 available",
    "Engram · conflict",
    "  · cursor x16"
  ]);
  assert.deepEqual(needs, [
    "Obsidian not connected · open Settings to choose your vault",
    "Update available · run kairo updates check",
    "Memory conflict · open Settings → Engram"
  ]);
  assert.ok(rest.some((l) => l.startsWith("System")));
  assert.ok(rest.some((l) => l.startsWith("Advisor")));
  assert.ok(!needs.some((l) => l.startsWith("System") || l.startsWith("Advisor")));
  assert.ok(!needs.some((l) => /RAM \d|Disk \d|cursor x\d/i.test(l)));

  const view = adaptControlCenterToOverview({
    ...modelFor(CONTROL_PLANE_HEALTH.ACTION_REQUIRED),
    companion: {
      lines: [
        "System · RAM 1% free · critical",
        "Obsidian · unconfigured",
        "Updates · 1 available"
      ]
    }
  });
  assert.ok(view.metrics.some((m) => /Obsidian not connected/.test(m.label)));
  assert.ok(view.metrics.some((m) => /Update available/.test(m.label)));
  assert.ok(!view.metrics.some((m) => /System|RAM|Advisor/i.test(m.label)));
  assert.ok(view.details.some((l) => /System ·/.test(l)));
});

test("wordmark shows on wide/compact only; minimal is textual", () => {
  assert.equal(shouldShowWordmark(LAYOUT_MODES.WIDE), true);
  assert.equal(shouldShowWordmark(LAYOUT_MODES.COMPACT), true);
  assert.equal(shouldShowWordmark(LAYOUT_MODES.MINIMAL), false);
  assert.ok(wordmarkLines(LAYOUT_MODES.WIDE).length >= 3);
  assert.ok(wordmarkLines(LAYOUT_MODES.COMPACT).length >= 1);
  assert.deepEqual(wordmarkLines(LAYOUT_MODES.MINIMAL), []);
  assert.equal(overviewBrandTitle(LAYOUT_MODES.MINIMAL), "KAIRO · Overview");
  assert.equal(overviewBrandTitle(LAYOUT_MODES.WIDE), null);

  const wide = SemanticOverviewPanel({
    model: modelFor(CONTROL_PLANE_HEALTH.HEALTHY),
    layoutMode: LAYOUT_MODES.WIDE,
    unicode: true
  });
  const compact = SemanticOverviewPanel({
    model: modelFor(CONTROL_PLANE_HEALTH.HEALTHY),
    layoutMode: LAYOUT_MODES.COMPACT,
    unicode: false
  });
  const minimal = SemanticOverviewPanel({
    model: modelFor(CONTROL_PLANE_HEALTH.HEALTHY),
    layoutMode: LAYOUT_MODES.MINIMAL,
    unicode: true
  });
  assert.match(JSON.stringify(wide), /╦╔═╔═╗/);
  assert.match(JSON.stringify(compact), /KAIRO/);
  assert.match(JSON.stringify(minimal), /KAIRO · Overview/);
  assert.doesNotMatch(JSON.stringify(minimal), /╦╔═╔═╗/);
  assert.match(JSON.stringify(compact), /coordina/i);
});

test("metrics ActionList never shows selection; focused Home button shows focus mark", () => {
  const list = ActionList({
    items: adaptControlCenterToOverview(modelFor(CONTROL_PLANE_HEALTH.HEALTHY)).metrics,
    selectedIndex: -1,
    focused: false,
    unicode: false
  });
  const children = [].concat(list.props.children ?? []).filter(Boolean);
  assert.ok(children.length >= 1);
  for (const child of children) {
    assert.match(String(child.props.children), /^ {1}/);
    assert.equal(child.props.bold, false);
  }
  const panel = SemanticOverviewPanel({
    model: modelFor(CONTROL_PLANE_HEALTH.ACTION_REQUIRED),
    detailsOpen: false,
    unicode: false,
    layoutMode: LAYOUT_MODES.COMPACT,
    selectedIndex: 0,
    contentFocused: true,
    hasGlobalState: true,
    snapshot: {
      coverage: { detectedAgents: 2 },
      diff: { hasChanges: true, changeCount: 1 }
    }
  });
  const blob = JSON.stringify(panel);
  assert.match(blob, /"> Repair 1 change"/);
  assert.match(blob, /Configure/);
  assert.doesNotMatch(blob, /ACTION REQUIRED/);
});

test("Space toggles overview Details; Esc closes before exit", () => {
  let s = createCockpitUiState();
  assert.equal(s.overviewDetailsOpen, false);
  s = reduceCockpitUi(s, { type: "toggle-overview-details" });
  assert.equal(s.overviewDetailsOpen, true);
  s = reduceCockpitUi(s, { type: "escape" });
  assert.equal(s.overviewDetailsOpen, false);
  assert.equal(s.shouldExit, false);
  s = reduceCockpitUi(s, { type: "escape" });
  assert.equal(s.shouldExit, true);

  s = reduceCockpitUi(createCockpitUiState({ overviewDetailsOpen: true }), {
    type: "set-view",
    view: ORCHESTRATOR_VIEWS.CHANGES,
    navIndex: 1
  });
  assert.equal(s.overviewDetailsOpen, false);
  assert.equal(
    reduceCockpitUi(createCockpitUiState(), { type: "toggle-overview-details" }).overviewDetailsOpen,
    true
  );
  assert.equal(
    reduceCockpitUi(
      createCockpitUiState({ view: ORCHESTRATOR_VIEWS.CHANGES }),
      { type: "toggle-overview-details" }
    ).overviewDetailsOpen,
    false
  );

  const homeFooter = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.HOME,
    region: COCKPIT_REGIONS.NAV,
    unicode: false,
    columns: 80
  });
  assert.ok(homeFooter.text.length <= 48, "HOME footer must fit one 80-col line");
});
