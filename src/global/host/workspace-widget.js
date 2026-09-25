import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CARD_TONE, cardInnerWidth, renderPanel } from "../cockpit/card.js";

// The Pi widget for the Kairo workspace — two bordered panels (HERD,
// USAGE), side by side when the terminal is wide enough, stacked otherwise
// (HERD above USAGE). The HERD panel is the Herdr-style attention view:
// compact spaces (project + session) above a blocked-first glyph agent
// list — the dense role/model/via table left the overview on purpose, its
// detail lives in /kairo-team. Rendered as a Pi component factory (see
// createKairoWorkspaceWidget below) instead of a plain string array so it
// is never capped at Pi's MAX_WIDGET_LINES=10 (see the P01.1 "Why" in
// odd/tasks/kairo-pi-parity.md — that cap is exactly what truncated the
// Reviewer row in P01).
//
// The pure render function (renderKairoWorkspaceWidget) never reads a TTY
// or Pi's real Theme class — it only calls theme.fg(role, text) and
// theme.bold(text), so it is fully testable with a fake theme. `role` must
// stay inside Pi's real ThemeColor set (accent, border, success, error,
// warning, muted, text, ...) — Kairo's OWN cockpit theme additionally
// defines "info"/"selection", which Pi's Theme class does not, so this
// module never uses those two roles.

const GAUGE_CELLS = 10;
const NAME_COLUMN_WIDTH = 7;
const LABEL_COLUMN_WIDTH = 4;
const HERD_SEPARATOR = " · ";
const HERD_PROJECT_GLYPH = "◈";
// One glyph per herd state — a single-width character each, so
// visibleWidth arithmetic holds on real TTYs. Only BLOCKED also prints
// as a word (the P01.1 "no available noise, only exceptions" contract);
// every other state reads from its glyph alone.
const HERD_STATE_GLYPH = { blocked: "✖", working: "◉", idle: "○", done: "✔", unknown: "?" };
const HERD_STATE_TONE = { blocked: "error", working: "success", idle: "text", done: "muted", unknown: "muted" };
// Attention order: blocked first, then working, idle, done, unknown last
// (unknown is no evidence, never an alarm — its glyph still shows it
// honestly). Sort is stable, so ties keep snapshot (strategy) order.
const HERD_STATE_RANK = { blocked: 0, working: 1, idle: 2, done: 3, unknown: 4 };
const FOOTER_COMMAND_SEPARATOR = " · ";
// Mirrors card.js's own FRAME_COLUMNS (left rail + space + space + right
// rail) — every bordered panel needs exactly this many columns beyond its
// content. Duplicated here rather than imported since card.js doesn't
// export it; cardInnerWidth's own inverse arithmetic is the same relation.
const PANEL_FRAME_COLUMNS = 4;
// "left-aligned side by side with a 2-column gap" (P01.2 Design).
const PANEL_GAP = 2;

function naturalContentWidth(lines) {
  return lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
}

/** The HERD panel's unthemed measure lines — the real herd facts (spaces
 * plus one natural line per agent, attention-ordered), never an
 * already-rendered, already-width-constrained body (computing THAT would
 * need the width the caller itself decides, see computeSideBySideWidths'
 * own doc). Unthemed plain strings: a real ANSI theme is zero-width, and
 * themed measuring would lie. */
function herdMeasureLines(snapshot) {
  const agents = snapshot.agents ?? [];
  const lines = [...herdSpacesLines(snapshot)];
  if (!agents.length) {
    lines.push("Run /project analyze to build this project's team.");
  } else {
    for (const agent of sortedHerdAgents(agents)) lines.push(herdNaturalLine(agent));
  }
  return lines;
}

/**
 * The HERD/USAGE panel widths for a given total render width — each sized
 * to its OWN content (P01.2: "panels sized to their content, left-aligned,
 * side by side with a 2-column gap, stacked when they do not fit"), never
 * a naive half-width split. Side by side only when both panels' desired
 * widths plus the gap actually fit; both equal to the full width when
 * stacked (so no line can ever exceed `width`, the one hard constraint —
 * see renderKairoWorkspaceWidget's own doc).
 *
 * Exported so tests can pass short bodies without re-deriving this
 * arithmetic (see test/workspace-widget.test.js).
 * @param {number} width
 * @param {string[]} leftBody - the HERD panel's unthemed measure lines
 *   (their width never depends on the panel's own width, unlike a body
 *   that truncates providers into it — see herdPanelBody)
 * @param {string[]} rightBody - the ALREADY-themed USAGE panel content
 *   lines (their width never depends on the panel's own width, unlike
 *   HERD's — see usagePanelBody).
 * @returns {{leftWidth: number, rightWidth: number, sideBySide: boolean, gap: number}}
 */
