import { LOW_QUOTA_WARN_PERCENT } from "../intelligence/execution-router.js";

/**
 * A real, early heads-up — never fabricated, never re-deriving its own
 * threshold (see execution-router.js's LOW_QUOTA_WARN_PERCENT, the same
 * canonical policy checkCandidate itself uses for its harder exclusion
 * cutoff). `alreadyFlagged` skips this for a window a caller already
 * tagged some other way (e.g. Go's own "RATE LIMITED"/"LIMITED"), so a
 * single window is never double-tagged.
 *
 * UI-free: the single source of truth for the LOW threshold text, shared
 * by the legacy cockpit widget and the Pi host's always-visible usage
 * line.
 * @param {number|null|undefined} remainingPercent
 * @param {boolean} [alreadyFlagged]
 */
export function quotaWarnSuffix(remainingPercent, alreadyFlagged = false) {
  if (alreadyFlagged || remainingPercent == null) return "";
  return remainingPercent < LOW_QUOTA_WARN_PERCENT ? " LOW" : "";
}

function providerStatus(providers, name) {
  return providers?.[name]?.status ?? providers?.[name.toLowerCase()]?.status;
}

/** `Codex 5h X%[ LOW] / W Y%[ LOW]`, or the real provider status
 * (falling back to "usage unknown") when no measured window exists yet. */
export function formatCodexUsageSegment(usage = {}, providers = {}) {
  const codex = usage.codex;
  if (codex?.primary) {
    const secondary = codex.secondary ? ` / W ${codex.secondary.remainingPercent}%${quotaWarnSuffix(codex.secondary.remainingPercent)}` : "";
    return `Codex 5h ${codex.primary.remainingPercent}%${quotaWarnSuffix(codex.primary.remainingPercent)}${secondary}`;
  }
  return `Codex ${providerStatus(providers, "Codex") ?? "usage unknown"}`;
}

/** `Claude S X%[ LOW] / W Y%[ LOW]`, or the real provider status
 * (falling back to "usage unknown") when no measured window exists yet. */
export function formatClaudeUsageSegment(usage = {}, providers = {}) {
  const claude = usage.claude;
  if (claude?.primary) {
    const secondary = claude.secondary ? ` / W ${claude.secondary.remainingPercent}%${quotaWarnSuffix(claude.secondary.remainingPercent)}` : "";
    return `Claude S ${claude.primary.remainingPercent}%${quotaWarnSuffix(claude.primary.remainingPercent)}${secondary}`;
  }
  return `Claude ${providerStatus(providers, "Claude") ?? "usage unknown"}`;
}

/** `Go a%[ LOW] / b%[ LOW] / ...`, tagging an already rate-limited window
 * LIMITED instead of a redundant LOW, or the real provider status
 * (falling back to "usage unknown") when no measured window exists yet. */
export function formatGoUsageSegment(usage = {}, providers = {}) {
  const go = usage.opencode?.go;
  if (go?.windows?.length) {
    const windows = go.windows.map((window) => {
      const limited = window.status === "rate-limited";
      return `${window.remainingPercent}%${limited ? " LIMITED" : quotaWarnSuffix(window.remainingPercent)}`;
    }).join(" / ");
    return `Go ${windows}`;
  }
  return `Go ${providerStatus(providers, "OpenCode") ?? "usage unknown"}`;
}

/**
 * The three automatic-routing provider usage segments, in the exact
 * legacy cockpit order (Codex, Claude, OpenCode Go) — text only, no
 * width/wrap/theme decisions, which stay with each caller's own render.
 * Only AUTOMATIC-routing providers appear; Zen/Cursor are manual/PAYG-risk
 * and stay out of this shared resource-pool summary (see providerLines()
 * in cockpit/view.js for those).
 * @param {{usage?: object, providers?: object}} [args]
 * @returns {[string, string, string]}
 */
export function formatSubscriptionUsageSegments({ usage = {}, providers = {} } = {}) {
  return [
    formatCodexUsageSegment(usage, providers),
    formatClaudeUsageSegment(usage, providers),
    formatGoUsageSegment(usage, providers)
  ];
}
