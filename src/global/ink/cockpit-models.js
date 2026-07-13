import { LAYOUT_MODES } from "./layout.js";
import { ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";
import { resolveDashboardRecommendation } from "../dashboard-guidance.js";
import { STATUS_LABELS, resolveGlyphs } from "./theme.js";
import { windowList } from "./list-window.js";
import { resolveListLimit } from "./layout.js";

export const COCKPIT_REGIONS = {
  NAV: "nav",
  CONTENT: "content",
  SYSTEM: "system"
};

export const COCKPIT_NAV = [
  { id: "overview", label: "Overview", view: ORCHESTRATOR_VIEWS.HOME },
  { id: "active", label: "Active runs", view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS },
  { id: "recent", label: "Recent runs", view: ORCHESTRATOR_VIEWS.RECENT_RUNS },
  { id: "providers", label: "Providers", view: ORCHESTRATOR_VIEWS.PROVIDERS },
  { id: "launch", label: "Launch run", view: ORCHESTRATOR_VIEWS.LAUNCH, action: "launch" },
  { id: "diagnostics", label: "Diagnostics", view: ORCHESTRATOR_VIEWS.DIAGNOSTICS }
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

export function buildNavModel({
  navIndex = 0,
  focused = false,
  unicode = true,
  items = COCKPIT_NAV
} = {}) {
  const glyphs = resolveGlyphs(unicode);
  return {
    title: "NAVIGATION",
    items: items.map((item, index) => ({
      ...item,
      marker: index === navIndex ? glyphs.focus : " ",
      selected: index === navIndex,
      focused: focused && index === navIndex
    }))
  };
}

export function buildSystemStripModel({
  dashboard = null,
  diagnostics = null,
  healthKind = "ready"
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

  return {
    title: "SYSTEM",
    rows: [
      { key: "Agents", value: `${agentsDetected}/${agentsTotal}`, kind: agentsDetected > 0 ? "ready" : "warn" },
      { key: "Runs", value: String(activeRuns), kind: activeRuns > 0 ? "ready" : "muted" },
      { key: "Intel", value: intelLabel, kind: intelLabel === "None" ? "warn" : "ready" },
      { key: "Health", value: STATUS_LABELS[healthKind] ?? healthKind, kind: healthKind }
    ]
  };
}

export function buildHomeMissionModel({
  hasGlobalState = false,
  diagnostics = null,
  dashboard = null,
  layoutMode = LAYOUT_MODES.COMPACT,
  activityLines = []
} = {}) {
  const recommendation = resolveDashboardRecommendation({
    hasGlobalState,
    diagnostics,
    dashboard
  });
  const limit = resolveListLimit(layoutMode, { contentRows: 10 });
  const windowed = windowList(activityLines, limit);

  return {
    title: "MISSION CONTROL",
    recommendedTitle: "Recommended action",
    recommendedAction: recommendation.message,
    recommendedKind: recommendation.kind,
    activityTitle: activityLines.length ? "Activity" : "Activity / empty state",
    activityLines: windowed.items,
    moreLine: windowed.moreLine,
    emptyHint: activityLines.length === 0
      ? "No recent activity. Launch a run when agents are ready."
      : null
  };
}

export function buildFooterModel({
  view = ORCHESTRATOR_VIEWS.HOME,
  region = COCKPIT_REGIONS.NAV,
  helpOpen = false,
  canCancel = false,
  unicode = true
} = {}) {
  const glyphs = resolveGlyphs(unicode);
  if (helpOpen) {
    return {
      text: `Esc close help ${glyphs.bullet} R refresh ${glyphs.bullet} C cancel run`
    };
  }
  if (view === ORCHESTRATOR_VIEWS.HOME) {
    return {
      text: `↑↓ Navigate ${glyphs.bullet} Tab Region ${glyphs.bullet} Enter Open ${glyphs.bullet} ? Help ${glyphs.bullet} Esc Exit`
    };
  }
  const cancel = canCancel ? ` ${glyphs.bullet} C cancel` : "";
  return {
    text: `↑↓ Navigate ${glyphs.bullet} Enter Open ${glyphs.bullet} R refresh${cancel} ${glyphs.bullet} Esc Back · focus:${region}`
  };
}

export function resolveProjectName(workspaceRoot = "") {
  if (!workspaceRoot) return "project";
  const parts = String(workspaceRoot).split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || "project";
}
