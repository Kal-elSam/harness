import { Theme } from "@kal-elsam/kairo-pi-coding-agent";
import {
  agentRowHitboxes,
  renderCompactShellSummaryLines,
  renderShellBottomStripLines,
  renderShellSidebarLines,
} from "../workspace-widget.js";

// Visual-design prototype (session-scoped, env-gated, never a release):
// a Kairo skin over the CURRENT split/chat/responsive layout — no layout,
// host, or pin changes. Enabled only with KAIRO_PROTOTYPE_THEME=1, for
// TTY captures the user must approve before any product change.
//
// Session scope: the theme is applied as an in-memory Theme INSTANCE via
// ctx.ui.setTheme(instance) -> fork setThemeInstance (no settings write,
// no watcher, no persistence). A string name would persist to the fork's
// settings instead — never that. The PTY captures are the deliverable;
// this module is not product code until the verdict says so.

export const KAIRO_PROTOTYPE_THEME_NAME = "kairo-prototype";

// Sidebar band: neutral dark surface so the panel reads as one surface.
// Selection: teal-tinted band, distinct from the sidebar at a glance.
// Strip band: violet-tinted, distinct from both (attention / work /
// usage separable without reading labels). error/warning/toolErrorBg
// are dark's own — reserved for real problems, never repurposed.
export const SIDEBAR_BAND_BG = "toolPendingBg";
export const SELECTION_BG = "selectedBg";
export const STRIP_BAND_BG = "customMessageBg";

const SIDEBAR_COLUMNS = 28;

export const KAIRO_PROTOTYPE_FG = {
  accent: "#7fd4c1",
  border: "#4a5a6a",
  borderAccent: "#00d7ff",
  borderMuted: "#2e2e3a",
  success: "#b5bd68",
  error: "#cc6666",
  warning: "#ffff00",
  muted: "#a8a8a8",
  dim: "#666666",
  text: "#d4d4d4",
  thinkingText: "#808080",
  userMessageText: "#d4d4d4",
  customMessageText: "#d4d4d4",
  customMessageLabel: "#9575cd",
  toolTitle: "#d4d4d4",
  toolOutput: "#808080",
  mdHeading: "#f0c674",
  mdLink: "#81a2be",
  mdLinkUrl: "#666666",
  mdCode: "#7fd4c1",
  mdCodeBlock: "#b5bd68",
  mdCodeBlockBorder: "#808080",
  mdQuote: "#808080",
  mdQuoteBorder: "#808080",
  mdHr: "#808080",
  mdListBullet: "#7fd4c1",
  toolDiffAdded: "#b5bd68",
  toolDiffRemoved: "#cc6666",
  toolDiffContext: "#808080",
  syntaxComment: "#6a9955",
  syntaxKeyword: "#569cd6",
  syntaxFunction: "#dcdcaa",
  syntaxVariable: "#9cdcfe",
  syntaxString: "#ce9178",
  syntaxNumber: "#b5cea8",
  syntaxType: "#4ec9b0",
  syntaxOperator: "#d4d4d4",
  syntaxPunctuation: "#d4d4d4",
  thinkingOff: "#505050",
  thinkingMinimal: "#6e6e6e",
  thinkingLow: "#5f87af",
  thinkingMedium: "#81a2be",
  thinkingHigh: "#b294bb",
  thinkingXhigh: "#d183e8",
  bashMode: "#b5bd68",
};

export const KAIRO_PROTOTYPE_BG = {
  selectedBg: "#273e3c",
  searchMatchBg: "#273e3c",
  userMessageBg: "#2a2d3a",
  customMessageBg: "#2b2740",
  toolPendingBg: "#26262e",
  toolSuccessBg: "#263026",
  toolErrorBg: "#3c2828",
};

export function isPrototypeThemeEnabled(env = process.env) {
  return env?.KAIRO_PROTOTYPE_THEME === "1";
}

/** Build the in-memory prototype Theme. ThemeClass is injected so unit
 * tests never load the 8MB fork bundle; the extension passes the real
 * Theme. Mode follows the live theme (never guessed). */
export function buildKairoPrototypeTheme(ThemeClass, liveTheme) {
  const mode = liveTheme?.getColorMode?.() ?? "truecolor";
  return new ThemeClass(KAIRO_PROTOTYPE_FG, KAIRO_PROTOTYPE_BG, mode, {
    name: KAIRO_PROTOTYPE_THEME_NAME,
  });
}

export function buildPrototypeTheme() {
  return buildKairoPrototypeTheme(Theme, undefined);
}

const ANSI_PATTERN = /\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[a-zA-Z]/g;

export function stripAnsi(line) {
  return String(line).replace(ANSI_PATTERN, "");
}

export function visibleWidth(line) {
  return [...stripAnsi(line)].length;
}

function padTo(line, width) {
  const missing = width - visibleWidth(line);
  return missing > 0 ? `${line}${" ".repeat(missing)}` : line;
}

