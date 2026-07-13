import test from "node:test";
import assert from "node:assert/strict";
import {
  createCockpitUiState,
  reduceCockpitUi,
  isContentInteractiveView,
  isNavFocusedView,
  canTabBetweenRegions,
  routeCockpitKey
} from "../src/global/ink/cockpit-controller.js";
import {
  COCKPIT_NAV,
  COCKPIT_REGIONS,
  buildFooterModel,
  buildNavModel
} from "../src/global/ink/cockpit-models.js";
import { openRecommendedDestination } from "../src/global/ink/cockpit-home.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";

test("diagnostics keeps nav focus so arrows switch sections without Tab", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    region: COCKPIT_REGIONS.NAV,
    navIndex: COCKPIT_NAV.findIndex((item) => item.view === ORCHESTRATOR_VIEWS.DIAGNOSTICS)
  });

  state = reduceCockpitUi(state, { type: "enter-nav" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.DIAGNOSTICS);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);

  state = reduceCockpitUi(state, { type: "arrow", direction: "up" });
  assert.equal(state.navIndex, COCKPIT_NAV.findIndex((item) => item.id === "launch"));
  assert.equal(state.region, COCKPIT_REGIONS.NAV);

  state = reduceCockpitUi(state, { type: "enter-nav" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.LAUNCH);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);
});

test("overview stays on navigation focus after selecting Overview", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.WIDE,
    view: ORCHESTRATOR_VIEWS.PROVIDERS,
    region: COCKPIT_REGIONS.NAV,
    navIndex: 0
  });

  state = reduceCockpitUi(state, { type: "enter-nav" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);
  assert.equal(state.navIndex, 0);
});

test("providers and help open with navigation focus", () => {
  for (const view of [ORCHESTRATOR_VIEWS.PROVIDERS, ORCHESTRATOR_VIEWS.HELP]) {
    const navIndex = view === ORCHESTRATOR_VIEWS.HELP
      ? 0
      : COCKPIT_NAV.findIndex((item) => item.view === view);
    let state = createCockpitUiState({
      layoutMode: LAYOUT_MODES.COMPACT,
      region: COCKPIT_REGIONS.NAV,
      navIndex: Math.max(0, navIndex)
    });

    if (view === ORCHESTRATOR_VIEWS.HELP) {
      state = reduceCockpitUi(state, { type: "toggle-help" });
    } else {
      state = reduceCockpitUi(state, { type: "enter-nav" });
    }

    assert.equal(state.view, view);
    assert.equal(state.region, COCKPIT_REGIONS.NAV, `${view} should keep nav focus`);
  }
});

test("escape from main section returns to overview; second escape exits", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.DIAGNOSTICS,
    region: COCKPIT_REGIONS.NAV,
    navIndex: 5
  });

  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);
  assert.equal(state.navIndex, 0);
  assert.equal(state.shouldExit, false);

  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.shouldExit, true);
});

test("escape from run detail returns to list before overview", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    region: COCKPIT_REGIONS.CONTENT,
    navIndex: 1
  });
  state = reduceCockpitUi(state, {
    type: "set-view",
    view: ORCHESTRATOR_VIEWS.RUN_DETAIL,
    returnView: ORCHESTRATOR_VIEWS.ACTIVE_RUNS
  });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.RUN_DETAIL);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);

  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.ACTIVE_RUNS);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);

  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);
});

test("tab only works when content is interactive", () => {
  assert.equal(isNavFocusedView(ORCHESTRATOR_VIEWS.HOME), true);
  assert.equal(isNavFocusedView(ORCHESTRATOR_VIEWS.DIAGNOSTICS), true);
  assert.equal(isContentInteractiveView(ORCHESTRATOR_VIEWS.ACTIVE_RUNS), true);
  assert.equal(isContentInteractiveView(ORCHESTRATOR_VIEWS.LAUNCH), true);
  assert.equal(isContentInteractiveView(ORCHESTRATOR_VIEWS.DIAGNOSTICS), false);

  let info = createCockpitUiState({
    layoutMode: LAYOUT_MODES.WIDE,
    view: ORCHESTRATOR_VIEWS.DIAGNOSTICS,
    region: COCKPIT_REGIONS.NAV
  });
  assert.equal(canTabBetweenRegions(info), false);
  info = reduceCockpitUi(info, { type: "tab" });
  assert.equal(info.region, COCKPIT_REGIONS.NAV);

  let runs = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    region: COCKPIT_REGIONS.CONTENT,
    navIndex: 1
  });
  assert.equal(canTabBetweenRegions(runs), true);
  runs = reduceCockpitUi(runs, { type: "tab" });
  assert.equal(runs.region, COCKPIT_REGIONS.NAV);
  runs = reduceCockpitUi(runs, { type: "tab" });
  assert.equal(runs.region, COCKPIT_REGIONS.CONTENT);
});

