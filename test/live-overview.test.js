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
import {
  adaptControlCenterToOverview,
  buildOverviewDetails,
  mapHealthTone,
  SemanticOverviewPanel
} from "../src/global/ink/ux/live-overview.js";

function modelFor(health, extras = {}) {
  return buildControlCenterModel({
    projectName: "demo",
    snapshot: {
      health,
      coverage: { governedAgents: 1, detectedAgents: 2 },
      diff: { hasChanges: false },
      cta: { title: "Finish local setup", detail: "Configure agents.", destination: "setup" },
      ...extras
    },
    alerts: extras.alerts
  });
}

test("adapter maps health tones and unavailable headlines", () => {
  assert.equal(mapHealthTone(CONTROL_PLANE_HEALTH.CHECK_FAILED), "danger");
  assert.equal(mapHealthTone(CONTROL_PLANE_HEALTH.ACTION_REQUIRED), "warn");
  assert.equal(mapHealthTone(CONTROL_PLANE_HEALTH.NOT_CONFIGURED), "warn");
  assert.equal(mapHealthTone(CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES), "warn");
  assert.equal(mapHealthTone(CONTROL_PLANE_HEALTH.HEALTHY), "ready");

  const failed = adaptControlCenterToOverview(modelFor(CONTROL_PLANE_HEALTH.CHECK_FAILED));
  assert.equal(failed.callout.tone, "danger");
  assert.match(failed.primary.label, /Finish local setup|Review/);

  const missing = adaptControlCenterToOverview(buildControlCenterModel({ projectName: "x" }));
  assert.equal(missing.callout.tone, "danger");
  assert.match(missing.metrics[1].label, /unavailable/i);
  assert.match(missing.metrics[2].label, /unavailable/i);
  assert.deepEqual(missing.details, ["No extra evidence beyond the metrics above."]);
  assert.doesNotMatch(JSON.stringify(missing), /\/Users|alertId|run-|Paths and IDs/i);

  const withEvidence = adaptControlCenterToOverview(modelFor(CONTROL_PLANE_HEALTH.ACTION_REQUIRED, {
    alerts: [{ state: "open" }, { state: "open" }]
  }));
  assert.ok(withEvidence.details.some((line) => /Open alerts · 2/.test(line)));
  assert.ok(withEvidence.details.some((line) => /Next destination · Setup/.test(line)));
  assert.deepEqual(buildOverviewDetails({}), ["No extra evidence beyond the metrics above."]);
});

test("metrics ActionList never shows selection; panel primary has no focus mark", () => {
  const list = ActionList({
    items: adaptControlCenterToOverview(modelFor(CONTROL_PLANE_HEALTH.HEALTHY)).metrics,
    selectedIndex: -1,
    focused: false,
    unicode: false
  });
  for (const child of list.props.children) {
    assert.match(String(child.props.children), /^ {1}/);
    assert.equal(child.props.bold, false);
  }
  const panel = SemanticOverviewPanel({
    model: modelFor(CONTROL_PLANE_HEALTH.ACTION_REQUIRED),
    detailsOpen: false,
    unicode: false
  });
  const blob = JSON.stringify(panel);
  assert.doesNotMatch(blob, /"> [^"]+"/);
  assert.match(blob, /Review and repair|Finish local setup|Configure|Preview/i);
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
  assert.ok(homeFooter.text.length <= 40, "HOME footer must fit one 80-col line");
});
