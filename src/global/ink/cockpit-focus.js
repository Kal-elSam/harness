import { COCKPIT_NAV, COCKPIT_REGIONS, regionsForLayout } from "./cockpit-models.js";
import { ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";
import { LAYOUT_MODES } from "./layout.js";

const NAV_FOCUSED_VIEWS = new Set([
  ORCHESTRATOR_VIEWS.HOME,
  ORCHESTRATOR_VIEWS.IDES,
  ORCHESTRATOR_VIEWS.MODULES,
  ORCHESTRATOR_VIEWS.CHANGES,
  ORCHESTRATOR_VIEWS.ACTIVITY,
  ORCHESTRATOR_VIEWS.PROFILE,
  ORCHESTRATOR_VIEWS.PROVIDERS,
  ORCHESTRATOR_VIEWS.DIAGNOSTICS,
  ORCHESTRATOR_VIEWS.HELP
]);

const CONTENT_INTERACTIVE_VIEWS = new Set([
  ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
  ORCHESTRATOR_VIEWS.RECENT_RUNS,
  ORCHESTRATOR_VIEWS.RUN_DETAIL,
  ORCHESTRATOR_VIEWS.LAUNCH
]);

export function isNavFocusedView(view) {
  return NAV_FOCUSED_VIEWS.has(view);
}

export function isContentInteractiveView(view) {
  return CONTENT_INTERACTIVE_VIEWS.has(view);
}

export function defaultRegionForView(view, layoutMode = LAYOUT_MODES.COMPACT) {
  const regions = regionsForLayout(layoutMode);
  if (isContentInteractiveView(view) && regions.includes(COCKPIT_REGIONS.CONTENT)) {
    return COCKPIT_REGIONS.CONTENT;
  }
  if (regions.includes(COCKPIT_REGIONS.NAV)) return COCKPIT_REGIONS.NAV;
  return regions[0] ?? COCKPIT_REGIONS.CONTENT;
}

export function interactiveRegionsFor(state) {
  const regions = regionsForLayout(state.layoutMode);
  if (!isContentInteractiveView(state.view) || state.view === ORCHESTRATOR_VIEWS.RUN_DETAIL) {
    return regions.filter((region) => region === COCKPIT_REGIONS.NAV);
  }
  return regions.filter(
    (region) => region === COCKPIT_REGIONS.NAV || region === COCKPIT_REGIONS.CONTENT
  );
}

export function canTabBetweenRegions(state) {
  if (!isContentInteractiveView(state.view)) return false;
  if (state.view === ORCHESTRATOR_VIEWS.RUN_DETAIL) return false;
  return interactiveRegionsFor(state).length >= 2;
}

/**
 * Map raw key intent to a reducer action (or null when inactive / view-owned).
 */
export function routeCockpitKey(state, keyAction) {
  switch (keyAction.type) {
    case "escape":
      return { type: "escape" };
    case "tab":
      return canTabBetweenRegions(state) ? { type: "tab" } : null;
    case "arrow": {
      if (state.region === COCKPIT_REGIONS.SYSTEM) return null;
      if (state.region === COCKPIT_REGIONS.NAV || isNavFocusedView(state.view)) {
        return { type: "arrow", direction: keyAction.direction };
      }
      if (state.region === COCKPIT_REGIONS.CONTENT && isContentInteractiveView(state.view)) {
        if (state.view === ORCHESTRATOR_VIEWS.RUN_DETAIL || state.view === ORCHESTRATOR_VIEWS.LAUNCH) {
          return null;
        }
        return {
          type: "arrow",
          direction: keyAction.direction,
          listLength: keyAction.listLength
        };
      }
      return null;
    }
    case "enter":
      if (state.region === COCKPIT_REGIONS.NAV || isNavFocusedView(state.view)) {
        return { type: "enter-nav" };
      }
      return null;
    default:
      return null;
  }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export { COCKPIT_NAV, COCKPIT_REGIONS, LAYOUT_MODES, ORCHESTRATOR_VIEWS, regionsForLayout };
