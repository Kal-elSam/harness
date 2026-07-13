import test from "node:test";
import assert from "node:assert/strict";
import {
  createCockpitUiState,
  reduceCockpitUi,
  routeCockpitKey
} from "../src/global/ink/cockpit-controller.js";
import { COCKPIT_NAV, COCKPIT_REGIONS, buildFooterModel } from "../src/global/ink/cockpit-models.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";

function applyKey(state, keyAction) {
  const routed = routeCockpitKey(state, keyAction);
  if (!routed) return state;
  return reduceCockpitUi(state, routed);
}

function simulateSession(layoutMode) {
  let state = createCockpitUiState({
    layoutMode,
    region: layoutMode === LAYOUT_MODES.MINIMAL ? COCKPIT_REGIONS.CONTENT : COCKPIT_REGIONS.NAV
  });

  // Open Diagnostics via arrows + Enter.
  const diagnosticsIndex = COCKPIT_NAV.findIndex((item) => item.id === "changes");
  while (state.navIndex < diagnosticsIndex) {
    state = applyKey(state, { type: "arrow", direction: "down" });
  }
  state = applyKey(state, { type: "enter" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.CHANGES);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);

  // Switch to Providers without Tab.
  state = applyKey(state, { type: "arrow", direction: "up" });
  state = applyKey(state, { type: "arrow", direction: "up" });
  state = applyKey(state, { type: "enter" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.IDES);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);

  // Tab is a no-op on informational views.
  const beforeTab = state.region;
  state = applyKey(state, { type: "tab" });
  assert.equal(state.region, beforeTab);

  const footer = buildFooterModel({
    view: state.view,
    region: state.region,
    unicode: false
  });
  assert.doesNotMatch(footer.text, /Tab/);

  // Esc → Overview, Esc → exit.
  state = applyKey(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);
  state = applyKey(state, { type: "escape" });
  assert.equal(state.shouldExit, true);

  return state;
}

test("integrated wide session: arrows navigate sections without Tab", () => {
  simulateSession(LAYOUT_MODES.WIDE);
});

test("integrated compact session: Esc overview then exit", () => {
  simulateSession(LAYOUT_MODES.COMPACT);
});

test("integrated interactive runs allow Tab between nav and content", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.WIDE,
    region: COCKPIT_REGIONS.NAV,
    navIndex: 6
  });
  state = applyKey(state, { type: "enter" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.ACTIVE_RUNS);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);

  state = applyKey(state, { type: "tab" });
  assert.equal(state.region, COCKPIT_REGIONS.NAV);
  state = applyKey(state, { type: "tab" });
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);

  const footer = buildFooterModel({
    view: state.view,
    region: state.region,
    unicode: false
  });
  assert.match(footer.text, /Tab/);
});
