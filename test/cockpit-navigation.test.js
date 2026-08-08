import test from "node:test";
import assert from "node:assert/strict";
import {
  createCockpitUiState,
  reduceCockpitUi,
  isContentInteractiveView,
  isNavFocusedView,
  canTabBetweenRegions,
  routeCockpitKey,
  resolveNavAction
} from "../src/global/ink/cockpit-controller.js";
import {
  COCKPIT_NAV,
  COCKPIT_REGIONS,
  buildFooterModel,
  buildNavModel,
  navIndexForView
} from "../src/global/ink/cockpit-models.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";
import { resolveEnterNavIntent } from "../src/global/ink/cockpit-enter.js";
import { resolveRunsHubItem } from "../src/global/ink/cockpit-runs.js";
import { buildOverviewButtons, OVERVIEW_BUTTON_COUNT } from "../src/global/ink/ux/overview-actions.js";

function applyIntegratedEnter(state, { ctaDestination = null } = {}) {
  const routed = routeCockpitKey(state, { type: "enter" });
  if (!routed) return state;
  if (routed.type === "enter-nav") {
    const intent = resolveEnterNavIntent({
      currentView: state.view,
      navItem: resolveNavAction(state.navIndex),
      ctaDestination
    });
    if (intent.kind === "activate-cta") {
      const view = intent.destination === "changes" || intent.destination === "governance"
        ? ORCHESTRATOR_VIEWS.CHANGES
        : intent.destination === "ides"
          ? ORCHESTRATOR_VIEWS.IDES
          : intent.destination === "runs"
            ? ORCHESTRATOR_VIEWS.RUNS
            : ORCHESTRATOR_VIEWS.HOME;
      return reduceCockpitUi(state, {
        type: "set-view",
        view,
        navIndex: navIndexForView(view)
      });
    }
    if (intent.kind === "activate-setup") {
      return { ...state, setupActivated: true };
    }
  }
  if (routed.type === "enter-home-button") {
    const buttons = buildOverviewButtons({
      hasGlobalState: true,
      snapshot: {
        coverage: { detectedAgents: 2 },
        diff: { hasChanges: true, changeCount: 2 }
      }
    });
    const selected = buttons[Math.min(Math.max(0, state.listIndex), buttons.length - 1)];
    if (selected?.intent === "governance") {
      return reduceCockpitUi(state, {
        type: "set-view",
        view: ORCHESTRATOR_VIEWS.CHANGES,
        navIndex: navIndexForView(ORCHESTRATOR_VIEWS.CHANGES)
      });
    }
    if (selected?.intent === "settings") {
      return reduceCockpitUi(state, {
        type: "set-view",
        view: ORCHESTRATOR_VIEWS.PROFILE,
        navIndex: navIndexForView(ORCHESTRATOR_VIEWS.PROFILE)
      });
    }
  }
  return reduceCockpitUi(state, routed);
}

function openRunsHubSelection(state, listIndex) {
  const item = resolveRunsHubItem(listIndex);
  return reduceCockpitUi(state, {
    type: "set-view",
    view: item.view,
    navIndex: navIndexForView(ORCHESTRATOR_VIEWS.RUNS)
  });
}

test("governance keeps nav focus so arrows switch sections without Tab", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    region: COCKPIT_REGIONS.NAV,
    navIndex: 0
  });

  state = reduceCockpitUi(state, {
    type: "set-view",
    view: ORCHESTRATOR_VIEWS.CHANGES,
    navIndex: 0
  });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.CHANGES);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);

  state = reduceCockpitUi(state, { type: "arrow", direction: "down" });
  assert.equal(state.navIndex, COCKPIT_NAV.findIndex((item) => item.id === "settings"));
  assert.equal(state.region, COCKPIT_REGIONS.NAV);

  state = reduceCockpitUi(state, { type: "arrow", direction: "up" });
  state = reduceCockpitUi(state, { type: "enter-nav" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);
});

test("home opens with content focus for the two buttons", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.WIDE,
    view: ORCHESTRATOR_VIEWS.IDES,
    region: COCKPIT_REGIONS.NAV,
    navIndex: 0
  });

  state = reduceCockpitUi(state, { type: "enter-nav" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);
  assert.equal(state.navIndex, 0);
  assert.equal(isContentInteractiveView(ORCHESTRATOR_VIEWS.HOME), true);
  assert.equal(isNavFocusedView(ORCHESTRATOR_VIEWS.HOME), false);
});

test("help opens with navigation focus; Settings opens content-interactive", () => {
  let help = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    region: COCKPIT_REGIONS.NAV,
    navIndex: 0
  });
  help = reduceCockpitUi(help, { type: "toggle-help" });
  assert.equal(help.view, ORCHESTRATOR_VIEWS.HELP);
  assert.equal(help.region, COCKPIT_REGIONS.NAV);

  const settingsNav = COCKPIT_NAV.findIndex((item) => item.view === ORCHESTRATOR_VIEWS.PROFILE);
  let settings = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    region: COCKPIT_REGIONS.NAV,
    navIndex: Math.max(0, settingsNav)
  });
  settings = reduceCockpitUi(settings, { type: "enter-nav" });
  assert.equal(settings.view, ORCHESTRATOR_VIEWS.PROFILE);
  assert.equal(settings.region, COCKPIT_REGIONS.CONTENT);
  assert.equal(isContentInteractiveView(ORCHESTRATOR_VIEWS.PROFILE), true);
  assert.equal(isNavFocusedView(ORCHESTRATOR_VIEWS.PROFILE), false);
});

