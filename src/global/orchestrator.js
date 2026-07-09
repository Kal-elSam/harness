import { stdin as input, stdout as output } from "node:process";
import { resolveHomeDir } from "./paths.js";
import { runGlobalSetup } from "./global-cli.js";
import { PLAN_ACTIONS, buildReadOnlyDiagnostics, shouldExecutePlan } from "./action-planner.js";
import { canUseOrchestratorShell } from "./ink/orchestrator-state.js";
import { runOrchestratorInk as defaultRunOrchestratorInk } from "./ink/run-orchestrator-ink.js";
import { formatCliCommand } from "./brand/cli.js";
import { BRAND } from "./brand/index.js";

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
  runOrchestratorInkImpl = defaultRunOrchestratorInk
}) {
  if (!interactive) {
    throw new Error(
      `Non-interactive shell requires an explicit command. Try ${formatCliCommand("help")} or ${formatCliCommand("setup --yes")}.`
    );
  }

  if (!canUseOrchestratorShell({ interactive })) {
    throw new Error(
      `Interactive shell requires a capable TTY. Use ${formatCliCommand("setup --simple")} or explicit commands.`
    );
  }

  const homeDir = resolveHomeDir();
  const outcome = await runOrchestratorInkImpl({
    homeDir,
    workspaceRoot,
    packageRoot,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version
  });

  if (outcome.error) {
    throw outcome.error;
  }

  if (outcome.cancelled) {
    return { cancelled: true, wrote: false };
  }

  if (outcome.confirmed && outcome.action === PLAN_ACTIONS.SETUP) {
    const setupOutcome = await runGlobalSetup(
      {
        cwd: workspaceRoot,
        adapters: null,
        components: null,
        noDefaultComponents: false,
        dryRun: false,
        yes: false,
        confirm: false,
        preflight: true,
        preflightExplicit: false,
        yesExplicit: false,
        confirmExplicit: false,
        json: false,
        interactive: true,
        simple: false
      },
      packageManifest,
      packageRoot
    );

    return {
      cancelled: Boolean(setupOutcome.cancelled),
      wrote: !setupOutcome.cancelled && !setupOutcome.result?.dryRun,
      action: PLAN_ACTIONS.SETUP,
      setupOutcome
    };
  }

  return { cancelled: false, wrote: false, action: outcome.action ?? null };
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
