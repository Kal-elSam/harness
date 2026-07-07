import { stdin as input, stdout as output } from "node:process";

export function canUseSetupInk({
  interactive = Boolean(input.isTTY && output.isTTY),
  term = process.env.TERM ?? "",
  columns = output.columns ?? 80,
  forceInk = process.env.HARNESS_INK !== "0"
} = {}) {
  if (!interactive || !forceInk) return false;
  if (term === "dumb") return false;
  if (columns > 0 && columns < 60) return false;
  return true;
}
