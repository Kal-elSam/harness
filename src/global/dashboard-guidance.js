import { formatCliCommand } from "./brand/cli.js";

export const DASHBOARD_PURPOSE =
  "Detects, configures, and coordinates local AI agents — no changes without confirmation.";

export const NEXT_STEP_KINDS = {
  CONFIGURE: "configure",
  ENABLE_INTELLIGENCE: "enable_intelligence",
  LAUNCH: "launch",
  REVIEW: "review"
};

export function formatDashboardPurpose() {
  return DASHBOARD_PURPOSE;
}

/**
 * Contextual next step from existing diagnostics + dashboard snapshot.
 * Priority: configure → review problems → enable intelligence → launch.
 */
export function resolveDashboardRecommendation({
  hasGlobalState = false,
  diagnostics = null,
  dashboard = null
} = {}) {
  const summary = diagnostics?.diagnostics ?? { detected: 0, errors: 0 };
  const intelligence = diagnostics?.intelligence?.summary;
  const launchableCount = (dashboard?.providers ?? []).filter((entry) => entry.launchable).length;
  const hasErrors = (summary.errors ?? 0) > 0;
  const hasProblemRecommendation = (diagnostics?.recommendations ?? []).some((line) =>
    /error|fix|drift|not detected|failed|problem/i.test(line)
  );

  if (!hasGlobalState || (summary.detected ?? 0) === 0) {
    return {
      kind: NEXT_STEP_KINDS.CONFIGURE,
      message: `Configure the local environment with ${formatCliCommand("setup")}.`
    };
  }

  if (hasErrors || hasProblemRecommendation) {
    return {
      kind: NEXT_STEP_KINDS.REVIEW,
      message: "Review diagnostics for problems before launching a run."
    };
  }

  if (!intelligence?.localAvailable && !intelligence?.cloudAuthenticated) {
    return {
      kind: NEXT_STEP_KINDS.ENABLE_INTELLIGENCE,
      message: "Enable intelligence: start Ollama or set OPENROUTER_API_KEY, then retry."
    };
  }

  if (launchableCount > 0) {
    return {
      kind: NEXT_STEP_KINDS.LAUNCH,
      message: "Launch a supervised run from the menu or with kairo run."
    };
  }

  return {
    kind: NEXT_STEP_KINDS.REVIEW,
    message: "Review diagnostics for problems before launching a run."
  };
}