test("footer matches available actions for current context", () => {
  const overview = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.HOME,
    region: COCKPIT_REGIONS.NAV,
    unicode: false
  });
  assert.match(overview.text, /Navigate/);
  assert.match(overview.text, /Enter/);
  assert.match(overview.text, /Esc Exit/);
  assert.doesNotMatch(overview.text, /Tab/);

  const diagnostics = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.DIAGNOSTICS,
    region: COCKPIT_REGIONS.NAV,
    unicode: false
  });
  assert.match(diagnostics.text, /Navigate/);
  assert.match(diagnostics.text, /Enter/);
  assert.match(diagnostics.text, /Esc Back/);
  assert.doesNotMatch(diagnostics.text, /Tab/);
  assert.doesNotMatch(diagnostics.text, /focus:/);

  const active = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    region: COCKPIT_REGIONS.CONTENT,
    unicode: false
  });
  assert.match(active.text, /Tab/);
  assert.match(active.text, /Enter/);
  assert.match(active.text, /Esc Back/);

  const detail = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.RUN_DETAIL,
    region: COCKPIT_REGIONS.CONTENT,
    canCancel: true,
    unicode: false
  });
  assert.match(detail.text, /C cancel/);
  assert.doesNotMatch(detail.text, /Tab/);
});

test("routeCockpitKey centralizes region routing before view handlers", () => {
  const diagnostics = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.DIAGNOSTICS,
    region: COCKPIT_REGIONS.NAV,
    navIndex: 5
  });

  assert.deepEqual(
    routeCockpitKey(diagnostics, { type: "arrow", direction: "up" }),
    { type: "arrow", direction: "up" }
  );
  assert.deepEqual(
    routeCockpitKey(diagnostics, { type: "tab" }),
    null
  );
  assert.deepEqual(
    routeCockpitKey(diagnostics, { type: "enter" }),
    { type: "enter-nav" }
  );

  const runs = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    region: COCKPIT_REGIONS.CONTENT,
    navIndex: 1
  });
  assert.deepEqual(
    routeCockpitKey(runs, { type: "tab" }),
    { type: "tab" }
  );
  assert.deepEqual(
    routeCockpitKey(runs, { type: "arrow", direction: "down", listLength: 3 }),
    { type: "arrow", direction: "down", listLength: 3 }
  );
  assert.equal(
    routeCockpitKey(runs, { type: "enter" }),
    null
  );
});

test("nav labels and selected vs current remain distinct while explanation follows selection", () => {
  const nav = buildNavModel({
    navIndex: 4,
    currentView: ORCHESTRATOR_VIEWS.HOME,
    focused: true,
    dashboard: { activeRuns: [], recentRuns: [], providers: [{ launchable: true }] },
    diagnostics: { diagnostics: { detected: 1, errors: 0 }, capabilities: [{}] }
  });
  assert.equal(nav.items[0].label, "Home");
  assert.equal(nav.items[0].current, true);
  assert.equal(nav.items[0].selected, false);
  assert.equal(nav.items[4].label, "New run");
  assert.equal(nav.items[4].selected, true);
  assert.equal(nav.items[4].current, false);
  assert.match(nav.explanation, /Delegate|executable/i);
});

test("recommended Home destination opens New run with matching nav index", () => {
  const destination = openRecommendedDestination({
    targetView: ORCHESTRATOR_VIEWS.LAUNCH,
    targetAction: "launch"
  }, { navItems: COCKPIT_NAV });

  assert.equal(destination.view, ORCHESTRATOR_VIEWS.LAUNCH);
  assert.equal(destination.action, "launch");
  assert.equal(destination.navIndex, COCKPIT_NAV.findIndex((item) => item.id === "launch"));

  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    region: COCKPIT_REGIONS.NAV,
    navIndex: 0
  });
  state = reduceCockpitUi(state, {
    type: "set-view",
    view: destination.view,
    navIndex: destination.navIndex
  });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.LAUNCH);
  assert.equal(state.navIndex, destination.navIndex);
});
