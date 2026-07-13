/**
 * Pure terminal capability resolution for Ink cockpit / setup.
 * Never communicates state via color alone — callers must keep text labels.
 */

export const LAYOUT_MODES = {
  WIDE: "wide",
  COMPACT: "compact",
  MINIMAL: "minimal"
};

/**
 * @param {{
 *   columns?: number,
 *   rows?: number,
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   isTTY?: boolean,
 *   term?: string
 * }} [options]
 */
export function resolveTerminalCapabilities({
  columns = 80,
  rows = 24,
  env = process.env,
  isTTY = true,
  term = env.TERM ?? ""
} = {}) {
  const forceInk = env.HARNESS_INK !== "0";
  const noColor = Boolean(env.NO_COLOR) || env.FORCE_COLOR === "0";
  const unicode = !(
    env.HARNESS_ASCII === "1"
    || env.LC_ALL === "C"
    || term === "dumb"
    || /^(linux|vt100|vt220)$/i.test(term)
  );

  const safeColumns = Number.isFinite(columns) && columns > 0 ? columns : 80;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 24;

  return {
    isTTY: Boolean(isTTY),
    term: term || "",
    columns: safeColumns,
    rows: safeRows,
    forceInk,
    color: !noColor,
    unicode,
    canUseInk: Boolean(isTTY) && forceInk && term !== "dumb" && safeColumns >= 60
  };
}
