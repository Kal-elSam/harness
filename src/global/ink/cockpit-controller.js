import {
  COCKPIT_NAV,
  COCKPIT_REGIONS,
  LAYOUT_MODES,
  ORCHESTRATOR_VIEWS,
  canTabBetweenRegions,
  clamp,
  defaultRegionForView,
  interactiveRegionsFor,
  isContentInteractiveView,
  isNavFocusedView,
  regionsForLayout,
  routeCockpitKey
} from "./cockpit-focus.js";
import { isRunsChildView } from "./cockpit-runs.js";
import { navIndexForView } from "./cockpit-models.js";

export {
  canTabBetweenRegions,
  defaultRegionForView,
  isContentInteractiveView,
  isNavFocusedView,
  routeCockpitKey
};

/**
 * Pure cockpit focus / navigation reducer — no I/O, no React.
 */
export function createCockpitUiState({
  layoutMode = LAYOUT_MODES.COMPACT,
  view = ORCHESTRATOR_VIEWS.HOME,
  region = COCKPIT_REGIONS.NAV,
  navIndex = 0,
  listIndex = 0,
  helpOpen = false,
  returnView = null,
  paletteOpen = false,
  paletteIndex = 0,
  overviewDetailsOpen = false,
  governanceDetailsOpen = false,
  activityDetailsOpen = false
} = {}) {
  const regions = regionsForLayout(layoutMode);
  const preferred = region ?? defaultRegionForView(view, layoutMode);
  const safeRegion = regions.includes(preferred)
    ? preferred
    : defaultRegionForView(view, layoutMode);
  return {
    layoutMode,
    view,
    region: safeRegion,
    navIndex: clamp(navIndex, 0, COCKPIT_NAV.length - 1),
    listIndex: Math.max(0, listIndex),
    helpOpen,
    returnView,
    paletteOpen,
    paletteIndex: Math.max(0, paletteIndex),
    overviewDetailsOpen: Boolean(overviewDetailsOpen),
    governanceDetailsOpen: Boolean(governanceDetailsOpen),
    activityDetailsOpen: Boolean(activityDetailsOpen),
    shouldExit: false
  };
}

function closePalette(state) {
  return { ...state, paletteOpen: false, paletteIndex: 0 };
}

