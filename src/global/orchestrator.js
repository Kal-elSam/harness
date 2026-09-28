import { stdin as input, stdout as output } from "node:process";
import { canUseOrchestratorShell } from "./ink/orchestrator-state.js";
import { formatCliCommand } from "./brand/cli.js";
import { BRAND } from "./brand/index.js";
import { buildReadOnlyDiagnostics, shouldExecutePlan } from "./action-planner.js";
import { launchRatatuiHost, assertProductUiNotRetired } from "./host/launch-ratatui-host.js";
import { INITIAL_EXPERIENCE } from "./initial-experience.js";

export { canUseOrchestratorShell };

export function shouldOpenOrchestratorShell({
  interactive = Boolean(input.isTTY && output.isTTY),
  json = false,
  hasImplicitFlags = false
} = {}) {
  if (!interactive || json) return false;
  if (hasImplicitFlags) return false;
  return canUseOrchestratorShell({ interactive });
}

/**
 * U7: `kairo shell` opens the ratatui host (Operations is key 5 inside).
 * Ink orchestrator shell is retired.
 */
export async function runOrchestratorShell({
  workspaceRoot,
  interactive = Boolean(input.isTTY && output.isTTY),
  options = {},
  env = process.env,
  launchRatatuiHostImpl = launchRatatuiHost
} = {}) {
  assertProductUiNotRetired({ options, env });
  if (!interactive) {
    throw new Error(
      `Non-interactive shell requires an explicit command. Try ${formatCliCommand("help")} or ${formatCliCommand("runs list")}.`
    );
  }
  return launchRatatuiHostImpl({
    cwd: workspaceRoot,
    interactive
  });
}

export async function runOrchestratorDiagnostics({
  homeDir,
  workspaceRoot,
  packageName,
  packageRoot,
  cliVersion,
  json = false
}) {
  const diagnostics = await buildReadOnlyDiagnostics({
    homeDir,
    workspaceRoot,
    packageName,
    packageRoot,
    cliVersion
  });

  if (json) {
    return diagnostics;
  }

  console.log(commandHeader("orchestrator — agent capability diagnostics"));
  console.log(`Home: ${homeDir}`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("");

  for (const capability of diagnostics.capabilities) {
    console.log(
      `  ${capability.label.padEnd(14)} ${capability.state.padEnd(14)} detected=${capability.detected ? "yes" : "no"}`
    );
  }

  if (diagnostics.intelligence) {
    console.log("");
    console.log("Intelligence backends:");
    for (const backend of diagnostics.intelligence.backends) {
      console.log(
        `  ${backend.label.padEnd(14)} ${backend.state.padEnd(14)} models=${backend.models?.length ?? 0}`
      );
    }
    console.log(`  Routing: ${diagnostics.intelligence.routingPreview?.reason ?? "n/a"}`);
  }

  console.log("");
  console.log("Recommendations:");
  for (const recommendation of diagnostics.recommendations) {
    console.log(`  - ${recommendation}`);
  }

  return diagnostics;
}

function commandHeader(title) {
  return `${BRAND.displayName} ${title}`;
}

export function assertPlanExecution(plan, { confirmed = false } = {}) {
  if (!shouldExecutePlan(plan, { confirmed })) {
    throw new Error("Plan declined. No writes or installations were performed.");
  }
}

export { INITIAL_EXPERIENCE };