test("escape from main section returns to home; second escape exits", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.DIAGNOSTICS,
    region: COCKPIT_REGIONS.NAV,
    navIndex: 1
  });
  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);
  assert.equal(state.navIndex, 0);
  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.shouldExit, true);
});

test("escape from run detail returns to list before home", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.RUN_DETAIL,
    region: COCKPIT_REGIONS.CONTENT,
    returnView: ORCHESTRATOR_VIEWS.ACTIVE_RUNS
  });
  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.ACTIVE_RUNS);
  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.RUNS);
  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
});

test("home footer spells out what each key does", () => {
  const overview = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.HOME,
    region: COCKPIT_REGIONS.CONTENT,
    unicode: false,
    columns: 80
  });
  assert.match(overview.text, /1·2 Select/);
  assert.match(overview.text, /Enter Run/);
  assert.match(overview.text, /Esc Exit/);
  assert.ok(overview.text.length <= 48);

  const nav = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.HOME,
    region: COCKPIT_REGIONS.NAV,
    unicode: false,
    columns: 80
  });
  assert.match(nav.text, /↑↓ Section/);
  assert.match(nav.text, /Enter Open/);
  assert.ok(nav.text.length <= 48);
});

test("home arrows move between the two buttons when content-focused", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.HOME,
    region: COCKPIT_REGIONS.CONTENT,
    listIndex: 0
  });
  assert.equal(canTabBetweenRegions(state), true);
  assert.deepEqual(
    routeCockpitKey(state, { type: "arrow", direction: "down", listLength: OVERVIEW_BUTTON_COUNT }),
    { type: "arrow", direction: "down", listLength: OVERVIEW_BUTTON_COUNT }
  );
  state = reduceCockpitUi(state, {
    type: "arrow",
    direction: "down",
    listLength: OVERVIEW_BUTTON_COUNT
  });
  assert.equal(state.listIndex, 1);
  assert.deepEqual(
    routeCockpitKey(state, { type: "enter" }),
    { type: "enter-home-button" }
  );
});

test("content-focused runs hub routes Tab and list arrows", () => {
  const runs = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.RUNS,
    region: COCKPIT_REGIONS.CONTENT,
    navIndex: navIndexForView(ORCHESTRATOR_VIEWS.RUNS)
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
    navIndex: 2,
    currentView: ORCHESTRATOR_VIEWS.HOME,
    focused: true,
    dashboard: { activeRuns: [], recentRuns: [], providers: [{ launchable: true }] },
    diagnostics: { diagnostics: { detected: 1, errors: 0 }, capabilities: [{}] }
  });
  assert.equal(nav.items[0].label, "Home");
  assert.equal(nav.items[0].current, true);
  assert.equal(nav.items[0].selected, false);
  assert.equal(nav.items[1].label, "Settings");
  assert.equal(nav.items[2].label, "History");
  assert.equal(nav.items[2].selected, true);
  assert.equal(nav.items[2].current, false);
  assert.match(nav.explanation, /changed|undo/i);
  assert.equal(buildNavModel({ navIndex: 0 }).explanation, "");
});

test("secondary Governance destination opens with home nav index", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    region: COCKPIT_REGIONS.NAV,
    navIndex: 0
  });
  state = reduceCockpitUi(state, {
    type: "set-view",
    view: ORCHESTRATOR_VIEWS.CHANGES,
    navIndex: 0
  });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.CHANGES);
  assert.equal(state.navIndex, 0);
});

test("Home button Enter opens Governance for pending drift", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.HOME,
    region: COCKPIT_REGIONS.CONTENT,
    listIndex: 0
  });
  state = applyIntegratedEnter(state);
  assert.equal(state.view, ORCHESTRATOR_VIEWS.CHANGES);
});

test("Home Configure button opens Settings", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.HOME,
    region: COCKPIT_REGIONS.CONTENT,
    listIndex: 1
  });
  state = applyIntegratedEnter(state);
  assert.equal(state.view, ORCHESTRATOR_VIEWS.PROFILE);
});

test("Runs hub reachable via set-view exposes Active, History, Reviews, and New run", () => {
  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    region: COCKPIT_REGIONS.CONTENT,
    view: ORCHESTRATOR_VIEWS.RUNS,
    navIndex: navIndexForView(ORCHESTRATOR_VIEWS.RUNS)
  });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.RUNS);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);

  state = openRunsHubSelection(state, 0);
  assert.equal(state.view, ORCHESTRATOR_VIEWS.ACTIVE_RUNS);

  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.RUNS);

  state = openRunsHubSelection(state, 1);
  assert.equal(state.view, ORCHESTRATOR_VIEWS.RECENT_RUNS);
});
