import { LAYOUT_MODES } from "./terminal-capabilities.js";

/**
 * Pure layout mode from terminal size.
 * @returns {"wide"|"compact"|"minimal"|null} null when below Ink gate (<60 cols)
 */
export function resolveLayoutMode({ columns = 80, rows = 24 } = {}) {
  const cols = Number.isFinite(columns) && columns > 0 ? columns : 0;
  const r = Number.isFinite(rows) && rows > 0 ? rows : 0;

  if (cols < 60) return null;

  if (cols >= 100 && r >= 28) return LAYOUT_MODES.WIDE;
  if (cols >= 72 && r >= 20) return LAYOUT_MODES.COMPACT;
  return LAYOUT_MODES.MINIMAL;
}

/**
 * Suggested visible list limit for the active layout.
 */
export function resolveListLimit(layoutMode, { contentRows = 12 } = {}) {
  switch (layoutMode) {
    case LAYOUT_MODES.WIDE:
      return Math.max(6, Math.min(16, contentRows - 4));
    case LAYOUT_MODES.COMPACT:
      return Math.max(4, Math.min(10, contentRows - 4));
    case LAYOUT_MODES.MINIMAL:
      return Math.max(3, Math.min(6, contentRows - 2));
    default:
      return 4;
  }
}

export { LAYOUT_MODES };
