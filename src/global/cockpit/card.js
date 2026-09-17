import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Rounded-frame card rendering, ported from gentle-pi's lib/shell-card.ts
// (MIT) and simplified for the cockpit's plain-JS, single-frame use case:
// one open card per screen, each line able to carry its own tone so a row's
// left rail reflects its own state (e.g. a failed run's rail reads red).

export const CARD_TONE = {
  INFO: "info",
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "error"
};

const FRAME_ROLE = "border";
const FRAME_COLUMNS = 4;

function rule(length) {
  return "─".repeat(Math.max(0, length));
}

/**
 * @param {string} title
 * @param {string} tone - a CARD_TONE value
 * @param {{fg(role:string,text:string):string}} theme
 * @param {number} width
 * @returns {string}
 */
export function cardTop(title, tone, theme, width) {
  const targetWidth = Math.max(0, Math.floor(width));
  if (targetWidth === 0) return "";
  if (targetWidth < 5) {
    const left = theme.fg(tone, "╭");
    if (targetWidth === 1) return left;
    return left + theme.fg(FRAME_ROLE, `${rule(targetWidth - 2)}╮`);
  }
  const head = `✿ ${title}`;
  const headWidth = visibleWidth(head);
  const maxTitleWidth = Math.max(0, targetWidth - 5);
  const clippedHead = headWidth <= maxTitleWidth ? head : truncateToWidth(head, maxTitleWidth, "");
  const clippedWidth = headWidth <= maxTitleWidth ? headWidth : visibleWidth(clippedHead);
  const fill = rule(Math.max(0, targetWidth - clippedWidth - 5));
  return (
    theme.fg(tone, "╭")
    + theme.fg(FRAME_ROLE, "─ ")
    + theme.fg(tone, clippedHead)
    + theme.fg(FRAME_ROLE, ` ${fill}╮`)
  );
}

/**
 * @param {string} text - may already carry ANSI styling
 * @param {string} tone - colors this line's left rail
 * @param {{fg(role:string,text:string):string}} theme
 * @param {number} width
 * @returns {string}
 */
export function cardLine(text, tone, theme, width) {
  const targetWidth = Math.max(0, Math.floor(width));
  if (targetWidth === 0) return "";
  const left = theme.fg(tone, "│");
  if (targetWidth === 1) return left;
  if (targetWidth === 2) return left + theme.fg(FRAME_ROLE, "│");
  if (targetWidth === 3) return `${left} ${theme.fg(FRAME_ROLE, "│")}`;

  const innerWidth = targetWidth - FRAME_COLUMNS;
  const clipped = innerWidth === 0 ? "" : truncateToWidth(text, innerWidth, "…");
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
  return `${left} ${clipped}${padding} ${theme.fg(FRAME_ROLE, "│")}`;
}

/**
 * @param {string} tone
 * @param {{fg(role:string,text:string):string}} theme
 * @param {number} width
 * @returns {string}
 */
export function cardBottom(tone, theme, width) {
  const targetWidth = Math.max(0, Math.floor(width));
  if (targetWidth === 0) return "";
  const left = theme.fg(tone, "╰");
  if (targetWidth === 1) return left;
  return left + theme.fg(FRAME_ROLE, `${rule(targetWidth - 2)}╯`);
}

/** @param {number} width */
export function cardInnerWidth(width) {
  return Math.max(1, width - FRAME_COLUMNS);
}

/**
 * A complete rounded-frame panel — top rule, one framed line per content
 * line (padded to `targetLineCount` when given), bottom rule. The one real
 * bordered-panel primitive every cockpit surface (the dashboard's cards,
 * the /project overlay) should build on, rather than each screen inventing
 * its own frame or going borderless.
 * @param {string} title
 * @param {string} tone - a CARD_TONE value
 * @param {{fg(role:string,text:string):string}} theme
 * @param {number} width
 * @param {string[]} contentLines - lines already sized to cardInnerWidth(width)
 * @param {number} [targetLineCount]
 * @returns {string[]}
 */
export function renderPanel(title, tone, theme, width, contentLines, targetLineCount = contentLines.length) {
  const padded = Array.from({ length: targetLineCount }, (_, i) => contentLines[i] ?? "");
  const lines = [cardTop(title, tone, theme, width)];
  for (const line of padded) lines.push(cardLine(line, tone, theme, width));
  lines.push(cardBottom(tone, theme, width));
  return lines;
}
