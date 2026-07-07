import { stdin as input, stdout as output } from "node:process";
import { BRAND } from "./brand/index.js";
import { installGlobalHarness } from "./global-installer.js";
import {
  assertExplicitApplyConsent,
  createReadlinePrompt,
  promptApplyConfirmation,
  shouldPromptApplyConfirmation
} from "./apply-confirmation.js";
import { summarizeInstallPreflight } from "./diff.js";
import {
  COMPONENT_IDS,
  DEFAULT_COMPONENT_IDS,
  validateComponentIds
} from "./component-registry.js";
import {
  GLOBAL_AGENT_IDS,
  detectInstalledAdapters,
  isAllAgentsSelection,
  resolveAgentIds,
  validateAdapterIds
} from "./registry.js";
import { printManagedPreflight, shouldShowPreflight } from "./preflight.js";
import { loadConsentAudit } from "./policy.js";
import {
  renderSetupWizardResult,
  runSetupWizard as defaultRunSetupWizard,
  SetupWizardCancelledError,
  shouldUseSetupWizard as evaluateClackWizard
} from "./clack/setup-wizard.js";
import {
  renderSetupInkResult,
  runSetupInk as defaultRunSetupInk,
  SetupWizardCancelledError as SetupInkCancelledError
} from "./ink/run-setup-ink.js";
import { canUseSetupInk } from "./ink/terminal.js";
import { shouldUseSetupInk as evaluateSetupInk } from "./ink/setup-routing.js";

export { shouldUseSetupInk } from "./ink/setup-routing.js";
export { shouldUseSetupWizard } from "./clack/setup-wizard.js";
/** @deprecated Use shouldUseSetupWizard */
export { shouldUseSetupTui } from "./clack/setup-wizard.js";

