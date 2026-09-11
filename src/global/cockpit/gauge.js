// Small progress-bar primitive ported from gentle-pi's lib/shell-gauge.ts
// (MIT) — block-character gauges colored by how much of a budget is used,
// so the AGENTS panel reads like a real usage meter instead of bare text.

const GAUGE_CELLS = 8;
const GAUGE_FILLED = "▰";
const GAUGE_EMPTY = "▱";
const GAUGE_EMPTY_ROLE = "border";
const WARNING_THRESHOLD = 80;
const ERROR_THRESHOLD = 95;

/** @param {number|null} usedPercent */
export function gaugeTone(usedPercent) {
  if (usedPercent == null) return "muted";
  if (usedPercent >= ERROR_THRESHOLD) return "error";
  if (usedPercent >= WARNING_THRESHOLD) return "warning";
  return "success";
}

/**
 * @param {number|null} usedPercent - 0-100, how much of the budget is used
 * @param {{fg(role:string,text:string):string}} theme
 * @param {number} [cells]
 */
export function paintGauge(usedPercent, theme, cells = GAUGE_CELLS) {
  const clamped = Math.max(0, Math.min(100, usedPercent ?? 0));
  const filled = Math.round((clamped / 100) * cells);
  const filledCells = GAUGE_FILLED.repeat(filled);
  const emptyCells = GAUGE_EMPTY.repeat(cells - filled);
  return theme.fg(gaugeTone(usedPercent), filledCells) + theme.fg(GAUGE_EMPTY_ROLE, emptyCells);
}
