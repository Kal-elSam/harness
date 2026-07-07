import * as defaultPrompts from "@clack/prompts";
import { BRAND, getAgentLabel, WIZARD_COPY } from "../brand/index.js";
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
  resolveComponentSelection
} from "./setup-preview.js";
import { SetupWizardCancelledError } from "./setup-wizard-constants.js";
import {
  brandIntroTitle,
  formatAgentDetectCard,
  formatAgentMultiselectHint,
  formatComponentMultiselectHint,
  formatPreviewNote,
  formatResultNote,
  formatSplashNote
} from "./theme.js";

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

function handleCancel(prompts, message = BRAND.wizardCancelMessage) {
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
    prompts.intro(brandIntroTitle());
    prompts.note(formatSplashNote(), WIZARD_COPY.splashTitle);

    prompts.note(
      formatAgentDetectCard({ adapters, detected }),
      WIZARD_COPY.detectTitle
    );

    const agentSelection = await prompts.multiselect({
      message: WIZARD_COPY.agentsPrompt,
      options: adapters.map((adapter) => ({
        value: adapter.id,
        label: getAgentLabel(adapter.id),
        hint: formatAgentMultiselectHint(adapter.id, detected)
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
      message: WIZARD_COPY.componentsPrompt,
      options: [
        ...components.map((component) => ({
          value: component.id,
          label: component.label,
          hint: formatComponentMultiselectHint(component)
        })),
        {
          value: "__none__",
          label: WIZARD_COPY.coreOnlyLabel
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

    prompts.note(
      formatPreviewNote({ preview, componentCatalog: components }),
      WIZARD_COPY.previewTitle
    );

    const approved = await prompts.confirm({
      message: dryRun ? WIZARD_COPY.confirmDryRun : WIZARD_COPY.confirmApply,
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
  prompts.note(
    formatResultNote(result, { dryRun }),
    dryRun ? WIZARD_COPY.resultDryRunTitle : WIZARD_COPY.resultSuccessTitle
  );
  prompts.outro(dryRun ? WIZARD_COPY.outroDryRun : WIZARD_COPY.outroSuccess);
}

/** @deprecated Use renderSetupWizardResult */
export const renderSetupTuiResult = renderSetupWizardResult;
