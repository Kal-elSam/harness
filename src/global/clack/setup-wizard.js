import * as defaultPrompts from "@clack/prompts";
import { describeComponentCatalog, DEFAULT_COMPONENT_IDS } from "../component-registry.js";
import { loadConsentAudit } from "../policy.js";
import {
  GLOBAL_AGENT_IDS,
  detectInstalledAdapters,
  listAdapters,
  validateAdapterIds
} from "../registry.js";
import {
  buildSetupPreview,
  formatDetectNote,
  formatPreviewNote,
  resolveComponentSelection
} from "./setup-preview.js";
import { SetupWizardCancelledError } from "./setup-wizard-constants.js";

export { SetupWizardCancelledError };

export function shouldUseSetupWizard({
  interactive,
  dryRun = false,
  yes = false,
  confirm = false,
  json = false,
  agents = null,
  components = null,
  noDefaultComponents = false
} = {}) {
  if (!interactive || json) return false;
  if (yes || confirm) return false;
  if (agents != null || components != null || noDefaultComponents) return false;
  return true;
}

/** @deprecated Use shouldUseSetupWizard */
export const shouldUseSetupTui = shouldUseSetupWizard;

function handleCancel(prompts, message = "Setup cancelled.") {
  prompts.cancel(message);
  return { cancelled: true, usedWizard: true };
}

export async function runSetupWizard({
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
  prompts = defaultPrompts
}) {
  const detected = detectInstalledAdapters({ homeDir });
  const adapters = listAdapters();
  const components = describeComponentCatalog({ workspaceRoot });
  const defaultAgents = detected.length > 0 ? detected : [...GLOBAL_AGENT_IDS];

  try {
    prompts.intro("Harness");
    prompts.log.info("Local AI ecosystem configurator — coordinates agents, does not install the apps.");

    prompts.note(
      formatDetectNote({ adapters, detected }),
      "Detected agents"
    );

    const agentSelection = await prompts.multiselect({
      message: "Which agents should Harness configure?",
      options: adapters.map((adapter) => ({
        value: adapter.id,
        label: adapter.label,
        hint: detected.includes(adapter.id) ? "detected" : "not installed"
      })),
      initialValues: defaultAgents,
      required: true
    });

    if (prompts.isCancel(agentSelection)) {
      return handleCancel(prompts);
    }

    const agents = validateAdapterIds(agentSelection);
    const defaultComponents = [...DEFAULT_COMPONENT_IDS];
    const componentSelection = await prompts.multiselect({
      message: "Which components should be installed?",
      options: [
        ...components.map((component) => ({
          value: component.id,
          label: component.label,
          hint: component.defaultEnabled ? "default" : undefined
        })),
        {
          value: "__none__",
          label: "none (core plumbing only)"
        }
      ],
      initialValues: defaultComponents,
      required: false
    });

    if (prompts.isCancel(componentSelection)) {
      return handleCancel(prompts);
    }

    const { noDefaults: noDefaultComponents, selected: selectedComponents } = resolveComponentSelection(
      componentSelection,
      { workspaceRoot }
    );

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

    prompts.note(formatPreviewNote({ preview }), "Preview managed changes");

    const approved = await prompts.confirm({
      message: dryRun
        ? "Preview only — no files will be written. Continue?"
        : "Apply this plan? Backups are created before config writes when applicable.",
      initialValue: true
    });

    if (prompts.isCancel(approved) || !approved) {
      return handleCancel(prompts);
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
      usedWizard: true,
      agents,
      components: selectedComponents,
      noDefaultComponents,
      preview,
      consent
    };
  } catch (error) {
    if (error instanceof SetupWizardCancelledError) {
      return handleCancel(prompts);
    }
    prompts.log.error(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** @deprecated Use runSetupWizard */
export const runSetupTui = runSetupWizard;

export function renderSetupWizardResult(result, { dryRun = false, prompts = defaultPrompts } = {}) {
  const lines = [
    `State root: ${result.stateRoot}`,
    `Agents: ${result.agents.join(", ")}`,
    `Components: ${result.components.join(", ") || "none (core plumbing only)"}`,
    `Configs created: ${result.configsCreated.length}`,
    `Configs updated: ${result.configsUpdated.length}`,
    `${dryRun ? "Backups planned" : "Backups"}: ${result.backups.length}`,
    "",
    "Next actions:",
    dryRun
      ? "  harness setup --confirm   Apply this plan"
      : "  harness status            Verify ecosystem health",
    dryRun
      ? "  harness setup --dry-run   Re-preview changes"
      : "  harness doctor            Detailed health checks",
    dryRun ? "" : "  harness sync              Repair drift when needed"
  ].filter((line) => line !== "");

  prompts.note(lines.join("\n"), dryRun ? "Dry run complete" : "Setup complete");
  prompts.outro(dryRun ? "Nothing was written." : "Harness is ready.");
}

/** @deprecated Use renderSetupWizardResult */
export const renderSetupTuiResult = renderSetupWizardResult;
