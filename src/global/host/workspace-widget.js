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

// The Pi status bar (see extension/index.js's workspaceStatus, painted via
// ctx.ui.setStatus) already shows the bound session's identity in
// fullscreen. The sidebar header therefore names only the project —
// session identity appears in exactly one place, never in the sidebar
// AND the strip AND the status bar.

/** The two short lines that replace the old "unavailable-routes" detail
 * widget once the shell owns the layout — that widget must never render
 * next to (or instead of) the sidebar/strip once slots are active; its two
 * essential facts (no route, run /project analyze) fold in here instead.
 * Never paired with `noTeamHintLine`'s own "Run /project analyze..." text
 * in the same surface — see renderShellSidebarLines/
 * renderCompactShellSummaryLines, which each show the instruction exactly
 * once (native review finding, 2026-09-25 PTY re-check). */
function routeUnavailableLines(theme, truncate = (line) => line) {
  return [
    theme.fg("warning", truncate("ROUTES unavailable")),
    theme.fg("muted", truncate("Run /project analyze."))
  ];
}

/** The no-team hint shown when there is no agent roster yet. When a route
 * notice is already on the same surface (`routeUnavailableLines` above
 * already told the user to run /project analyze), this shortens to a
 * plain fact with no repeated instruction — one "Run /project analyze"
 * per surface, never two. */
function noTeamHintLine(theme, truncate, routeUnavailable) {
  return theme.fg("muted", truncate(routeUnavailable ? "No agents yet." : "Run /project analyze to build this project's team."));
}

/** Extra transient notices (e.g. a team-recovery outcome from session_start
 * phase 2 — see extension/index.js's recoveryNotice) appended, muted, and
 * truncated the same way as everything else on the surface. Dropped
 * silently in fullscreen before this fix (native review R3 WARNING,
 * 2026-09-25) — now shown on whichever shell surface is currently active. */
function appendExtraLines(theme, truncate, extraLines) {
  return extraLines.map((line) => theme.fg("muted", truncate(line)));
}

/** Shorten a proven blocked cause for a 28-column row — strip the
 * shared "Unavailable — " prefix every resolveAssignmentAvailability
 * warning carries, since the ✖ glyph already says unavailable. The full
 * warning stays one level down in `/kairo-team` (see extension/index.js's
 * teamDetailLines), never truncated. */
function shortBlockedCause(stateReason) {
  return String(stateReason ?? "").replace(/^Unavailable\s+[—–-]\s*/, "").trim();
}

/** One sidebar agent row — blocked rows with a captured cause name it
 * (e.g. "Cursor Models quota exhausted") instead of a generic word;
 * blocked rows with no captured cause say Unavailable without inventing
 * one (short on purpose: the 28-column budget truncates longer tails,
 * and the next step lives in `/kairo-team`, never here); every other row
 * matches the HERD panel. Always within the sidebar's
 * SHELL_SIDEBAR_COLUMNS budget. */
function shellAgentLine(agent, theme) {
  if (agent.state === "blocked") {
    const cause = agent.stateReason ? shortBlockedCause(agent.stateReason) : null;
    const tail = cause || "Unavailable";
    return theme.fg("error", truncateToWidth(`✖ ${agent.label ?? "Unknown role"} · ${tail}`, SHELL_SIDEBAR_COLUMNS, "…"));
  }
  return herdAgentLine(agent, theme, SHELL_SIDEBAR_COLUMNS);
}

/** Row hitboxes for the sidebar's agent list — one `{agentId, y}` per
 * agent row in render order, so a click's y-coordinate resolves to the
 * agent without reparsing text. `routeUnavailable` shifts every row down
 * by its two notice lines; `extraLines` append AFTER the agent rows, so
 * they never shift a hitbox. Recomputed on every render (like the width
 * check), so a resize or refresh can never leave stale boxes behind. */
