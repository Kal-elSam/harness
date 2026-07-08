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

function detectInvocationPackageManager() {
  const execPath = process.env.npm_execpath ?? "";
  const userAgent = process.env.npm_config_user_agent ?? "";

  if (execPath.includes("pnpm") || userAgent.startsWith("pnpm/")) return "pnpm";
  if (execPath.includes("yarn") || userAgent.startsWith("yarn/")) return "yarn";
  if (execPath.includes("bun") || userAgent.startsWith("bun/")) return "bun";
  return "npm";
}

export function resolveSuggestedInvocation(packageName = PACKAGE_NAME, argv = process.argv) {
  const invokedPath = argv[1] ?? PREFERRED_CLI;
  const invokedBase = basename(invokedPath);

  if (!invokedBase.endsWith(".js") && ALL_CLI_NAMES.has(invokedBase)) {
    return invokedBase;
  }

  const packageManager = detectInvocationPackageManager();

  switch (packageManager) {
    case "pnpm":
      return `pnpm dlx ${packageName}`;
    case "yarn":
      return `yarn dlx ${packageName}`;
    case "bun":
      return `bunx ${packageName}`;
    default:
      return `npx ${packageName}`;
  }
}

export function formatSuggestedCliCommand(
  subcommand,
  { packageName = PACKAGE_NAME, argv = process.argv, suggestedInvocation } = {}
) {
  const invoke = suggestedInvocation ?? resolveSuggestedInvocation(packageName, argv);
  const trimmed = subcommand.trim();
  return trimmed ? `${invoke} ${trimmed}` : invoke;
}
