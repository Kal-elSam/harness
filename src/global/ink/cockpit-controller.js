import { COCKPIT_NAV, COCKPIT_REGIONS, regionsForLayout } from "./cockpit-models.js";
import { ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";
import { LAYOUT_MODES } from "./layout.js";

/**
 * Pure cockpit focus / navigation reducer — no I/O, no React.
 */

export function createCockpitUiState({
  layoutMode = LAYOUT_MODES.COMPACT,
  view = ORCHESTRATOR_VIEWS.HOME,
  region = COCKPIT_REGIONS.NAV,
  navIndex = 0,
  listIndex = 0,
  helpOpen = false
} = {}) {
  const regions = regionsForLayout(layoutMode);
  const safeRegion = regions.includes(region) ? region : regions[0];
  return {
    layoutMode,
    view,
    region: safeRegion,
    navIndex: clamp(navIndex, 0, COCKPIT_NAV.length - 1),
    listIndex: Math.max(0, listIndex),
    helpOpen,
    shouldExit: false
  };
}

export function reduceCockpitUi(state, action) {
  switch (action.type) {
    case "resize": {
      const regions = regionsForLayout(action.layoutMode);
      const region = regions.includes(state.region) ? state.region : regions[0];
      return { ...state, layoutMode: action.layoutMode, region };
    }
    case "tab": {
      const regions = regionsForLayout(state.layoutMode);
      if (regions.length < 2) return state;
      const index = regions.indexOf(state.region);
      const next = regions[(index + 1) % regions.length];
      return { ...state, region: next };
    }
    case "arrow": {
      if (state.helpOpen) return state;
      if (state.region === COCKPIT_REGIONS.SYSTEM) return state;

      const navigatesNav = state.region === COCKPIT_REGIONS.NAV
        || (state.view === ORCHESTRATOR_VIEWS.HOME
          && state.layoutMode === LAYOUT_MODES.MINIMAL);

      if (navigatesNav) {
        const delta = action.direction === "up" ? -1 : 1;
        return {
          ...state,
          navIndex: clamp(state.navIndex + delta, 0, COCKPIT_NAV.length - 1)
        };
      }

      const delta = action.direction === "up" ? -1 : 1;
      const max = Math.max(0, (action.listLength ?? 1) - 1);
      return { ...state, listIndex: clamp(state.listIndex + delta, 0, max) };
    }
    case "enter-nav": {
      const item = COCKPIT_NAV[state.navIndex];
      if (!item) return state;
      if (item.view === ORCHESTRATOR_VIEWS.HOME) {
        return {
          ...state,
          view: ORCHESTRATOR_VIEWS.HOME,
          listIndex: 0,
          region: COCKPIT_REGIONS.CONTENT
        };
      }
      return {
        ...state,
        view: item.view,
        listIndex: 0,
        region: COCKPIT_REGIONS.CONTENT,
        helpOpen: false
      };
    }
    case "set-view":
      return {
        ...state,
        view: action.view,
        listIndex: 0,
        region: action.region ?? COCKPIT_REGIONS.CONTENT
      };
    case "toggle-help":
      if (state.helpOpen) {
        return {
          ...state,
          helpOpen: false,
          view: state.view === ORCHESTRATOR_VIEWS.HELP
            ? ORCHESTRATOR_VIEWS.HOME
            : state.view
        };
      }
      return { ...state, helpOpen: true, view: ORCHESTRATOR_VIEWS.HELP };
    case "escape": {
      if (state.helpOpen) {
        return { ...state, helpOpen: false, view: ORCHESTRATOR_VIEWS.HOME };
      }
      if (state.view !== ORCHESTRATOR_VIEWS.HOME) {
        const regions = regionsForLayout(state.layoutMode);
        return {
          ...state,
          view: ORCHESTRATOR_VIEWS.HOME,
          listIndex: 0,
          region: regions.includes(COCKPIT_REGIONS.NAV)
            ? COCKPIT_REGIONS.NAV
            : COCKPIT_REGIONS.CONTENT
        };
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
