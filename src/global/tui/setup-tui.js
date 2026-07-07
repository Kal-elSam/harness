import { describeComponentCatalog } from "../component-registry.js";
import { loadConsentAudit } from "../policy.js";
import {
  detectInstalledAdapters,
  listAdapters,
  validateAdapterIds
} from "../registry.js";
import { formatHelp, formatStepHeader } from "./format.js";
import { SETUP_TUI_TOTAL_STEPS, SetupTuiCancelledError } from "./setup-tui-constants.js";
import {
  buildSetupPreview,
  confirmApplyStep,
  selectAgentsStep,
  selectComponentsStep,
  showDetectStep,
  showPreviewStep
} from "./setup-tui-steps.js";
import { canUseSetupTui, createTerminalIo, paint } from "./terminal.js";

export { canUseSetupTui, SetupTuiCancelledError };

export function shouldUseSetupTui({
  interactive,
  dryRun = false,
  yes = false,
  confirm = false,
  json = false,
  agents = null,
  components = null,
  noDefaultComponents = false,
  tuiSupported = canUseSetupTui({ interactive })
} = {}) {
  if (!interactive || json) return false;
  if (yes || confirm) return false;
  if (agents != null || components != null || noDefaultComponents) return false;
  return tuiSupported;
}

export async function runSetupTui({
  homeDir,
  workspaceRoot,
  packageRoot,
  packageName,
  cliVersion,
  dryRun = false,
  preflight = true,
  yes = false,
  confirm = false,
  preflightExplicit = false,
  yesExplicit = false,
  confirmExplicit = false,
  interactive = true,
  io = createTerminalIo()
}) {
  const detected = detectInstalledAdapters({ homeDir });
  const adapters = listAdapters();
  const components = describeComponentCatalog({ workspaceRoot });

  try {
    await showDetectStep({ io, adapters, detected });
    const agentSelection = await selectAgentsStep({ io, adapters, detected });
    if (agentSelection.cancelled) return { cancelled: true, usedTui: true };

    const componentSelection = await selectComponentsStep({ io, components, workspaceRoot });
    if (componentSelection.cancelled) return { cancelled: true, usedTui: true };

    const agents = validateAdapterIds(agentSelection.selected);
    const selectedComponents = componentSelection.noDefaults ? null : componentSelection.selected;
    const noDefaultComponents = componentSelection.noDefaults;

    const preview = await buildSetupPreview({
      homeDir,
      workspaceRoot,
      packageRoot,
      packageName,
      cliVersion,
      agents,
      components: selectedComponents,
      noDefaultComponents
    });

    await showPreviewStep({ io, preview });
    const confirmed = await confirmApplyStep({ io, dryRun });
    if (confirmed === "cancel" || confirmed === "no") {
      return { cancelled: true, usedTui: true };
    }

    const consent = preflight
      ? await loadConsentAudit(homeDir, {
        yes,
        confirm,
        yesExplicit,
        confirmExplicit,
        preflight,
        preflightExplicit,
        interactive,
        applying: !dryRun,
        dryRun,
        json: false
      })
      : null;

    return {
      cancelled: false,
      usedTui: true,
      agents,
      components: selectedComponents,
      noDefaultComponents,
      preview,
      consent
    };
  } catch (error) {
    if (error instanceof SetupTuiCancelledError) {
      return { cancelled: true, usedTui: true };
    }
    renderSetupTuiError(io, error);
    throw error;
  } finally {
    await io.close();
  }
}

export function renderSetupTuiResult(result, { dryRun = false, io = createTerminalIo() } = {}) {
  const lines = [
    formatStepHeader({ step: SETUP_TUI_TOTAL_STEPS, total: SETUP_TUI_TOTAL_STEPS, title: "Result" }),
    "",
    dryRun
      ? paint("Dry run complete. Nothing was written.", "yellow")
      : paint("Setup complete.", "green"),
    "",
    `State root: ${result.stateRoot}`,
    `Agents: ${result.agents.join(", ")}`,
    `Components: ${result.components.join(", ") || "none (core plumbing only)"}`,
    `Configs created: ${result.configsCreated.length}`,
    `Configs updated: ${result.configsUpdated.length}`,
    `${dryRun ? "Backups planned" : "Backups"}: ${result.backups.length}`,
    "",
    paint("Next actions:", "bold"),
    dryRun
      ? "  harness setup --confirm   Apply this plan"
      : "  harness status            Verify ecosystem health",
    dryRun
      ? "  harness setup --dry-run   Re-preview changes"
      : "  harness doctor            Detailed health checks",
    dryRun
      ? ""
      : "  harness sync              Repair drift when needed",
    "",
    formatHelp("Enter to exit")
  ].filter((line) => line !== "");

  io.clear();
  io.write(`${lines.join("\n")}\n`);
}

export function renderSetupTuiError(io, error) {
  const message = error instanceof Error ? error.message : String(error);
  io.clear();
  io.write([
    paint("Setup failed", "red"),
    "",
    message,
    "",
    paint("Try:", "bold"),
    "  harness setup --confirm --agents <list>",
    "  harness setup --dry-run",
    "  harness doctor",
    ""
  ].join("\n"));
}
