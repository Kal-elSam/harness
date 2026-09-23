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

/** A window's bar-render level — the same LOW/LIMITED policy
 * `quotaWarnSuffix` encodes as text, expressed as a plain, themeable enum
 * instead. `limited` (an already rate-limited window, e.g. Go) always wins
 * over a redundant `low`, exactly like `quotaWarnSuffix`'s `alreadyFlagged`.
 * @param {number} remainingPercent
 * @param {boolean} [limited]
 * @returns {"normal"|"low"|"limited"}
 */
function windowLevel(remainingPercent, limited = false) {
  if (limited) return "limited";
  return remainingPercent < LOW_QUOTA_WARN_PERCENT ? "low" : "normal";
}

/** One measured window: `{label, remainingPercent, level}` — `label` is
 * `null` for a provider (Go) whose windows carry no name of their own. */
function usageWindow(label, remainingPercent, limited = false) {
  return { label, remainingPercent, level: windowLevel(remainingPercent, limited) };
}

function codexUsageWindows(usage) {
  const codex = usage.codex;
  if (!codex?.primary) return [];
  const windows = [usageWindow("5h", codex.primary.remainingPercent)];
  if (codex.secondary) windows.push(usageWindow("W", codex.secondary.remainingPercent));
  return windows;
}

function claudeUsageWindows(usage) {
  const claude = usage.claude;
  if (!claude?.primary) return [];
  const windows = [usageWindow("S", claude.primary.remainingPercent)];
  if (claude.secondary) windows.push(usageWindow("W", claude.secondary.remainingPercent));
  return windows;
}

/** Go's real window names (see opencode-usage.js's normalizeOpenCodeGoUsage)
 * mapped to the widget's compact display labels (P01.2 "Design": "Go
 * `roll`/`W`/`M`") — an unrecognized/missing name stays `null`, exactly
 * the honest pre-P01.2 behavior for any window this mapping doesn't know. */
function goWindowLabel(name) {
  if (name === "rolling") return "roll";
  if (name === "weekly") return "W";
  if (name === "monthly") return "M";
  return null;
}

function goUsageWindows(usage) {
  const windows = usage.opencode?.go?.windows;
  if (!windows?.length) return [];
  return windows.map((window) => usageWindow(goWindowLabel(window.name), window.remainingPercent, window.status === "rate-limited"));
}

/**
 * The structured, UI-free usage model: providers -> windows, in the exact
 * legacy cockpit order (Codex, Claude, OpenCode Go). Only AUTOMATIC-routing
 * providers appear; Zen/Cursor are manual/PAYG-risk and stay out of this
 * shared resource-pool summary (see providerLines() in cockpit/view.js for
 * those). A provider with no measured window yet reports an empty
 * `windows` array plus `fallbackStatus` — the real provider status, or the
 * honest "usage unknown" — never a fabricated window.
 * @param {{usage?: object, providers?: object}} [args]
 * @returns {{name: string, windows: {label: string|null, remainingPercent: number, level: "normal"|"low"|"limited"}[], fallbackStatus: string}[]}
 */
export function buildUsageModel({ usage = {}, providers = {} } = {}) {
  return [
    { name: "Codex", windows: codexUsageWindows(usage), fallbackStatus: providerStatus(providers, "Codex") ?? "usage unknown" },
    { name: "Claude", windows: claudeUsageWindows(usage), fallbackStatus: providerStatus(providers, "Claude") ?? "usage unknown" },
    { name: "Go", windows: goUsageWindows(usage), fallbackStatus: providerStatus(providers, "OpenCode") ?? "usage unknown" }
  ];
}

/** `showLabel` is false for Go (legacy cockpit contract: the compact bar
 * is deliberately terse, real percentages only, no per-window name labels
 * — see cockpit-view.test.js). Go's real "roll"/"W"/"M" labels (P01.2)
 * live only in `buildUsageModel`'s structured `windows[].label`, which the
 * Pi widget bar-renders directly — this text formatter never picks them
 * up for Go, so the legacy cockpit's own text stays byte-identical. */
function formatWindowSegment(window, showLabel) {
  const suffix = window.level === "low" ? " LOW" : window.level === "limited" ? " LIMITED" : "";
  const value = `${window.remainingPercent}%${suffix}`;
  return showLabel && window.label ? `${window.label} ${value}` : value;
}

function formatProviderSegment(provider) {
  if (!provider.windows.length) return `${provider.name} ${provider.fallbackStatus}`;
  const showLabel = provider.name !== "Go";
  return `${provider.name} ${provider.windows.map((window) => formatWindowSegment(window, showLabel)).join(" / ")}`;
}

/**
 * The three automatic-routing provider usage segments, in the exact
 * legacy cockpit order (Codex, Claude, OpenCode Go) — text only, no
 * width/wrap/theme decisions, which stay with each caller's own render.
 * Built directly on `buildUsageModel`, so the text and the widget's bars
 * can never drift apart.
 * @param {{usage?: object, providers?: object}} [args]
 * @returns {[string, string, string]}
 */
export function formatSubscriptionUsageSegments({ usage = {}, providers = {} } = {}) {
  return buildUsageModel({ usage, providers }).map(formatProviderSegment);
}
