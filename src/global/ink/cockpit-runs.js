import { ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";

export const RUNS_HUB_ITEMS = [
  {
    id: "active",
    label: "Active runs",
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    description: "Inspect and cancel supervised runs that are currently executing."
  },
  {
    id: "history",
    label: "History",
    view: ORCHESTRATOR_VIEWS.RECENT_RUNS,
    description: "Review completed and failed run outcomes."
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
    || view === ORCHESTRATOR_VIEWS.RUN_DETAIL;
}

export function isRunsChildView(view) {
  return view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
    || view === ORCHESTRATOR_VIEWS.RECENT_RUNS
    || view === ORCHESTRATOR_VIEWS.LAUNCH;
}

export function resolveRunsHubItem(listIndex = 0, items = RUNS_HUB_ITEMS) {
  if (items.length === 0) return null;
  const index = Math.min(Math.max(0, listIndex), items.length - 1);
  return items[index] ?? null;
}

export function formatRunsHubLines(items = RUNS_HUB_ITEMS) {
  return items.map((item) => `${item.label} — ${item.description}`);
}