export function agentRowHitboxes(snapshot, { routeUnavailable = false, selectedAgentId = null } = {}) {
  const identity = { fg: (_role, text) => text };
  let y = 1 + (routeUnavailable ? 2 : 0) + 1;
  const boxes = [];
  for (const agent of sortedHerdAgents(snapshot.agents ?? [])) {
    const id = agent.id ?? agent.label;
    boxes.push({ agentId: id, y });
    y += 1;
    // An open detail block pushes every row below it down — hitboxes walk
    // the same insertion renderShellSidebarLines does, so a click never
    // lands on the wrong agent while a detail is open. Line count never
    // depends on theming, so the identity measure below matches.
    if (selectedAgentId != null && id === selectedAgentId) y += agentDetailLines(agent, identity).length;
  }
  return boxes;
}

/** Wrap one detail line at word boundaries to the sidebar budget —
 * detail (model, full cause, next step) must read whole, never truncated
 * with an ellipsis like the glanceable rows above it. */
function wrapDetailLine(line, width) {
  const words = String(line).split(/\s+/).filter(Boolean);
  const out = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (visibleWidth(candidate) > width && current) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [""];
}

/** The open-agent detail block — model, full cause (or the honest
 * Unavailable + next step when no cause was captured). Same facts
 * `/kairo-team` shows for the row, so mouse and keyboard reach the same
 * detail; clicking never opens a per-agent conversation or terminal. */
function agentDetailLines(agent, theme) {
  const cause = agent.stateReason ?? null;
  const lines = [`  ${agent.model ?? "no eligible option"}`];
  if (cause) {
    lines.push(...wrapDetailLine(`  ${cause}`, SHELL_SIDEBAR_COLUMNS));
  } else {
    lines.push(...wrapDetailLine("  Unavailable", SHELL_SIDEBAR_COLUMNS));
    lines.push(...wrapDetailLine("  Next step: run /project analyze", SHELL_SIDEBAR_COLUMNS));
  }
  return lines.map((line) => theme.fg("muted", line));
}

/** The fullscreen sidebar's lines — project header, then AGENTS
 * (blocked-first, fail-closed unknown), reusing the HERD panel's
 * glyph/order rules (see herdAgentLine/sortedHerdAgents above) with two
 * S2 differences: the header names the current project (Kairo has no
 * multiproject SPACES nav — the old SPACES section is gone) and blocked
 * rows name their proven cause (see shellAgentLine). Session identity is
 * never repeated here (status bar owns it). EVERY line is truncated to
 * the sidebar's real SHELL_SIDEBAR_COLUMNS (28) budget with an
 * ellipsis — never a silent cut, and never the bordered-panel `cardInnerWidth` deduction (24), which
 * doesn't apply here since the sidebar draws no border (native review R2
 * WARNING, 2026-09-25: the doc said 28 but truncation used 24).
 * @param {object} snapshot
 * @param {{fg(role:string,text:string):string, bold(text:string):string}} theme
 * @param {{routeUnavailable?: boolean, extraLines?: string[]}} [options] -
 *   `routeUnavailable`: true when no automatic Pi route exists (see
 *   extension/index.js's routeState) — folds the same notice the old
 *   "unavailable-routes" widget carried into the sidebar instead of a
 *   separate, duplicate widget. `extraLines`: transient notices (see
 *   appendExtraLines's own doc).
 */
export function renderShellSidebarLines(snapshot, theme, { routeUnavailable = false, extraLines = [], selectedAgentId = null } = {}) {
  const truncate = (line) => truncateToWidth(line, SHELL_SIDEBAR_COLUMNS, "…");
  const projectName = snapshot.project?.label ?? snapshot.project?.root ?? "unknown";
  const agents = sortedHerdAgents(snapshot.agents ?? []);
  const agentLines = [];
  for (const agent of agents) {
    agentLines.push(shellAgentLine(agent, theme));
    const id = agent.id ?? agent.label;
    if (selectedAgentId != null && id === selectedAgentId) agentLines.push(...agentDetailLines(agent, theme));
  }
  if (!agents.length) agentLines.push(noTeamHintLine(theme, truncate, routeUnavailable));
  return [
    theme.bold(truncate(`${HERD_PROJECT_GLYPH} ${projectName}`)),
    ...(routeUnavailable ? routeUnavailableLines(theme, truncate) : []),
    theme.bold(truncate("AGENTS")),
    ...agentLines,
    ...appendExtraLines(theme, truncate, extraLines)
  ];
}

