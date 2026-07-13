import { LAYOUT_MODES, resolveListLimit } from "./layout.js";
import { ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";
import { resolveProjectReadiness } from "../dashboard-guidance.js";
import { STATUS_LABELS, resolveGlyphs } from "./theme.js";
import { windowList } from "./list-window.js";
import { buildHomeMissionModel, formatHomeRecentRun } from "./cockpit-home.js";

export const COCKPIT_REGIONS = {
  NAV: "nav",
  CONTENT: "content",
  SYSTEM: "system"
};

export const COCKPIT_NAV = [
  {
    id: "overview",
    label: "Home",
    view: ORCHESTRATOR_VIEWS.HOME,
    description: "What Kairo does here, readiness, and the next useful action."
  },
  {
    id: "active",
    label: "Running now",
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    description: "Supervised runs executing right now."
  },
  {
    id: "recent",
    label: "History",
    view: ORCHESTRATOR_VIEWS.RECENT_RUNS,
    description: "Past runs with agent, state, and readable result."
  },
  {
    id: "providers",
    label: "Agents",
    view: ORCHESTRATOR_VIEWS.PROVIDERS,
    description: "Installed tools Kairo can launch and audit."
  },
  {
    id: "launch",
    label: "New run",
    view: ORCHESTRATOR_VIEWS.LAUNCH,
    action: "launch",
    description: "Delegate a task to an executable agent."
  },
  {
    id: "diagnostics",
    label: "System health",
    view: ORCHESTRATOR_VIEWS.DIAGNOSTICS,
    description: "Agents, intelligence, authentication, and configuration."
  }
];

export function regionsForLayout(layoutMode) {
  if (layoutMode === LAYOUT_MODES.WIDE) {
    return [COCKPIT_REGIONS.NAV, COCKPIT_REGIONS.CONTENT, COCKPIT_REGIONS.SYSTEM];
  }
  if (layoutMode === LAYOUT_MODES.COMPACT) {
    return [COCKPIT_REGIONS.NAV, COCKPIT_REGIONS.CONTENT];
  }
  return [COCKPIT_REGIONS.CONTENT];
}

export function navIndexForView(view, items = COCKPIT_NAV) {
  const index = items.findIndex((item) => item.view === view);
  return index >= 0 ? index : 0;
}

export function buildTopBarModel({
  projectName = "project",
  systemOnline = true,
  unicode = true
} = {}) {
  const glyphs = resolveGlyphs(unicode);
  const status = systemOnline ? STATUS_LABELS.online : STATUS_LABELS.offline;
  return {
    brand: "KAIRO",
    status,
    statusKind: systemOnline ? "online" : "offline",
    projectLabel: `Project: ${projectName}`,
    separator: glyphs.bullet
  };
}

export function resolveNavStatusSummary(item, { dashboard = null, diagnostics = null } = {}) {
  const active = dashboard?.activeRuns?.length ?? 0;
  const recent = dashboard?.recentRuns?.length ?? 0;
  const providers = dashboard?.providers ?? [];
  const launchable = providers.filter((entry) => entry.launchable).length;
  const detected = diagnostics?.diagnostics?.detected ?? providers.filter((p) => p.available).length;
  const errors = diagnostics?.diagnostics?.errors ?? 0;

  switch (item.id) {
    case "overview":
      return resolveProjectReadiness({
        hasGlobalState: true,
        diagnostics,
        dashboard
      }).label;
    case "active":
      return active === 0 ? "Idle" : `${active} active`;
    case "recent":
      return recent === 0 ? "No history" : `${recent} recent`;
    case "providers":
      return `${launchable}/${providers.length || detected} ready`;
    case "launch":
      return launchable > 0 ? "Ready" : "Unavailable";
    case "diagnostics":
      return errors > 0 ? `${errors} issues` : "Checked";
    default:
      return "";
  }
}

export function buildNavModel({
  navIndex = 0,
  currentView = ORCHESTRATOR_VIEWS.HOME,
  focused = false,
  unicode = true,
  items = COCKPIT_NAV,
  dashboard = null,
  diagnostics = null
} = {}) {
  const glyphs = resolveGlyphs(unicode);
  const selected = items[navIndex] ?? items[0];
  const mapped = items.map((item, index) => {
    const isSelected = index === navIndex;
    const isCurrent = item.view === currentView;
    return {
      ...item,
      marker: isSelected ? glyphs.focus : (isCurrent ? glyphs.bullet : " "),
      selected: isSelected,
      current: isCurrent,
      focused: focused && isSelected,
      statusSummary: resolveNavStatusSummary(item, { dashboard, diagnostics })
    };
  });

  return {
    title: "NAVIGATION",
    explanation: selected
      ? `${selected.description} (${resolveNavStatusSummary(selected, { dashboard, diagnostics })})`
      : "",
    items: mapped
  };
}

export function buildSystemStripModel({
  dashboard = null,
  diagnostics = null,
  readiness = null
} = {}) {
  const agentsDetected = diagnostics?.diagnostics?.detected
    ?? (dashboard?.providers ?? []).filter((p) => p.available).length;
  const agentsTotal = diagnostics?.capabilities?.length
    ?? dashboard?.providers?.length
    ?? 0;
  const activeRuns = dashboard?.activeRuns?.length ?? 0;
  const intelligence = diagnostics?.intelligence?.summary;
  const intelLabel = intelligence?.localAvailable
    ? STATUS_LABELS.local
    : intelligence?.cloudAuthenticated
      ? "Cloud"
      : "None";
  const resolved = readiness ?? resolveProjectReadiness({
    hasGlobalState: agentsDetected > 0,
    diagnostics,
    dashboard
  });

  return {
    title: "SYSTEM",
    rows: [
      { key: "Agents", value: `${agentsDetected}/${agentsTotal}`, kind: agentsDetected > 0 ? "ready" : "warn" },
      { key: "Runs", value: String(activeRuns), kind: activeRuns > 0 ? "ready" : "muted" },
      { key: "Intel", value: intelLabel, kind: intelLabel === "None" ? "warn" : "ready" },
      {
        key: "Health",
        value: STATUS_LABELS[resolved.kind] ?? resolved.label ?? resolved.kind,
        kind: resolved.healthKind ?? "warn"
      }
    ]
  };
}

export function buildFooterModel({
  view = ORCHESTRATOR_VIEWS.HOME,
  region = COCKPIT_REGIONS.NAV,
  helpOpen = false,
  canCancel = false,
  unicode = true,
  hasError = false
} = {}) {
  const glyphs = resolveGlyphs(unicode);
  const parts = [];

  if (hasError) {
    parts.push("R Retry");
    parts.push("Esc Exit");
    return { text: parts.join(` ${glyphs.bullet} `) };
  }

  if (helpOpen || view === ORCHESTRATOR_VIEWS.HELP) {
    parts.push("Esc close help");
    parts.push("? Help");
    return { text: parts.join(` ${glyphs.bullet} `) };
  }

  if (view === ORCHESTRATOR_VIEWS.RUN_DETAIL) {
    parts.push("R refresh");
    if (canCancel) parts.push("C cancel");
    parts.push("Esc Back");
    return { text: parts.join(` ${glyphs.bullet} `) };
  }

  parts.push("↑↓ Navigate");

  const showTab = view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
    || view === ORCHESTRATOR_VIEWS.RECENT_RUNS
    || view === ORCHESTRATOR_VIEWS.LAUNCH;
  if (showTab) {
    parts.push("Tab Region");
  }

  if (view === ORCHESTRATOR_VIEWS.HOME
    || view === ORCHESTRATOR_VIEWS.PROVIDERS
    || view === ORCHESTRATOR_VIEWS.DIAGNOSTICS
    || region === COCKPIT_REGIONS.NAV
    || view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
    || view === ORCHESTRATOR_VIEWS.RECENT_RUNS) {
    parts.push("Enter Open");
  }

  if (view !== ORCHESTRATOR_VIEWS.LAUNCH) {
    parts.push("R refresh");
  }

  parts.push("? Help");
  parts.push(view === ORCHESTRATOR_VIEWS.HOME ? "Esc Exit" : "Esc Back");

  return { text: parts.join(` ${glyphs.bullet} `) };
}

export function windowLinesForLayout(lines = [], layoutMode = LAYOUT_MODES.COMPACT, contentRows = 12) {
  const limit = resolveListLimit(layoutMode, { contentRows });
  return windowList(lines, limit);
}

export function resolveProjectName(workspaceRoot = "") {
  if (!workspaceRoot) return "project";
  const parts = String(workspaceRoot).split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || "project";
}

export { buildHomeMissionModel, formatHomeRecentRun };
