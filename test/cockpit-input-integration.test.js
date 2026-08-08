import test from "node:test";
import assert from "node:assert/strict";
import {
  createCockpitUiState,
  reduceCockpitUi,
  routeCockpitKey
} from "../src/global/ink/cockpit-controller.js";
import { COCKPIT_NAV, COCKPIT_REGIONS, buildFooterModel, navIndexForView } from "../src/global/ink/cockpit-models.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";
import { OVERVIEW_BUTTON_COUNT } from "../src/global/ink/ux/overview-actions.js";

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

  // Open Settings via arrows + Enter.
  const settingsIndex = COCKPIT_NAV.findIndex((item) => item.id === "settings");
  while (state.navIndex < settingsIndex) {
    state = applyKey(state, { type: "arrow", direction: "down" });
  }
  state = applyKey(state, { type: "enter" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.PROFILE);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);

  // Tab back to nav, then open Home.
  state = applyKey(state, { type: "tab" });
  assert.equal(state.region, COCKPIT_REGIONS.NAV);
  while (state.navIndex > 0) {
    state = applyKey(state, { type: "arrow", direction: "up" });
  }
  state = applyKey(state, { type: "enter" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);

  // Home content: arrows move buttons; Tab reaches nav.
  state = applyKey(state, { type: "arrow", direction: "down", listLength: OVERVIEW_BUTTON_COUNT });
  assert.equal(state.listIndex, 1);
  state = applyKey(state, { type: "tab" });
  assert.equal(state.region, COCKPIT_REGIONS.NAV);

  const footer = buildFooterModel({
    view: state.view,
    region: state.region,
    unicode: false
  });
  assert.match(footer.text, /↑↓ Section/);

  // Already on Home: Esc exits.
  state = applyKey(state, { type: "escape" });
  assert.equal(state.shouldExit, true);

  return state;
}

test("integrated wide session: Home buttons + Tab to nav", () => {
  simulateSession(LAYOUT_MODES.WIDE);
});

test("integrated compact session: Esc home then exit", () => {
  simulateSession(LAYOUT_MODES.COMPACT);
});

test("integrated interactive runs hub allows Tab between nav and content", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.WIDE,
    region: COCKPIT_REGIONS.CONTENT,
    view: ORCHESTRATOR_VIEWS.RUNS,
    navIndex: navIndexForView(ORCHESTRATOR_VIEWS.RUNS)
  });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.RUNS);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);

  state = applyKey(state, { type: "tab" });
  assert.equal(state.region, COCKPIT_REGIONS.NAV);
});
