import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CARD_TONE, cardInnerWidth, renderPanel } from "../cockpit/card.js";

// The Pi widget for the Kairo workspace — two bordered panels (USAGE,
// TEAM), side by side when the terminal is wide enough, stacked otherwise.
// Rendered as a Pi component factory (see createKairoWorkspaceWidget below)
// instead of a plain string array so it is never capped at Pi's
// MAX_WIDGET_LINES=10 (see the P01.1 "Why" in odd/tasks/kairo-pi-parity.md
// — that cap is exactly what truncated the Reviewer row in P01).
//
// The pure render function (renderKairoWorkspaceWidget) never reads a TTY
// or Pi's real Theme class — it only calls theme.fg(role, text) and
// theme.bold(text), so it is fully testable with a fake theme. `role` must
// stay inside Pi's real ThemeColor set (accent, border, success, error,
// warning, muted, text, ...) — Kairo's OWN cockpit theme additionally
// defines "info"/"selection", which Pi's Theme class does not, so this
// module never uses those two roles.

const GAUGE_CELLS = 10;
const SIDE_BY_SIDE_MIN_WIDTH = 70;
const NAME_COLUMN_WIDTH = 7;
const LABEL_COLUMN_WIDTH = 2;
const TEAM_COLUMN_GAP = "  ";
const FOOTER_COMMAND_SEPARATOR = " · ";

/**
 * The USAGE/TEAM panel widths for a given total render width — side by
 * side (with a 1-column gap) at or above `SIDE_BY_SIDE_MIN_WIDTH`, both
 * equal to the full width when stacked. Exported so tests can locate the
 * TEAM panel's own substring inside a combined side-by-side line without
 * re-deriving this arithmetic (see test/workspace-widget.test.js).
 * @param {number} width
 * @returns {{leftWidth: number, rightWidth: number, sideBySide: boolean}}
 */
export function computeSideBySideWidths(width) {
  const targetWidth = Math.max(1, Math.floor(width));
  if (targetWidth < SIDE_BY_SIDE_MIN_WIDTH) {
    return { leftWidth: targetWidth, rightWidth: targetWidth, sideBySide: false };
  }
  const gap = 1;
  const leftWidth = Math.floor((targetWidth - gap) / 2);
  const rightWidth = targetWidth - gap - leftWidth;
  return { leftWidth, rightWidth, sideBySide: true };
}

function usageBarTone(level) {
  if (level === "limited") return "error";
  if (level === "low") return "warning";
  return "success";
}

/** A themed `remainingPercent` bar — filled cells read the window's own
 * level (never a separately re-derived threshold; see usage-summary.js's
 * `buildUsageModel`, the single source of truth for `level`). */
function paintUsageBar(window, theme, cells = GAUGE_CELLS) {
  const clamped = Math.max(0, Math.min(100, window.remainingPercent ?? 0));
  const filled = Math.round((clamped / 100) * cells);
  return theme.fg(usageBarTone(window.level), "█".repeat(filled)) + theme.fg("border", "░".repeat(cells - filled));
}

/** One provider's usage lines: `Codex   5h ████░░░░ 80%` then, for any
 * further window, an indented continuation (`         W ████░░░░ 83%`).
 * A provider with no measured window yet (`windows` empty) prints its
 * real fallback status instead of a fabricated bar. */
function usageProviderLines(provider, theme) {
  const name = provider.name.padEnd(NAME_COLUMN_WIDTH);
  if (!provider.windows.length) {
    return [`${name}${theme.fg("muted", provider.fallbackStatus)}`];
  }
  return provider.windows.map((window, index) => {
    const namePart = index === 0 ? name : " ".repeat(NAME_COLUMN_WIDTH);
    const label = (window.label ?? "").padEnd(LABEL_COLUMN_WIDTH);
    return `${namePart}${label} ${paintUsageBar(window, theme)} ${window.remainingPercent}%`;
  });
}

/** The USAGE panel body — real bars once live data is ready, or one dim
 * honest state line (`usage checking`/`usage unknown`) before/on failure.
 * Never fabricates a bar for state that hasn't resolved yet. */
function usagePanelBody(subscriptions, theme) {
  if (!subscriptions || subscriptions.state !== "ready") {
    return [theme.fg("muted", `usage ${subscriptions?.state ?? "checking"}`)];
  }
  return (subscriptions.usageModel ?? []).flatMap((provider) => usageProviderLines(provider, theme));
}

function usagePanelFooter(session) {
  const idPart = session?.state === "bound" ? session.id.slice(0, 8) : "none";
  return `session: ${idPart} · ${session?.mode ?? "ask"}`;
}

/** Pads `text` to exactly `width` visible columns — truncating with
 * `truncateToWidth` first when it's already wider (only ever asked of the
 * model column, never the role column; see `teamColumnWidths`' own doc). */