export function reduceCockpitUi(state, action) {
  switch (action.type) {
    case "toggle-palette":
      if (state.paletteOpen) return closePalette(state);
      return { ...state, paletteOpen: true, paletteIndex: 0, helpOpen: false };
    case "close-palette":
      return closePalette(state);
    case "palette-arrow": {
      const max = Math.max(0, (action.listLength ?? 1) - 1);
      const delta = action.direction === "up" ? -1 : 1;
      return {
        ...state,
        paletteIndex: clamp(state.paletteIndex + delta, 0, max)
      };
    }
    case "run-palette": {
      const next = closePalette(state);
      if (action.kind === "help") {
        return {
          ...next,
          helpOpen: true,
          view: ORCHESTRATOR_VIEWS.HELP,
          region: defaultRegionForView(ORCHESTRATOR_VIEWS.HELP, state.layoutMode)
        };
      }
      if (action.kind === "navigate" && action.view) {
        return {
          ...next,
          view: action.view,
          navIndex: navIndexForView(action.view),
          listIndex: 0,
          region: defaultRegionForView(action.view, state.layoutMode),
          helpOpen: false,
          returnView: null
        };
      }
      return next;
    }
    case "resize": {
      const regions = regionsForLayout(action.layoutMode);
      const preferred = regions.includes(state.region)
        ? state.region
        : defaultRegionForView(state.view, action.layoutMode);
      return { ...state, layoutMode: action.layoutMode, region: preferred };
    }
    case "tab": {
      if (!canTabBetweenRegions(state)) return state;
      const regions = interactiveRegionsFor(state);
      const index = regions.indexOf(state.region);
      const next = regions[(Math.max(index, 0) + 1) % regions.length];
      return { ...state, region: next };
    }
    case "arrow": {
      if (state.region === COCKPIT_REGIONS.SYSTEM) return state;

      const navigatesNav = state.region === COCKPIT_REGIONS.NAV
        || isNavFocusedView(state.view);

      if (navigatesNav) {
        const delta = action.direction === "up" ? -1 : 1;
        return {
          ...state,
          navIndex: clamp(state.navIndex + delta, 0, COCKPIT_NAV.length - 1)
        };
      }

      if (!isContentInteractiveView(state.view) || state.view === ORCHESTRATOR_VIEWS.LAUNCH) {
        return state;
      }

      const delta = action.direction === "up" ? -1 : 1;
      const max = Math.max(0, (action.listLength ?? 1) - 1);
      return { ...state, listIndex: clamp(state.listIndex + delta, 0, max) };
    }
    case "enter-nav": {
      const item = COCKPIT_NAV[state.navIndex];
      if (!item) return state;
      return closePalette({
        ...state,
        view: item.view,
        listIndex: 0,
        region: defaultRegionForView(item.view, state.layoutMode),
        helpOpen: false,
        returnView: null,
        overviewDetailsOpen: false,
        governanceDetailsOpen: false,
        activityDetailsOpen: false
      });
    }
    case "set-view": {
      const nextView = action.view;
      return closePalette({
        ...state,
        view: nextView,
        listIndex: 0,
        navIndex: action.navIndex == null
          ? state.navIndex
          : clamp(action.navIndex, 0, COCKPIT_NAV.length - 1),
        region: action.region ?? defaultRegionForView(nextView, state.layoutMode),
        returnView: action.returnView ?? state.returnView,
        helpOpen: nextView === ORCHESTRATOR_VIEWS.HELP,
        overviewDetailsOpen: false,
        governanceDetailsOpen: false,
        activityDetailsOpen: false
      });
    }
    case "toggle-overview-details":
      if (state.view !== ORCHESTRATOR_VIEWS.HOME) return state;
      return { ...state, overviewDetailsOpen: !state.overviewDetailsOpen };
    case "toggle-governance-details":
      if (state.view !== ORCHESTRATOR_VIEWS.CHANGES) return state;
      return { ...state, governanceDetailsOpen: !state.governanceDetailsOpen };
    case "toggle-activity-details":
      if (state.view !== ORCHESTRATOR_VIEWS.ACTIVITY) return state;
      return { ...state, activityDetailsOpen: !state.activityDetailsOpen };
    case "toggle-help":
      if (state.helpOpen || state.view === ORCHESTRATOR_VIEWS.HELP) {
        return goOverview(state);
      }
      return closePalette({
        ...state,
        helpOpen: true,
        view: ORCHESTRATOR_VIEWS.HELP,
        region: defaultRegionForView(ORCHESTRATOR_VIEWS.HELP, state.layoutMode),
        overviewDetailsOpen: false,
        governanceDetailsOpen: false,
        activityDetailsOpen: false
      });
    case "escape": {
      if (state.paletteOpen) {
        return closePalette(state);
      }
      if (state.view === ORCHESTRATOR_VIEWS.HOME && state.overviewDetailsOpen) {
        return { ...state, overviewDetailsOpen: false };
      }
      if (state.view === ORCHESTRATOR_VIEWS.CHANGES && state.governanceDetailsOpen) {
        return { ...state, governanceDetailsOpen: false };
      }
      if (state.view === ORCHESTRATOR_VIEWS.ACTIVITY && state.activityDetailsOpen) {
        return { ...state, activityDetailsOpen: false };
      }
      if (state.helpOpen || state.view === ORCHESTRATOR_VIEWS.HELP) {
        return goOverview(state);
      }
      if (state.view === ORCHESTRATOR_VIEWS.RUN_DETAIL) {
        const back = state.returnView && isContentInteractiveView(state.returnView)
          ? state.returnView
          : ORCHESTRATOR_VIEWS.ACTIVE_RUNS;
        return {
          ...state,
          view: back,
          listIndex: 0,
          region: defaultRegionForView(back, state.layoutMode),
          returnView: null
        };
      }
      if (state.view === ORCHESTRATOR_VIEWS.REVIEW_DETAIL) {
        const back = ORCHESTRATOR_VIEWS.REVIEWS;
        return {
          ...state,
          view: back,
          listIndex: 0,
          region: defaultRegionForView(back, state.layoutMode),
          returnView: null
        };
      }
      if (isRunsChildView(state.view)) {
        return goRunsHub(state);
      }
      if (state.view !== ORCHESTRATOR_VIEWS.HOME) {
        return goOverview(state);
      }
      return { ...state, shouldExit: true };
    }
    case "clear-exit":
      return { ...state, shouldExit: false };
    default:
      return state;
  }
}

export function resolveNavAction(navIndex) {
  return COCKPIT_NAV[navIndex] ?? null;
}

function goOverview(state) {
  return closePalette({
    ...state,
    helpOpen: false,
    view: ORCHESTRATOR_VIEWS.HOME,
    navIndex: 0,
    listIndex: 0,
    region: defaultRegionForView(ORCHESTRATOR_VIEWS.HOME, state.layoutMode),
    returnView: null,
    overviewDetailsOpen: false,
    governanceDetailsOpen: false,
    activityDetailsOpen: false
  });
}

function goRunsHub(state) {
  return closePalette({
    ...state,
    helpOpen: false,
    view: ORCHESTRATOR_VIEWS.RUNS,
    navIndex: navIndexForView(ORCHESTRATOR_VIEWS.RUNS),
    listIndex: 0,
    region: defaultRegionForView(ORCHESTRATOR_VIEWS.RUNS, state.layoutMode),
    returnView: null
  });
}
