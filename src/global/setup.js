import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { installGlobalHarness } from "./global-installer.js";
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
  interactive = Boolean(input.isTTY && output.isTTY),
  createPrompt = createReadlinePrompt
}) {
  const detected = detectInstalledAdapters({ homeDir });
  const defaultAgentsLabel = detected.length > 0 ? detected.join(",") : GLOBAL_AGENT_IDS.join(",");

  console.log("Harness setup — local AI ecosystem configurator");
  console.log("Configures and coordinates local agents. Does not install the AI apps themselves.");
  console.log("");
  console.log(`Detected agents: ${detected.join(", ") || "none"}`);
  console.log(`Supported agents: ${GLOBAL_AGENT_IDS.join(", ")}`);
  console.log(`Default components: ${DEFAULT_COMPONENT_IDS.join(", ")}`);
  console.log("");

  let selectedAgents = agents;
  let selectedComponents = components;
  let selectedNoDefaults = noDefaultComponents;

  const shouldPrompt = interactive && !dryRun && !yes
    && agents == null
    && components == null
    && !noDefaultComponents;

  if (shouldPrompt) {
    const prompt = createPrompt();
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

      const confirm = (await prompt("Apply this plan? [Y/n]: ")).trim().toLowerCase();
      if (confirm === "n" || confirm === "no") {
        console.log("Setup cancelled.");
        return { cancelled: true };
      }
    } finally {
      await prompt.close?.();
    }
  } else {
    printSetupPlanPreview({
      agents: resolveAgentIds(selectedAgents, { homeDir }),
      components: selectedNoDefaults
        ? []
        : (selectedComponents ?? [...DEFAULT_COMPONENT_IDS])
    });
  }

  const result = await installGlobalHarness({
    packageRoot,
    packageName,
    cliVersion,
    homeDir,
    workspaceRoot,
    agents: selectedAgents,
    components: selectedComponents,
    noDefaultComponents: selectedNoDefaults,
    dryRun
  });

  return { cancelled: false, result };
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

function createReadlinePrompt() {
  const rl = readline.createInterface({ input, output });
  const prompt = (question) => rl.question(question);
  prompt.close = async () => rl.close();
  return prompt;
}
