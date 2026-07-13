import { formatCliCommand } from "./brand/cli.js";

/** Public cockpit destinations for recommended actions (match ORCHESTRATOR_VIEWS). */
export const RECOMMENDATION_TARGETS = {
  DIAGNOSTICS: "diagnostics",
  LAUNCH: "launch",
  RECENT_RUNS: "recent-runs",
  PROVIDERS: "providers"
};

export const DASHBOARD_PURPOSE =
  "Kairo coordinates installed AI agents for this project, with controlled execution and auditable results.";

export const NEXT_STEP_KINDS = {
  CONFIGURE: "configure",
  ENABLE_INTELLIGENCE: "enable_intelligence",
  LAUNCH: "launch",
  REVIEW: "review"
};

export const READINESS_KINDS = {
  NEEDS_SETUP: "needs_setup",
  NEEDS_ATTENTION: "needs_attention",
  LIMITED: "limited",
  READY: "ready"
};

export const READINESS_LABELS = {
  [READINESS_KINDS.NEEDS_SETUP]: "Needs setup",
  [READINESS_KINDS.NEEDS_ATTENTION]: "Needs attention",
  [READINESS_KINDS.LIMITED]: "Limited",
  [READINESS_KINDS.READY]: "Ready to work"
};

export function formatDashboardPurpose() {
  return DASHBOARD_PURPOSE;
}

export function countLaunchableAgents(dashboard = null) {
  return (dashboard?.providers ?? []).filter((entry) => entry.launchable).length;
}

export function hasIntelligenceConfigured(diagnostics = null) {
  const summary = diagnostics?.intelligence?.summary;
  return Boolean(summary?.localAvailable || summary?.cloudAuthenticated);
}

function hasBlockingDiagnostics(diagnostics = null) {
  const summary = diagnostics?.diagnostics ?? { errors: 0 };
  const hasErrors = (summary.errors ?? 0) > 0;
  const hasProblemRecommendation = (diagnostics?.recommendations ?? []).some((line) =>
    /error|fix|drift|not detected|failed|problem/i.test(line)
  );
  return hasErrors || hasProblemRecommendation;
}

/**
 * Derive project readiness from diagnostics + dashboard.
 * Intelligence absence is Limited (optional), never Needs attention by itself.
 */
export function resolveProjectReadiness({
  hasGlobalState = false,
  diagnostics = null,
  dashboard = null
} = {}) {
  const summary = diagnostics?.diagnostics ?? { detected: 0, errors: 0 };
  const launchableCount = countLaunchableAgents(dashboard);
  const detected = summary.detected ?? 0;
  const agentsReady = launchableCount;
  const activeRuns = dashboard?.activeRuns?.length ?? 0;
  const intelConfigured = hasIntelligenceConfigured(diagnostics);
  const summaryLine = `${agentsReady} agents ready · ${detected} detected · ${activeRuns} active runs`;

  if (!hasGlobalState || (launchableCount === 0 && detected === 0)) {
    return {
      kind: READINESS_KINDS.NEEDS_SETUP,
      label: READINESS_LABELS[READINESS_KINDS.NEEDS_SETUP],
      headline: "NEEDS SETUP",
      summaryLine,
      capabilityLines: [
        "Intelligence: Optional capability not configured"
      ],
      healthKind: "warn"
    };
  }

  if (hasBlockingDiagnostics(diagnostics) || launchableCount === 0) {
    return {
      kind: READINESS_KINDS.NEEDS_ATTENTION,
      label: READINESS_LABELS[READINESS_KINDS.NEEDS_ATTENTION],
      headline: "NEEDS ATTENTION",
      summaryLine,
      capabilityLines: [
        intelConfigured
          ? "Intelligence: Configured"
          : "Intelligence: Optional capability not configured"
      ],
      healthKind: "error"
    };
  }

  if (!intelConfigured) {
    return {
      kind: READINESS_KINDS.LIMITED,
      label: READINESS_LABELS[READINESS_KINDS.LIMITED],
      headline: "LIMITED",
      summaryLine,
      capabilityLines: [
        "Intelligence: Optional capability not configured"
      ],
      healthKind: "warn"
    };
  }

  return {
    kind: READINESS_KINDS.READY,
    label: READINESS_LABELS[READINESS_KINDS.READY],
    headline: "READY TO WORK",
    summaryLine,
    capabilityLines: [
      "Intelligence: Configured"
    ],
    healthKind: "ready"
  };
}

/**
 * Contextual next step from existing diagnostics + dashboard snapshot.
 * Priority: configure without state → launch when launchable → configure when
 * nothing detected → review when blocked → enable intelligence → review.
 * Launchable agents win over missing optional intelligence and empty detected counts.
 */
export function resolveDashboardRecommendation({
  hasGlobalState = false,
  diagnostics = null,
  dashboard = null
} = {}) {
  const summary = diagnostics?.diagnostics ?? { detected: 0, errors: 0 };
  const intelligence = diagnostics?.intelligence?.summary;
  const launchableCount = countLaunchableAgents(dashboard);
  const blocked = hasBlockingDiagnostics(diagnostics);

  if (!hasGlobalState) {
    return {
      kind: NEXT_STEP_KINDS.CONFIGURE,
      title: "Finish local setup",
      message: `Configure the local environment with ${formatCliCommand("setup")}.`,
      detail: "Open System health to review what Kairo detected.",
      targetView: RECOMMENDATION_TARGETS.DIAGNOSTICS,
      targetAction: null
    };
  }

  if (launchableCount > 0) {
    return {
      kind: NEXT_STEP_KINDS.LAUNCH,
      title: "Create a new run",
      message: "Create a new run",
      detail: "Delegate a task to Cursor, Codex or Claude.",
      targetView: RECOMMENDATION_TARGETS.LAUNCH,
      targetAction: "launch"
    };
  }

  if ((summary.detected ?? 0) === 0) {
    return {
      kind: NEXT_STEP_KINDS.CONFIGURE,
      title: "Finish local setup",
      message: `Configure the local environment with ${formatCliCommand("setup")}.`,
      detail: "Open System health to review what Kairo detected.",
      targetView: RECOMMENDATION_TARGETS.DIAGNOSTICS,
      targetAction: null
    };
  }

  if (blocked && launchableCount === 0) {
    return {
      kind: NEXT_STEP_KINDS.REVIEW,
      title: "Review system health",
      message: "Review System health for problems before launching a run.",
      detail: "Fix agent or configuration issues, then try again.",
      targetView: RECOMMENDATION_TARGETS.DIAGNOSTICS,
      targetAction: null
    };
  }

  if (!intelligence?.localAvailable && !intelligence?.cloudAuthenticated) {
    return {
      kind: NEXT_STEP_KINDS.ENABLE_INTELLIGENCE,
      title: "Enable optional intelligence",
      message: "Enable intelligence: start Ollama or set OPENROUTER_API_KEY, then retry.",
      detail: "Agents can still run without this optional capability.",
      targetView: RECOMMENDATION_TARGETS.DIAGNOSTICS,
      targetAction: null
    };
  }

  return {
    kind: NEXT_STEP_KINDS.REVIEW,
    title: "Review system health",
    message: "Review System health for problems before launching a run.",
    detail: "Open System health to inspect agents and configuration.",
    targetView: RECOMMENDATION_TARGETS.DIAGNOSTICS,
    targetAction: null
  };
}
