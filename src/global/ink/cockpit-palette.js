import { COCKPIT_NAV } from "./cockpit-models.js";
import { ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";

export const PALETTE_KINDS = Object.freeze({
  NAVIGATE: "navigate",
  REFRESH: "refresh",
  HELP: "help"
});

const DESTINATION_VIEWS = Object.freeze({
  changes: ORCHESTRATOR_VIEWS.CHANGES,
  governance: ORCHESTRATOR_VIEWS.CHANGES,
  "control-center": ORCHESTRATOR_VIEWS.HOME,
  ides: ORCHESTRATOR_VIEWS.IDES,
  modules: ORCHESTRATOR_VIEWS.MODULES,
  activity: ORCHESTRATOR_VIEWS.ACTIVITY,
  profile: ORCHESTRATOR_VIEWS.PROFILE,
  runs: ORCHESTRATOR_VIEWS.RUNS,
  orchestration: ORCHESTRATOR_VIEWS.RUNS,
  usage: ORCHESTRATOR_VIEWS.USAGE
});

export function resolvePaletteDestination(key) {
  return DESTINATION_VIEWS[key] ?? null;
}

export function canOpenPalette({ loading = false, busy = false, confirming = false } = {}) {
  return !loading && !busy && !confirming;
}

/** Optional CTA + six destinations + Refresh + Help. No write shortcuts. */
export function buildPaletteActions({
  ctaDestination = null,
  ctaTitle = null,
  ctaDetail = null,
  navItems = COCKPIT_NAV
} = {}) {
  const actions = [];
  const recommendedView = resolvePaletteDestination(ctaDestination);
  if (recommendedView) {
    actions.push({
      id: "recommended",
      kind: PALETTE_KINDS.NAVIGATE,
      label: ctaTitle?.trim() || "Recommended next action",
      view: recommendedView,
      description: ctaDetail?.trim() || "Overview recommended destination."
    });
  }
  for (const item of navItems) {
    actions.push({
      id: item.id,
      kind: PALETTE_KINDS.NAVIGATE,
      label: item.label,
      view: item.view,
      description: item.description
    });
  }
  actions.push({
    id: "refresh",
    kind: PALETTE_KINDS.REFRESH,
    label: "Refresh",
    view: null,
    description: "Reload the read-only cockpit scan."
  });
  actions.push({
    id: "help",
    kind: PALETTE_KINDS.HELP,
    label: "Help",
    view: ORCHESTRATOR_VIEWS.HELP,
    description: "Keyboard reference and primary flow."
  });
  return actions;
}

export function buildPaletteModel({ actions = buildPaletteActions(), index = 0, unicode = true } = {}) {
  const max = Math.max(0, actions.length - 1);
  const safeIndex = Math.min(Math.max(0, index), max);
  const focus = unicode ? "›" : ">";
  return {
    title: "ACTIONS",
    hint: "Navigate · Refresh · Help — no writes",
    items: actions.map((action, i) => ({
      ...action,
      marker: i === safeIndex ? focus : " ",
      selected: i === safeIndex
    })),
    selected: actions[safeIndex] ?? null,
    index: safeIndex
  };
}
