import { ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";

/**
 * Separate nav open from Control center CTA activation.
 * Enter opens Control center first; Enter again while there activates the CTA.
 */
export function resolveEnterNavIntent({
  currentView,
  navItem,
  ctaDestination = null
} = {}) {
  if (!navItem) return { kind: "noop" };

  const isOverview = navItem.id === "overview" || navItem.view === ORCHESTRATOR_VIEWS.HOME;
  if (isOverview) {
    if (currentView === ORCHESTRATOR_VIEWS.HOME && ctaDestination) {
      return { kind: "activate-cta", destination: ctaDestination };
    }
    return { kind: "open-nav", view: ORCHESTRATOR_VIEWS.HOME };
  }

  if (navItem.action === "launch") {
    return { kind: "launch" };
  }

  return { kind: "open-nav", view: navItem.view };
}
