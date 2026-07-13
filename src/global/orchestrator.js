import { stdin as input, stdout as output } from "node:process";
import { resolveHomeDir } from "./paths.js";
import { canUseOrchestratorShell } from "./ink/orchestrator-state.js";
import { runOrchestratorInk as defaultRunOrchestratorInk } from "./ink/run-orchestrator-ink.js";
import { formatCliCommand } from "./brand/cli.js";
import { BRAND } from "./brand/index.js";
import { buildReadOnlyDiagnostics, shouldExecutePlan } from "./action-planner.js";
import { runHarnessSetup as defaultRunHarnessSetup } from "./setup.js";
import {
  INITIAL_EXPERIENCE,
  hasConfiguredGlobalState
} from "./initial-experience.js";

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

export async function runOrchestratorShell({
  packageRoot,
  packageManifest,
  workspaceRoot,
  interactive = Boolean(input.isTTY && output.isTTY),
  initialMode = INITIAL_EXPERIENCE.DASHBOARD,
  shellCapable = canUseOrchestratorShell({ interactive }),
  runOrchestratorInkImpl = defaultRunOrchestratorInk,
  runHarnessSetupImpl = defaultRunHarnessSetup
}) {
  if (!interactive) {
    throw new Error(
      `Non-interactive shell requires an explicit command. Try ${formatCliCommand("help")} or ${formatCliCommand("runs list")}.`
    );
  }

  if (!shellCapable) {
    throw new Error(
      `Interactive shell requires a capable TTY. Use ${formatCliCommand("runs list")} or explicit commands.`
    );
  }

  const homeDir = resolveHomeDir();
  let setupOutcome = null;

  if (initialMode === INITIAL_EXPERIENCE.ONBOARDING) {
    setupOutcome = await runHarnessSetupImpl({
      packageRoot,
      packageName: packageManifest.name,
      cliVersion: packageManifest.version,
      homeDir,
      workspaceRoot,
      onboarding: true,
      interactive: true
    });

    if (setupOutcome?.cancelled) {
      return {
        cancelled: true,
        wrote: false,
        action: null,
        initialMode,
        setup: setupOutcome
      };
    }
  }

  const outcome = await runOrchestratorInkImpl({
    homeDir,
    workspaceRoot,
    packageRoot,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    hasGlobalState: hasConfiguredGlobalState(homeDir)
  });

  if (outcome.error) {
    throw outcome.error;
  }

  return {
    cancelled: Boolean(outcome.cancelled),
    wrote: Boolean(setupOutcome && !setupOutcome.cancelled),
    action: outcome.action ?? null,
    initialMode,
    setup: setupOutcome
  };
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