/** The fullscreen bottom strip's lines — the same USAGE gauges as the
 * overview's USAGE panel. Session identity is never repeated here (the
 * status bar owns it — see the sidebar-header note above); the strip only
 * ever shows real content
 * at SHELL_SIDEBAR_MIN_COLUMNS or more (its own createShellBottomStripWidget
 * factory decides that live — see below), so USAGE appears exactly once
 * across the whole fullscreen surface — never also folded into the compact
 * summary at the same time.
 * @param {object} snapshot
 * @param {{fg(role:string,text:string):string, bold(text:string):string}} theme
 * @param {{extraLines?: string[]}} [options] - see appendExtraLines's doc.
 */
export function renderShellBottomStripLines(snapshot, theme, { extraLines = [] } = {}) {
  const truncate = (line) => line; // the strip spans the chat column width, not a fixed 28 — no fixed truncation budget here.
  return [
    theme.bold("USAGE"),
    ...usagePanelBody(snapshot.subscriptions, theme),
    ...appendExtraLines(theme, truncate, extraLines)
  ];
}

/** One attention line: the blocked agent(s) by name, or (when nothing is
 * blocked) the single highest-attention agent's own state — never a
 * fabricated "all clear" when there simply is no agent yet. When
 * `routeUnavailable` is true, the "no team" case is suppressed here — the
 * caller's own route notice already carries the "Run /project analyze"
 * instruction, so this returns `null` rather than repeating it (native
 * review + parent PTY finding, 2026-09-25: the instruction appeared twice,
 * once under ROUTES and once under AGENTS/attention). */
function compactAttentionLine(snapshot, theme, routeUnavailable) {
  const agents = snapshot.agents ?? [];
  const blocked = agents.filter((agent) => agent.state === "blocked");
  if (blocked.length === 1) {
    const [only] = blocked;
    const cause = only.stateReason ? shortBlockedCause(only.stateReason) : null;
    return theme.fg("error", `✖ ${only.label ?? "Unknown role"} · ${cause || "Unavailable"}`);
  }
  if (blocked.length > 1) {
    return theme.fg("error", `✖ ${blocked.length} unavailable: ${blocked.map((agent) => agent.label ?? "Unknown role").join(", ")}`);
  }
  const [first] = sortedHerdAgents(agents);
  if (!first) return routeUnavailable ? null : theme.fg("muted", "Run /project analyze to build this project's team.");
  const glyph = HERD_STATE_GLYPH[first.state] ?? HERD_STATE_GLYPH.unknown;
  return theme.fg(HERD_STATE_TONE[first.state] ?? "muted", `${glyph} ${first.label ?? "Unknown role"} ${first.state}`);
}

/** Every ready usage segment that fits `maxWidth`, joined the same way the
 * HERD footer fits `/kairo-*` commands (see fitFooterCommands) — whole
 * segments only, never truncated mid-name, dropping from the first one
 * that would not fit. Returns `{ text, dropped }` so the caller can decide
 * whether an ellipsis is owed. */
function fitUsageSegments(segments, maxWidth) {
  let result = "";
  for (const segment of segments) {
    const candidate = result ? `${result} │ ${segment}` : segment;
    if (visibleWidth(candidate) > maxWidth) return { text: result, dropped: true };
    result = candidate;
  }
  return { text: result, dropped: false };
}

/** One compact usage line — every ready segment that fits `width` (never
 * just the first — native review + parent PTY finding, 2026-09-25: the
 * 60-column line showed only Codex even though Claude also fit), ending in
 * an ellipsis when one had to be dropped; or the honest checking/unknown
 * state word when there is no ready data yet — never a fabricated
 * percentage. */