function padColumn(text, width) {
  const clipped = visibleWidth(text) > width ? truncateToWidth(text, width, "") : text;
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/**
 * The role/model column widths for one TEAM panel render — each padded to
 * the longest VISIBLE width in that column across every real row, so
 * every row's model (and via) column starts at the same visible position
 * (the reported defect: a literal fixed `"  "` gap puts the model column
 * at a different position per row, since roles like "Project Analyst"
 * and "Builder" have very different lengths).
 *
 * The role column is never truncated (real role names are short and
 * meaningful; truncating them would be actively misleading). When
 * `innerWidth` can't fit the role column plus the desired model column
 * plus the widest `via`, the model column alone shrinks to what's left —
 * `teamRowLine` then truncates an individual model's text into that
 * narrower column with `truncateToWidth`, never the role.
 * @param {object[]} rows
 * @param {number} innerWidth
 */
function teamColumnWidths(rows, innerWidth) {
  const roleWidth = rows.reduce((max, row) => Math.max(max, visibleWidth(row.role ?? "")), 0);
  const desiredModelWidth = rows.reduce((max, row) => Math.max(max, visibleWidth(row.model ?? "")), 0);
  const viaWidth = rows.reduce((max, row) => Math.max(max, visibleWidth(row.via ?? "")), 0);
  const gapWidth = visibleWidth(TEAM_COLUMN_GAP);
  const available = innerWidth - roleWidth - gapWidth * 2 - viaWidth;
  const modelWidth = Math.max(0, Math.min(desiredModelWidth, Math.max(0, available)));
  return { roleWidth, modelWidth };
}

/** One team row, columns aligned via `teamColumnWidths`. A blocked role
 * gets the error tone plus a trailing "BLOCKED" word — the ONLY per-row
 * status marker this panel ever prints (see the P01.1 "Why": the user
 * explicitly asked for no `available` noise, only exceptions). */
function teamRowLine(row, columns, theme) {
  const rolePart = padColumn(row.role ?? "", columns.roleWidth);
  const modelPart = padColumn(row.model ?? "", columns.modelWidth);
  const base = `${rolePart}${TEAM_COLUMN_GAP}${modelPart}${TEAM_COLUMN_GAP}${row.via ?? ""}`;
  if (row.availability?.state === "blocked") return theme.fg("error", `${base}${TEAM_COLUMN_GAP}BLOCKED`);
  return theme.fg("text", base);
}

function teamPanelBody(team, theme, innerWidth) {
  const rows = team?.rows ?? [];
  if (!rows.length) return [theme.fg("muted", "Run /project analyze to build this project's team.")];
  const columns = teamColumnWidths(rows, innerWidth);
  return rows.map((row) => teamRowLine(row, columns, theme));
}

function anyRowChecking(team) {
  return (team?.rows ?? []).some((row) => row.availability?.state === "checking");
}

function anyRowBlocked(team) {
  return (team?.rows ?? []).some((row) => row.availability?.state === "blocked");
}

/** The TEAM panel title — dims to "checking…" while any row's live
 * availability is still resolving, instead of a per-row marker. */
function teamPanelTitle(team) {
  if (anyRowChecking(team)) return "TEAM · checking…";
  return `TEAM · ${team?.state ?? "not_analyzed"}`;
}

function teamPanelTone(team) {
  if (anyRowChecking(team)) return "muted";
  if (anyRowBlocked(team)) return "warning";
  return "accent";
}

const TEAM_FOOTER_COMMANDS = ["/kairo-team", "/kairo-route", "/kairo-usage", "/kairo-memory"];

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

function teamPanelFooter(panelWidth) {
  return fitFooterCommands(TEAM_FOOTER_COMMANDS, footerLabelBudget(panelWidth));
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
  const { leftWidth, rightWidth, sideBySide } = computeSideBySideWidths(width);
  const usageBody = usagePanelBody(snapshot.subscriptions, theme);
  const teamBody = teamPanelBody(snapshot.team, theme, cardInnerWidth(rightWidth));
  const usageFooter = usagePanelFooter(snapshot.session);
  const teamFooter = teamPanelFooter(rightWidth);
  const teamTitle = teamPanelTitle(snapshot.team);
  const teamTone = teamPanelTone(snapshot.team);

  let panelLines;
  if (sideBySide) {
    const targetLineCount = Math.max(usageBody.length, teamBody.length);
    const left = renderPanel("USAGE", CARD_TONE.SUCCESS, theme, leftWidth, usageBody, targetLineCount, usageFooter);
    const right = renderPanel(teamTitle, teamTone, theme, rightWidth, teamBody, targetLineCount, teamFooter);
    panelLines = left.map((line, index) => `${line} ${right[index] ?? ""}`);
  } else {
    panelLines = [
      ...renderPanel("USAGE", CARD_TONE.SUCCESS, theme, leftWidth, usageBody, undefined, usageFooter),
      ...renderPanel(teamTitle, teamTone, theme, rightWidth, teamBody, undefined, teamFooter)
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

/**
 * One notification per blocked role, per refresh — the user-approved UX:
 * no per-row warning text in the panel (that would be noise for the
 * approved-and-expected-available common case), but a blocked role is a
 * real exception the user must see, with Kairo's own warning and a next
 * step, never invented here.
 * @param {{rows?: object[]}|undefined} team
 * @returns {{role: string, model: string, warning: string, message: string}[]}
 */
export function blockedRoleNotifications(team) {
  const rows = team?.rows ?? [];
  return rows
    .filter((row) => row.availability?.state === "blocked")
    .map((row) => {
      const warning = row.availability?.warning ?? "Blocked.";
      return {
        role: row.role,
        model: row.model,
        warning,
        message: `${row.role} (${row.model}) is blocked: ${warning} Next: run kairo --legacy-cockpit, then /project analyze.`
      };
    });
}