/** Skin pre-rendered sidebar lines: every row fills the 28-column band
 * (continuous surface + divisor), selected agent rows get the selection
 * band instead. Row geometry comes from agentRowHitboxes — the same
 * source clicks use — never reparsed text. Empty stays empty so narrow
 * terminals keep the chat width. `rows`: when given (live terminal
 * height), band-filled blank rows pad the content to EXACTLY that height
 * so the band runs full-height. Exact, never more: the fork's real
 * renderer clips over-tall screens to the LAST rows, so one extra row
 * would eat the header. Appended AFTER content, so hitboxes never shift. */
export function applyPrototypeSidebarSkin(lines, snapshot, theme, { routeUnavailable = false, selectedAgentId = null, rows = null } = {}) {
  if (!lines.length) return [];
  const selectedRows = new Set();
  if (selectedAgentId != null) {
    for (const box of agentRowHitboxes(snapshot, { routeUnavailable, selectedAgentId })) {
      if ((box.agentId ?? null) === selectedAgentId) {
        selectedRows.add(box.y);
        selectedRows.add(box.y + 1);
      }
    }
  }
  const skinned = lines.map((line, y) => {
    const band = selectedRows.has(y) ? SELECTION_BG : SIDEBAR_BAND_BG;
    return theme.bg(band, padTo(line, SIDEBAR_COLUMNS));
  });
  const target = Number.isInteger(rows) && rows > 0 ? rows : null;
  if (target != null) {
    const blank = theme.bg(SIDEBAR_BAND_BG, " ".repeat(SIDEBAR_COLUMNS));
    while (skinned.length < target) skinned.push(blank);
    return skinned.slice(0, target);
  }
  return skinned;
}

/** Skin pre-rendered strip lines: fill the live width on the strip band
 * (a visually separate usage bar carrying the same real data). */
export function applyPrototypeStripSkin(lines, theme, { width = 120 } = {}) {
  return lines.map((line) => theme.bg(STRIP_BAND_BG, padTo(line, Math.max(1, Math.floor(width)))));
}

// ctx.ui.setTheme(instance) is single-shot per Pi process; the WeakSet
// keeps a repaint storm from re-applying it on every render.
const themedContexts = new WeakSet();

export function applyPrototypeThemeOnce(ctx) {
  try {
    if (!ctx?.ui || typeof ctx.ui.setTheme !== "function") return null;
    if (themedContexts.has(ctx.ui)) return ctx.ui.theme ?? null;
    const theme = buildKairoPrototypeTheme(Theme, ctx.ui.theme);
    ctx.ui.setTheme(theme);
    themedContexts.add(ctx.ui);
    return theme;
  } catch {
    return null;
  }
}

/** Prototype slot factories: same snapshot facts and geometry as the
 * default factories, plus the band skin. Signature mirrors
 * workspace-widget's factories so renderShellSurface can swap them. */
export function createPrototypeSidebarWidget(snapshot, { getColumns, getRows = null, routeUnavailable = false, extraLines = [], selectedAgentId = null, onSelectAgent = null } = {}) {
  return (_tui, theme) => ({
    render() {
      const cols = getColumns?.() ?? 0;
      if (cols < 90) return [];
      const options = { routeUnavailable, extraLines, selectedAgentId };
      const lines = renderShellSidebarLines(snapshot, theme, options);
      return applyPrototypeSidebarSkin(lines, snapshot, theme, { ...options, rows: getRows?.() ?? null });
    },
    handleMouse(event) {
      if (!onSelectAgent) return undefined;
      if (event?.button !== "left" || event?.type !== "click") return undefined;
      if ((getColumns?.() ?? 0) < 90) return undefined;
      const hit = agentRowHitboxes(snapshot, { routeUnavailable, selectedAgentId }).find((box) => box.y === event.y);
      if (!hit) return undefined;
      onSelectAgent(hit.agentId);
      return { handled: true };
    },
  });
}

export function createPrototypeStripWidget(snapshot, { getColumns, extraLines = [] } = {}) {
  return (_tui, theme) => ({
    render(width) {
      if ((getColumns?.() ?? 0) < 90) return [];
      const lines = renderShellBottomStripLines(snapshot, theme, { extraLines, width });
      return applyPrototypeStripSkin(lines, theme, { width: width ?? getColumns?.() ?? 120 });
    },
  });
}

export function createPrototypeCompactWidget(snapshot, { getColumns, routeUnavailable = false, extraLines = [] } = {}) {
  return (_tui, theme) => ({
    render(width) {
      if ((getColumns?.() ?? 0) >= 90) return [];
      const w = width ?? getColumns?.() ?? 89;
      const lines = renderCompactShellSummaryLines(snapshot, theme, { routeUnavailable, extraLines, width: w });
      return applyPrototypeStripSkin(lines, theme, { width: w });
    },
  });
}
