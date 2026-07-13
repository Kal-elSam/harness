import test from "node:test";
import assert from "node:assert/strict";
import {
  createCockpitUiState,
  reduceCockpitUi
} from "../src/global/ink/cockpit-controller.js";
import { COCKPIT_REGIONS } from "../src/global/ink/cockpit-models.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";

test("tab cycles interactive regions only when content is interactive", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.WIDE,
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    region: COCKPIT_REGIONS.CONTENT,
    navIndex: 1
  });
  state = reduceCockpitUi(state, { type: "tab" });
  assert.equal(state.region, COCKPIT_REGIONS.NAV);
  state = reduceCockpitUi(state, { type: "tab" });
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);

  let minimal = createCockpitUiState({ layoutMode: LAYOUT_MODES.MINIMAL });
  minimal = reduceCockpitUi(minimal, { type: "tab" });
  assert.equal(minimal.region, COCKPIT_REGIONS.CONTENT);
});

test("escape returns to home then signals exit", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.PROVIDERS,
    region: COCKPIT_REGIONS.NAV
  });
  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);
  assert.equal(state.shouldExit, false);

  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.shouldExit, true);
});

test("arrows move nav focus and enter opens interactive view with content focus", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    region: COCKPIT_REGIONS.NAV,
    navIndex: 0
  });
  state = reduceCockpitUi(state, { type: "arrow", direction: "down" });
  assert.equal(state.navIndex, 1);
  state = reduceCockpitUi(state, { type: "enter-nav" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.ACTIVE_RUNS);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);
});

test("resize remaps invalid region", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.WIDE,
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    region: COCKPIT_REGIONS.SYSTEM,
    navIndex: 1
  });
  state = reduceCockpitUi(state, { type: "resize", layoutMode: LAYOUT_MODES.COMPACT });
  assert.equal(state.layoutMode, LAYOUT_MODES.COMPACT);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);
});

test("help toggle opens and closes with nav focus", () => {
  let state = createCockpitUiState();
  state = reduceCockpitUi(state, { type: "toggle-help" });
  assert.equal(state.helpOpen, true);
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HELP);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);
  state = reduceCockpitUi(state, { type: "toggle-help" });
  assert.equal(state.helpOpen, false);
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);
});
