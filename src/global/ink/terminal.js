import { stdin as input, stdout as output } from "node:process";
import { resolveTerminalCapabilities } from "./terminal-capabilities.js";
import { resolveLayoutMode } from "./layout.js";

export { resolveTerminalCapabilities } from "./terminal-capabilities.js";
export { resolveLayoutMode, resolveListLimit, LAYOUT_MODES } from "./layout.js";
export { windowList } from "./list-window.js";

export function canUseSetupInk({
  interactive = Boolean(input.isTTY && output.isTTY),
  term = process.env.TERM ?? "",
  columns = output.columns ?? 80,
  rows = output.rows ?? 24,
  forceInk = process.env.HARNESS_INK !== "0",
  env = process.env
} = {}) {
  const caps = resolveTerminalCapabilities({
    columns,
    rows,
    env: { ...env, HARNESS_INK: forceInk ? env.HARNESS_INK : "0", TERM: term },
    isTTY: interactive,
    term
  });
  return caps.canUseInk;
}

/**
 * Snapshot of layout mode from live stdout dimensions.
 */
export function readTerminalLayout({
  columns = output.columns ?? 80,
  rows = output.rows ?? 24
} = {}) {
  return resolveLayoutMode({ columns, rows });
}