export async function runHarnessSetup({
  packageRoot,
  packageName,
  cliVersion,
  homeDir,
  workspaceRoot = null,
  agents = null,
  components = null,
  noDefaultComponents = false,
  dryRun = false,
  yes = false,
  confirm = false,
  preflight = true,
  preflightExplicit = false,
  yesExplicit = false,
  confirmExplicit = false,
  json = false,
  simple = false,
  interactive = Boolean(input.isTTY && output.isTTY),
  createPrompt = createReadlinePrompt,
  runSetupInkImpl = defaultRunSetupInk,
  runSetupWizardImpl = defaultRunSetupWizard,
  inkCapable = canUseSetupInk({ interactive })
}) {
  const routing = { interactive, simple, inkCapable, dryRun, yes, confirm, json, agents, components, noDefaultComponents };
  const useInk = evaluateSetupInk(routing);
  const useWizard = !useInk && evaluateClackWizard({ ...routing, inkCapable });

  let selectedAgents = agents;
  let selectedComponents = components;
  let selectedNoDefaults = noDefaultComponents;
  let usedWizard = false;
  let usedInk = false;

  if (!useInk && !useWizard) {
    printSetupIntro({ homeDir });
  }

  const setupUiArgs = {
    homeDir,
    workspaceRoot,
    packageRoot,
    packageName,
    cliVersion,
    dryRun,
    preflight,
    yes,
    confirm,
    preflightExplicit,
    yesExplicit,
    confirmExplicit,
    interactive
  };

  if (useInk) {
    try {
      const inkOutcome = await runSetupInkImpl(setupUiArgs);

      if (inkOutcome.cancelled) {
        return { cancelled: true, usedWizard: true, usedInk: true };
      }

      selectedAgents = inkOutcome.agents;
      selectedComponents = inkOutcome.components;
      selectedNoDefaults = inkOutcome.noDefaultComponents;
      usedWizard = true;
      usedInk = true;
    } catch (error) {
      if (error instanceof SetupInkCancelledError) {
        return { cancelled: true, usedWizard: true, usedInk: true };
      }
      throw error;
    }
  } else if (useWizard) {
    try {
      const wizardOutcome = await runSetupWizardImpl(setupUiArgs);

      if (wizardOutcome.cancelled) {
        return { cancelled: true, usedWizard: true };
      }

      selectedAgents = wizardOutcome.agents;
      selectedComponents = wizardOutcome.components;
      selectedNoDefaults = wizardOutcome.noDefaultComponents;
      usedWizard = true;
    } catch (error) {
      if (error instanceof SetupWizardCancelledError) {
        return { cancelled: true, usedWizard: true };
      }
      throw error;
    }
  } else if (
    interactive && !dryRun && !yes && !confirm
    && agents == null
    && components == null
    && !noDefaultComponents
  ) {
    const prompt = createPrompt();
    const detected = detectInstalledAdapters({ homeDir });
    const defaultAgentsLabel = detected.length > 0 ? detected.join(",") : GLOBAL_AGENT_IDS.join(",");

    try {
      const agentsAnswer = (await prompt(`Agents to configure [${defaultAgentsLabel}]: `)).trim();
      if (agentsAnswer.length > 0) {
        selectedAgents = parseList(agentsAnswer);
        if (!isAllAgentsSelection(selectedAgents)) {
          validateAdapterIds(selectedAgents);
        }
      }

      const componentsAnswer = (await prompt(
        `Components to install [${DEFAULT_COMPONENT_IDS.join(",")}] (or "none"): `
      )).trim();

      if (componentsAnswer.toLowerCase() === "none") {
        selectedNoDefaults = true;
        selectedComponents = null;
      } else if (componentsAnswer.length > 0) {
        selectedComponents = parseList(componentsAnswer);
        validateComponentIds(selectedComponents, { workspaceRoot });
      }

      console.log("");
      printSetupPlanPreview({
        agents: resolveAgentIds(selectedAgents, { homeDir }),
        components: selectedNoDefaults
          ? []
          : (selectedComponents ?? [...DEFAULT_COMPONENT_IDS])
      });

      const confirmAnswer = (await prompt("Apply this plan? [Y/n]: ")).trim().toLowerCase();
      if (confirmAnswer === "n" || confirmAnswer === "no") {
        console.log("Setup cancelled.");
        return { cancelled: true };
      }
    } finally {
      await prompt.close?.();
    }
  } else if (!useInk && !useWizard) {
    printSetupPlanPreview({
      agents: resolveAgentIds(selectedAgents, { homeDir }),
      components: selectedNoDefaults
        ? []
        : (selectedComponents ?? [...DEFAULT_COMPONENT_IDS])
    });
  }

  const installArgs = {
    packageRoot,
    packageName,
    cliVersion,
    homeDir,
    workspaceRoot,
    agents: selectedAgents,
    components: selectedComponents,
    noDefaultComponents: selectedNoDefaults
  };

  const applying = !dryRun;

  assertExplicitApplyConsent({
    applying,
    dryRun,
    json,
    yes,
    confirm,
    noPreflight: !preflight,
    interactive,
    command: "setup"
  });

  if (!usedWizard && shouldShowPreflight({ preflight, dryRun, json, applying })) {
    const preview = await installGlobalHarness({ ...installArgs, dryRun: true });
    const summary = await summarizeInstallPreflight(homeDir, preview);
    const consent = await loadConsentAudit(homeDir, {
      yes,
      confirm,
      yesExplicit,
      confirmExplicit,
      preflight,
      preflightExplicit,
      interactive,
      applying,
      dryRun,
      json
    });
    printManagedPreflight({
      command: "setup",
      ...summary,
      consentSource: consent.consentSource,
      policyProfile: consent.policyProfile
    });
  }

  if (!usedWizard && shouldPromptApplyConfirmation({ applying, dryRun, json, confirm, interactive })) {
    const approved = await promptApplyConfirmation({ command: "setup", createPrompt });
    if (!approved) {
      console.log("Setup cancelled.");
      return { cancelled: true };
    }
  }

  const result = await installGlobalHarness({ ...installArgs, dryRun });

  if (usedInk) {
    renderSetupInkResult(result, { dryRun });
  } else if (usedWizard) {
    renderSetupWizardResult(result, { dryRun });
  }

  return { cancelled: false, result, usedWizard, usedInk };
}

function printSetupIntro({ homeDir }) {
  const detected = detectInstalledAdapters({ homeDir });

  console.log(`${BRAND.displayName} setup — local AI ecosystem configurator`);
  console.log("Configures and coordinates local agents. Does not install the AI apps themselves.");
  console.log("");
  console.log(`Detected agents: ${detected.join(", ") || "none"}`);
  console.log(`Supported agents: ${GLOBAL_AGENT_IDS.join(", ")}`);
  console.log(`Default components: ${DEFAULT_COMPONENT_IDS.join(", ")}`);
  console.log("");
}

function printSetupPlanPreview({ agents, components }) {
  console.log("Plan:");
  console.log(`  Agents: ${agents.join(", ")}`);
  console.log(`  Components: ${components.join(", ") || "none (core plumbing only)"}`);
  console.log(`  Available components: ${COMPONENT_IDS.join(", ")}`);
  console.log("");
}

function parseList(value) {
  return [...new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  )];
}