export function computeSideBySideWidths(width, leftBody = [], rightBody = []) {
  const targetWidth = Math.max(1, Math.floor(width));
  const leftDesired = naturalContentWidth(leftBody) + PANEL_FRAME_COLUMNS;
  const rightDesired = naturalContentWidth(rightBody) + PANEL_FRAME_COLUMNS;
  const fits = leftDesired <= targetWidth
    && rightDesired <= targetWidth
    && leftDesired + PANEL_GAP + rightDesired <= targetWidth;
  if (!fits) {
    return { leftWidth: targetWidth, rightWidth: targetWidth, sideBySide: false, gap: 0 };
  }
  return { leftWidth: leftDesired, rightWidth: rightDesired, sideBySide: true, gap: PANEL_GAP };
}

/** Renders a cache age in whole minutes/hours/days ("5m ago"), the same
 * compact vocabulary across usage and team panels. `null` when there's no
 * age to show. */
function formatCacheAge(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  if (totalMinutes < 1) return "just now";
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function usageBarTone(level) {
  if (level === "limited") return "error";
  if (level === "low") return "warning";
  return "success";
}

/** A themed `remainingPercent` bar — one thin line, never a solid block
 * (P01.2 "Why": "the 10-cell solid bars merged into a blob"). The
 * remaining segment (`━`, a heavy horizontal line) reads the window's own
 * level (never a separately re-derived threshold; see usage-summary.js's
 * `buildUsageModel`, the single source of truth for `level`); the used
 * segment (`─`, a light horizontal line) stays muted, so remaining vs.
 * used reads as two visually distinct line weights, not just two colors. */
function paintUsageBar(window, theme, cells = GAUGE_CELLS) {
  const clamped = Math.max(0, Math.min(100, window.remainingPercent ?? 0));
  const filled = Math.round((clamped / 100) * cells);
  return theme.fg(usageBarTone(window.level), "━".repeat(filled)) + theme.fg("muted", "─".repeat(cells - filled));
}

/** One provider's usage lines: `Codex   5h ████░░░░ 80%` then, for any
 * further window, an indented continuation (`         W ████░░░░ 83%`).
 * A provider with no measured window yet (`windows` empty) prints its
 * real fallback status instead of a fabricated bar. `dim` (the P01.2
 * last-known cache) renders every line muted regardless of level, since a
 * stale value should never read as a fresh, colored warning/error. */
function usageProviderLines(provider, theme, dim = false) {
  const name = provider.name.padEnd(NAME_COLUMN_WIDTH);
  if (!provider.windows.length) {
    return [`${name}${theme.fg("muted", provider.fallbackStatus)}`];
  }
  return provider.windows.map((window, index) => {
    const namePart = index === 0 ? name : " ".repeat(NAME_COLUMN_WIDTH);
    const label = (window.label ?? "").padEnd(LABEL_COLUMN_WIDTH);
    const bar = dim
      ? theme.fg("muted", "━".repeat(GAUGE_CELLS))
      : paintUsageBar(window, theme);
    const line = `${namePart}${label} ${bar} ${window.remainingPercent}%`;
    return dim ? theme.fg("muted", line) : line;
  });
}

/** The USAGE panel body — real bars once live data is ready, the P01.2
 * last-known cache dim with its age while a live refresh is pending or has
 * just failed, or one dim honest state line (`usage checking`/`usage
 * unknown`) when there's no cache at all. Never fabricates a bar for state
 * that hasn't resolved yet, and never presents a cached value as fresh. */
function usagePanelBody(subscriptions, theme) {
  if (subscriptions?.state === "cached") {
    const lines = (subscriptions.usageModel ?? []).flatMap((provider) => usageProviderLines(provider, theme, true));
    const age = formatCacheAge(subscriptions.cacheAgeMs);
    return [...lines, theme.fg("muted", age ? `cached ${age}` : "cached")];
  }
  if (!subscriptions || subscriptions.state !== "ready") {
    return [theme.fg("muted", `usage ${subscriptions?.state ?? "checking"}`)];
  }
  return (subscriptions.usageModel ?? []).flatMap((provider) => usageProviderLines(provider, theme));
}

/** The one shared Kairo session-identity line (`session: <8hex> · <mode>`,
 * or the honest `session: unbound` — never an implied "ask"), used
 * everywhere a Kairo surface names the currently bound session: the
 * overview's USAGE panel footer, every other Pi-side detail/replacement
 * view (workspace-shell extension's `linesForView`/`workspaceStatus`),
 * and the status bar. Kept in this module (not duplicated per call site)
 * so bound/unbound wording only ever needs to change in one place. */
export function formatSessionIdentity(session) {
  if (session?.state !== "bound") return "session: unbound";
  return `session: ${session.id.slice(0, 8)} · ${session.mode ?? "ask"}`;
}

/** The compact spaces lines — current project plus bound session, from
 * the H1 herd contract (`snapshot.spaces`), never an invented multi-repo
 * list. Pre-herd snapshots (no `spaces`) fall back to the same two
 * top-level facts, worded identically. Unthemed: the caller themes. */
function herdSpacesLines(snapshot) {
  const spaces = snapshot.spaces;
  if (Array.isArray(spaces) && spaces.length) {
    return spaces.map((space) => {
      if (space?.kind === "session") {
        if (space.state !== "bound") return "session: unbound";
        return `session: ${space.id} · ${space.mode ?? "ask"}`;
      }
      return `${HERD_PROJECT_GLYPH} ${space?.label ?? space?.root ?? "unknown"}`;
    });
  }
  return [
    `${HERD_PROJECT_GLYPH} ${snapshot.project?.label ?? snapshot.project?.root ?? "unknown"}`,
    formatSessionIdentity(snapshot.session)
  ];
}

/** One agent's natural (unthemed) herd line — glyph + label + short
 * provider, BLOCKED as the only state word (see HERD_STATE_GLYPH). */
function herdNaturalLine(agent) {
  const glyph = HERD_STATE_GLYPH[agent.state] ?? HERD_STATE_GLYPH.unknown;
  const tail = agent.state === "blocked"
    ? `${agent.provider ?? "unknown"}${HERD_SEPARATOR}BLOCKED`
    : (agent.provider ?? "unknown");
  return `${glyph} ${agent.label ?? "Unknown role"}${HERD_SEPARATOR}${tail}`;
}

/** Herd agents in attention order (see HERD_STATE_RANK) — stable, so ties
 * keep snapshot (strategy) order. */
function sortedHerdAgents(agents) {
  return [...agents].sort(
    (a, b) => (HERD_STATE_RANK[a.state] ?? HERD_STATE_RANK.unknown) - (HERD_STATE_RANK[b.state] ?? HERD_STATE_RANK.unknown)
  );
}

/** One themed herd agent line, fitted into `innerWidth` — the label is
 * never truncated (real names are short and meaningful; truncating them
 * would be actively misleading); only the provider tail shrinks, via
 * `truncateToWidth`. `cardLine` remains the final backstop. */
function herdAgentLine(agent, theme, innerWidth) {
  const tone = HERD_STATE_TONE[agent.state] ?? "muted";
  const glyph = HERD_STATE_GLYPH[agent.state] ?? HERD_STATE_GLYPH.unknown;
  const head = `${glyph} ${agent.label ?? "Unknown role"}`;
  const tail = agent.state === "blocked"
    ? `${agent.provider ?? "unknown"}${HERD_SEPARATOR}BLOCKED`
    : (agent.provider ?? "unknown");
  const maxTail = innerWidth - visibleWidth(head) - visibleWidth(HERD_SEPARATOR);
  if (maxTail < 1) return theme.fg(tone, truncateToWidth(head, innerWidth, "…"));
  const clippedTail = visibleWidth(tail) > maxTail ? truncateToWidth(tail, maxTail, "…") : tail;
  return theme.fg(tone, `${head}${HERD_SEPARATOR}${clippedTail}`);
}

function herdPanelBody(snapshot, theme, innerWidth) {
  const agents = snapshot.agents ?? [];
  const spaces = herdSpacesLines(snapshot).map((line) => theme.fg("text", line));
  if (!agents.length) {
    return [...spaces, theme.fg("muted", "Run /project analyze to build this project's team.")];
  }
  return [...spaces, ...sortedHerdAgents(agents).map((agent) => herdAgentLine(agent, theme, innerWidth))];
}

/** The HERD panel title — the blocked count when anything needs
 * attention (one glance answers who), the team state otherwise, or the
 * P01.2 last-known cache age while showing a stale value. Never claims
 * "checking": unknown glyphs on the rows already say that honestly. */
function herdPanelTitle(snapshot) {
  const team = snapshot.team;
  if (team?.cached) {
    const age = formatCacheAge(team.cacheAgeMs);
    return age ? `HERD · cached ${age}` : "HERD · cached";
  }
  const blocked = (snapshot.agents ?? []).filter((agent) => agent.state === "blocked").length;
  if (blocked === 1) return "HERD · 1 blocked";
  if (blocked > 1) return `HERD · ${blocked} blocked`;
  return `HERD · ${team?.state ?? "not_analyzed"}`;
}

function herdPanelTone(snapshot) {
  const agents = snapshot.agents ?? [];
  if (snapshot.team?.cached) return "muted";
  if (agents.some((agent) => agent.state === "blocked")) return "warning";
  if (agents.length && agents.every((agent) => agent.state === "unknown")) return "muted";
  return "accent";
}

const HERD_FOOTER_COMMANDS = ["/kairo-team", "/kairo-route", "/kairo-usage", "/kairo-memory"];

/** The largest visible width `cardBottom` can give a footer label inside
 * a panel of `panelWidth` columns — mirrors its own arithmetic
 * (`head = "─ " + label + " "`, `maxHeadWidth = panelWidth - 3`) so this
 * never drifts out of sync with what actually fits. */
function footerLabelBudget(panelWidth) {
  return Math.max(0, panelWidth - 6);
}

/** Only whole commands that fit — dropping every command starting from
 * the first one that wouldn't, never truncating a command mid-name (the
 * reported defect: cardBottom's own truncateToWidth used to cut
 * "/kairo-memory" into a partial, ANSI-artifact-trailing fragment). */
function fitFooterCommands(commands, maxWidth) {
  let result = "";
  for (const command of commands) {
    const candidate = result ? `${result}${FOOTER_COMMAND_SEPARATOR}${command}` : command;
    if (visibleWidth(candidate) > maxWidth) break;
    result = candidate;
  }
  return result;
}

function herdPanelFooter(panelWidth) {
  return fitFooterCommands(HERD_FOOTER_COMMANDS, footerLabelBudget(panelWidth));
}

/**
 * The pure line-building logic behind the Pi widget — takes a workspace
 * snapshot (see workspace-snapshot.js), a target width, and a theme, and
 * returns the exact terminal lines to render. No TTY, no Pi imports: fully
 * testable with a fake `{fg, bold}` theme (see test/workspace-widget.test.js).
 * Every returned line fits within `width` (measured with pi-tui's
 * `visibleWidth`, since card.js's cardLine/cardTop/cardBottom already
 * truncate/pad to it).
 * @param {object} snapshot - a kairo.workspace-shell/v1 snapshot
 * @param {number} width
 * @param {{fg(role:string,text:string):string, bold(text:string):string}} theme
 * @param {string[]} [extraLines] - e.g. the one failed-live-check line;
 *   appended below both panels, dimmed.
 * @returns {string[]}
 */
export function renderKairoWorkspaceWidget(snapshot, width, theme, extraLines = []) {
  const herdMeasure = herdMeasureLines(snapshot);
  const usageBody = usagePanelBody(snapshot.subscriptions, theme);
  const { leftWidth, rightWidth, sideBySide, gap } = computeSideBySideWidths(width, herdMeasure, usageBody);
  const herdBody = herdPanelBody(snapshot, theme, cardInnerWidth(leftWidth));
  const herdFooter = herdPanelFooter(leftWidth);
  const herdTitle = herdPanelTitle(snapshot);
  const herdTone = herdPanelTone(snapshot);

  let panelLines;
  if (sideBySide) {
    const targetLineCount = Math.max(herdBody.length, usageBody.length);
    const left = renderPanel(herdTitle, herdTone, theme, leftWidth, herdBody, targetLineCount, herdFooter);
    const right = renderPanel("USAGE", CARD_TONE.SUCCESS, theme, rightWidth, usageBody, targetLineCount);
    const gapStr = " ".repeat(gap);
    panelLines = left.map((line, index) => `${line}${gapStr}${right[index] ?? ""}`);
  } else {
    panelLines = [
      ...renderPanel(herdTitle, herdTone, theme, leftWidth, herdBody, undefined, herdFooter),
      ...renderPanel("USAGE", CARD_TONE.SUCCESS, theme, rightWidth, usageBody)
    ];
  }

  return [...panelLines, ...extraLines.map((line) => theme.fg("muted", line))];
}

/**
 * The Pi `ctx.ui.setWidget` component factory built from one snapshot —
 * captures `snapshot`/`extraLines` in closure, so the extension calls this
 * again (with a fresh snapshot) for each of its two render phases, exactly
 * like it used to call `setWidget` again with a fresh string array.
 * @param {object} snapshot
 * @param {string[]} [extraLines]
 */
export function createKairoWorkspaceWidget(snapshot, extraLines = []) {
  return (_tui, theme) => ({
    render(width) {
      return renderKairoWorkspaceWidget(snapshot, width, theme, extraLines);
    }
  });
}

/**
 * A component factory for a plain, unframed list of text lines — the same
 * shape a detail view (e.g. `/kairo-team`) used to pass straight to
 * `ctx.ui.setWidget` as a string array. Wrapping it in a component instead
 * only removes Pi's MAX_WIDGET_LINES=10 cap; it does not add framing or
 * theming (a bounded view under 10 lines can stay a plain string array —
 * see extension/index.js for which views need this).
 * @param {string[]} lines
 */
export function createKairoTextWidget(lines) {
  return () => ({
    render(width) {
      const targetWidth = Math.max(1, Math.floor(width));
      return lines.map((line) => truncateToWidth(line, targetWidth));
    }
  });
}

// --- H7/H8 shell surface: the fullscreen left sidebar (SPACES/AGENTS,
// never HERD — that title stays the regular-mode overview's own) and
// bottom strip (USAGE) that the extension feeds when the fork exposes
// `setSidebar`/`setBottomStrip` (see extension/index.js). Same snapshot
// facts and glyph/order rules as the HERD panel above; only the framing
// and headers differ, since the fork renders these as bare slot content,
// never inside a bordered card.

/** Columns below which the fixed 28-col sidebar is dropped for a compact
 * summary instead (H8 responsive contract). */
export const SHELL_SIDEBAR_MIN_COLUMNS = 90;

// The fixed sidebar width from the H8 acceptance criteria — the sidebar
// never resizes with the terminal once it is shown; only its content
// wraps to this budget.
const SHELL_SIDEBAR_COLUMNS = 28;

/** The fullscreen sidebar's lines — SPACES then AGENTS (blocked-first,
 * fail-closed unknown), reusing the exact same glyph/order/truncation
 * rules as the HERD panel (see herdAgentLine/sortedHerdAgents above), just
 * under different headers and without a bordered card. */
export function renderShellSidebarLines(snapshot, theme) {
  const innerWidth = cardInnerWidth(SHELL_SIDEBAR_COLUMNS);
  const agents = snapshot.agents ?? [];
  const agentLines = agents.length
    ? sortedHerdAgents(agents).map((agent) => herdAgentLine(agent, theme, innerWidth))
    : [theme.fg("muted", "Run /project analyze to build this project's team.")];
  return [
    theme.bold("SPACES"),
    ...herdSpacesLines(snapshot).map((line) => theme.fg("text", line)),
    theme.bold("AGENTS"),
    ...agentLines
  ];
}

/** The fullscreen bottom strip's lines — the same USAGE gauges as the
 * overview's USAGE panel, plus the shared session-identity line (see
 * formatSessionIdentity), since the strip replaces that panel's footer
 * role once the shell owns the layout. */
export function renderShellBottomStripLines(snapshot, theme) {
  return [
    theme.bold("USAGE"),
    ...usagePanelBody(snapshot.subscriptions, theme),
    theme.fg("muted", formatSessionIdentity(snapshot.session))
  ];
}

/** One attention line: the blocked agent(s) by name, or (when nothing is
 * blocked) the single highest-attention agent's own state — never a
 * fabricated "all clear" when there simply is no agent yet. */
function compactAttentionLine(snapshot, theme) {
  const agents = snapshot.agents ?? [];
  const blocked = agents.filter((agent) => agent.state === "blocked");
  if (blocked.length === 1) return theme.fg("error", `✖ ${blocked[0].label ?? "Unknown role"} blocked`);
  if (blocked.length > 1) {
    return theme.fg("error", `✖ ${blocked.length} blocked: ${blocked.map((agent) => agent.label ?? "Unknown role").join(", ")}`);
  }
  const [first] = sortedHerdAgents(agents);
  if (!first) return theme.fg("muted", "Run /project analyze to build this project's team.");
  const glyph = HERD_STATE_GLYPH[first.state] ?? HERD_STATE_GLYPH.unknown;
  return theme.fg(HERD_STATE_TONE[first.state] ?? "muted", `${glyph} ${first.label ?? "Unknown role"} ${first.state}`);
}

/** One compact usage line — the first ready segment, or the honest
 * checking/unknown state word; never a fabricated percentage. */
function compactUsageLine(subscriptions, theme) {
  if (subscriptions?.state === "ready") {
    const [firstSegment] = subscriptions.segments ?? [];
    return theme.fg("text", firstSegment ? `USAGE ${firstSegment}` : "USAGE");
  }
  return theme.fg("muted", `USAGE ${subscriptions?.state ?? "checking"}`);
}

/** A short (≤6 line) attention + usage summary for narrow terminals (H8:
 * below SHELL_SIDEBAR_MIN_COLUMNS the sidebar is hidden entirely) — one
 * attention line, one usage line, and the shared session-identity line,
 * so both signals the sidebar/strip carried stay readable at any width. */
export function renderCompactShellSummaryLines(snapshot, theme) {
  return [
    compactAttentionLine(snapshot, theme),
    compactUsageLine(snapshot.subscriptions, theme),
    theme.fg("muted", formatSessionIdentity(snapshot.session))
  ];
}

/** Component factory for the fullscreen sidebar slot (`ctx.ui.setSidebar`)
 * — mirrors createKairoWorkspaceWidget's pattern so it is exercised the
 * same way in tests (`content(tui, theme).render(width)`), even though
 * the sidebar's own content never depends on `width` (it stays fixed at
 * SHELL_SIDEBAR_COLUMNS regardless of what the fork passes in). */
export function createShellSidebarWidget(snapshot) {
  return (_tui, theme) => ({
    render() {
      return renderShellSidebarLines(snapshot, theme);
    }
  });
}

/** Component factory for the fullscreen bottom strip slot
 * (`ctx.ui.setBottomStrip`). See createShellSidebarWidget's own doc. */
export function createShellBottomStripWidget(snapshot) {
  return (_tui, theme) => ({
    render() {
      return renderShellBottomStripLines(snapshot, theme);
    }
  });
}

/** Component factory for the narrow-terminal compact summary, shown in
 * the ordinary widget slot (`ctx.ui.setWidget`) once the sidebar is
 * hidden. See createShellSidebarWidget's own doc. */
export function createCompactShellSummaryWidget(snapshot) {
  return (_tui, theme) => ({
    render() {
      return renderCompactShellSummaryLines(snapshot, theme);
    }
  });
}

/**
 * One notice per provider and window, never one per role and never on every
 * refresh: blocked roles are grouped by the provider window that blocks them
 * (checkCandidate's structured `limit`), or by provider and warning when the
 * block is not a window limit (entitlement, Cursor pool). The caller keeps
 * the keys it already showed and notifies only new ones.
 * @param {{rows?: object[]}|undefined} team
 * @returns {{key: string, message: string}[]}
 */
export function availabilityNotices(team) {
  const groups = new Map();
  for (const row of team?.rows ?? []) {
    if (row.availability?.state !== "blocked") continue;
    const limit = row.availability.limit ?? null;
    const warning = row.availability.warning ?? "Blocked.";
    const key = limit ? `${row.via}|window:${limit.window ?? "usage"}` : `${row.via}|${warning}`;
    const group = groups.get(key) ?? { key, warning, windowLimited: Boolean(limit), roles: [] };
    group.roles.push(`${row.role} (${row.model})`);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ key, warning, windowLimited, roles }) => ({
    key,
    message: windowLimited
      ? `${warning} — affects ${roles.join(", ")}. Kairo will try to recover the team automatically.`
      : `${warning} — affects ${roles.join(", ")}. Next: run kairo --legacy-cockpit, then /project analyze.`
  }));
}