function compactUsageLine(subscriptions, theme, width) {
  if (subscriptions?.state === "ready") {
    const segments = subscriptions.segments ?? [];
    if (!segments.length) return theme.fg("text", "USAGE");
    const prefix = "USAGE ";
    // Reserve one column for the trailing "…" up front, so a dropped
    // segment never pushes the final line over `width`.
    const { text, dropped } = fitUsageSegments(segments, Math.max(0, width - visibleWidth(prefix) - 1));
    return theme.fg("text", `${prefix}${text}${dropped ? "…" : ""}`);
  }
  return theme.fg("muted", `USAGE ${subscriptions?.state ?? "checking"}`);
}

// The narrow-terminal budget renderCompactShellSummaryLines assumes when no
// live width is given (e.g. a direct unit-test call, or a caller that
// hasn't wired getColumns/width through yet) — SHELL_SIDEBAR_MIN_COLUMNS-1,
// the widest column count still classified "narrow".
const DEFAULT_COMPACT_WIDTH = SHELL_SIDEBAR_MIN_COLUMNS - 1;

/** A short (≤6 line) attention + usage summary for narrow terminals (H8:
 * below SHELL_SIDEBAR_MIN_COLUMNS the sidebar AND the bottom strip both
 * render empty — the chat keeps the width) — one attention line (omitted
 * entirely when there is nothing to say and a route notice already covers
 * it, see compactAttentionLine's own doc), one usage line, any transient
 * extraLines, and (when routing has no automatic team) the same short
 * route notice the sidebar folds in at wider columns. Never the shared
 * session-identity line (status bar owns it) and never
 * the old "unavailable-routes" widget's full text (its own KAIRO ROUTES/
 * KAIRO TEAM headings) — only its two essential facts.
 * @param {object} snapshot
 * @param {{fg(role:string,text:string):string, bold(text:string):string}} theme
 * @param {{routeUnavailable?: boolean, extraLines?: string[], width?: number}} [options] -
 *   `width`: the real live column count, used to fit as many USAGE
 *   providers as possible (see compactUsageLine/fitUsageSegments).
 */
export function renderCompactShellSummaryLines(snapshot, theme, { routeUnavailable = false, extraLines = [], width = DEFAULT_COMPACT_WIDTH } = {}) {
  const attention = compactAttentionLine(snapshot, theme, routeUnavailable);
  return [
    ...(attention ? [attention] : []),
    compactUsageLine(snapshot.subscriptions, theme, width),
    ...(routeUnavailable ? routeUnavailableLines(theme) : []),
    ...appendExtraLines(theme, (line) => line, extraLines)
  ];
}

/**
 * True once `columns` clears the H8 sidebar threshold — the ONE live
 * check every shell slot component below re-runs on every `render()` call
 * (never a value captured once outside render, per the native review's R4
 * finding, 2026-09-25: the sidebar-or-compact choice used to be decided
 * once per session_start/command refresh from a `getColumns()` snapshot
 * taken at dispatch time, so a live terminal resize with no following
 * refresh left the wrong slot painted). `getColumns` is read fresh inside
 * each factory's `render()` below, not memoized anywhere, so crossing the
 * threshold reflows on the very next repaint — no extension-side refresh
 * needed. Known tradeoff: the fork's HStack sidebar column has a FIXED
 * 28-column basis once `ctx.ui.setSidebar` is called at all (see
 * shell-viewport.ts's `SHELL_SIDEBAR_BASIS`) — there is no live API to
 * shrink that reserved column itself from inside render(), only to make
 * its CONTENT empty, which is what returning `[]` below does. The sidebar
 * is therefore installed once (whenever the shell is active) and stays
 * installed; only its rendered CONTENT toggles with the live width.
 */
function isWideEnoughForSidebar(getColumns) {
  return (getColumns?.() ?? 0) >= SHELL_SIDEBAR_MIN_COLUMNS;
}

