import { basename } from "node:path";

export const PACKAGE_NAME = "@kal-elsam/kairo-runtime";
export const LEGACY_PACKAGE_NAME = "@kal-elsam/harness";
export const PREFERRED_CLI = "kairo";

export const PREFERRED_CLI_NAMES = new Set(["kairo", "kairo-runtime"]);
export const LEGACY_CLI_NAMES = new Set([
  "harness",
  "agentic-harness",
  "sgs-harness",
  "harness-sgs"
]);
export const ALL_CLI_NAMES = new Set([...PREFERRED_CLI_NAMES, ...LEGACY_CLI_NAMES]);

export function isLegacyCliName(name) {
  return LEGACY_CLI_NAMES.has(name);
}

export function legacyCliWarning(cliName) {
  return `${cliName} is a legacy alias; prefer ${PREFERRED_CLI}`;
}

export function normalizeInvokedCliBase(argv = process.argv) {
  const invokedBase = basename(argv[1] ?? "");
  if (invokedBase.endsWith(".js")) {
    return invokedBase.slice(0, -3);
  }
  return invokedBase;
}

export function resolveInvokedCliName(argv = process.argv) {
  const invokedBase = normalizeInvokedCliBase(argv);
  if (ALL_CLI_NAMES.has(invokedBase)) {
    return invokedBase;
  }
  return PREFERRED_CLI;
}

export function maybeWarnLegacyCli(argv = process.argv, { json = false } = {}) {
  if (json) return;

  const invokedBase = normalizeInvokedCliBase(argv);
  if (isLegacyCliName(invokedBase)) {
    console.warn(`Warning: ${legacyCliWarning(invokedBase)}`);
  }
}

export function formatCliCommand(subcommand, cliName = PREFERRED_CLI) {
  const trimmed = subcommand.trim();
  return trimmed ? `${cliName} ${trimmed}` : cliName;
}
