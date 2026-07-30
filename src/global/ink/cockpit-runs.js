import { ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";

export const RUNS_HUB_ITEMS = [
  {
    id: "active",
    label: "Active runs",
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    description: "Inspect and cancel supervised runs in flight."
  },
  {
    id: "history",
    label: "History",
    view: ORCHESTRATOR_VIEWS.RECENT_RUNS,
    description: "Completed and failed outcomes."
  },
  {
    id: "reviews",
    label: "Reviews",
    view: ORCHESTRATOR_VIEWS.REVIEWS,
    description: "Secret-free review receipts (read-only)."
  },
  {
    id: "launch",
    label: "New run",
    view: ORCHESTRATOR_VIEWS.LAUNCH,
    action: "launch",
    description: "Start a supervised run after governance is healthy."
  }
];

export function isRunsBranchView(view) {
  return view === ORCHESTRATOR_VIEWS.RUNS
    || view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
    || view === ORCHESTRATOR_VIEWS.RECENT_RUNS
    || view === ORCHESTRATOR_VIEWS.LAUNCH
    || view === ORCHESTRATOR_VIEWS.RUN_DETAIL
    || view === ORCHESTRATOR_VIEWS.REVIEWS
    || view === ORCHESTRATOR_VIEWS.REVIEW_DETAIL;
}

export function isRunsChildView(view) {
  return view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
    || view === ORCHESTRATOR_VIEWS.RECENT_RUNS
    || view === ORCHESTRATOR_VIEWS.LAUNCH
    || view === ORCHESTRATOR_VIEWS.REVIEWS;
}

export function resolveRunsHubItem(listIndex = 0, items = RUNS_HUB_ITEMS) {
  if (items.length === 0) return null;
  const index = Math.min(Math.max(0, listIndex), items.length - 1);
  return items[index] ?? null;
}

/** Selectable hub labels only — counts belong in the panel title/hint. */
export function formatRunsHubLines(items = RUNS_HUB_ITEMS) {
  return items.map((item) => item.label);
}

export function formatOrchestrationStatus({
  active = 0,
  recent = 0,
  reviews = 0
} = {}) {
  return `${active} active · ${recent} recent · ${reviews} reviews`;
}