/** Component factory for the fullscreen sidebar slot (`ctx.ui.setSidebar`)
 * — mirrors createKairoWorkspaceWidget's pattern so it is exercised the
 * same way in tests (`content(tui, theme).render(width)`). Renders real
 * content only while `getColumns()` (read live, see isWideEnoughForSidebar)
 * is at or above SHELL_SIDEBAR_MIN_COLUMNS; empty otherwise — see
 * isWideEnoughForSidebar's own doc for why this can't also shrink the
 * column itself.
 * `onSelectAgent` (optional) turns agent rows into click targets: a left
 * click resolves through agentRowHitboxes — recomputed live on
 * every event, so resize/shift can never desync the boxes — and reports
 * the agent id. The fork forwards mouse to slot components that define
 * `handleMouse` (see tui-alt-screen's dispatchMouseToLayout); components
 * without it stay inert. Clicking only opens the detail block (see
 * agentDetailLines) — never a per-agent conversation or terminal — and
 * `/kairo-team` offers the same detail by keyboard.
 * @param {object} snapshot
 * @param {{getColumns?: () => number, routeUnavailable?: boolean, extraLines?: string[], selectedAgentId?: string|null, onSelectAgent?: (agentId: string) => void}} [options]
 */
export function createShellSidebarWidget(snapshot, { getColumns, routeUnavailable = false, extraLines = [], selectedAgentId = null, onSelectAgent = null } = {}) {
  const options = { routeUnavailable, extraLines, selectedAgentId };
  return (_tui, theme) => ({
    render() {
      if (!isWideEnoughForSidebar(getColumns)) return [];
      return renderShellSidebarLines(snapshot, theme, options);
    },
    handleMouse(event) {
      if (!onSelectAgent) return undefined;
      // Click only: Pi sends press AND click for one gesture, and the
      // selection toggles — answering both would open and close the
      // detail with a single click (real-TTM defect, 2026-09-26).
      if (event?.button !== "left" || event?.type !== "click") return undefined;
      if (!isWideEnoughForSidebar(getColumns)) return undefined;
      const hit = agentRowHitboxes(snapshot, { routeUnavailable, selectedAgentId }).find((box) => box.y === event.y);
      if (!hit) return undefined;
      onSelectAgent(hit.agentId);
      return { handled: true };
    }
  });
}

/** Component factory for the fullscreen bottom strip slot
 * (`ctx.ui.setBottomStrip`) — real content only at SHELL_SIDEBAR_MIN_COLUMNS
 * or more (read live, see isWideEnoughForSidebar), empty otherwise (its
 * "auto" VStack basis collapses an empty strip to zero height, unlike the
 * sidebar's fixed-basis column). See createShellSidebarWidget's own doc.
 * @param {object} snapshot
 * @param {{getColumns?: () => number, extraLines?: string[]}} [options]
 */
export function createShellBottomStripWidget(snapshot, { getColumns, extraLines = [] } = {}) {
  return (_tui, theme) => ({
    render() {
      if (!isWideEnoughForSidebar(getColumns)) return [];
      return renderShellBottomStripLines(snapshot, theme, { extraLines });
    }
  });
}

/** Component factory for the narrow-terminal compact summary, shown in the
 * ordinary widget slot (`ctx.ui.setWidget`). Real content only BELOW
 * SHELL_SIDEBAR_MIN_COLUMNS (read live, see isWideEnoughForSidebar) —
 * empty once the sidebar/strip are wide enough to carry everything, so the
 * same fact never renders twice. `width` (the actual `render(width)`
 * argument the fork passes for this slot, unlike the fixed-basis sidebar —
 * see createShellSidebarWidget's own doc) sizes the USAGE line's fit.
 * @param {object} snapshot
 * @param {{getColumns?: () => number, routeUnavailable?: boolean, extraLines?: string[]}} [options]
 */
export function createCompactShellSummaryWidget(snapshot, { getColumns, routeUnavailable = false, extraLines = [] } = {}) {
  return (_tui, theme) => ({
    render(width) {
      if (isWideEnoughForSidebar(getColumns)) return [];
      return renderCompactShellSummaryLines(snapshot, theme, { routeUnavailable, extraLines, width });
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
