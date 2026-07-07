import { installGlobalHarness } from "../global-installer.js";
import { summarizeInstallPreflight } from "../diff.js";
import {
  DEFAULT_COMPONENT_IDS,
  validateComponentIds
} from "../component-registry.js";
import { validateAdapterIds } from "../registry.js";

export async function buildSetupPreview({
  homeDir,
  workspaceRoot,
  packageRoot,
  packageName,
  cliVersion,
  agents,
  components,
  noDefaultComponents
}) {
  const validatedAgents = validateAdapterIds(agents);
  const plan = await installGlobalHarness({
    packageRoot,
    packageName,
    cliVersion,
    homeDir,
    workspaceRoot,
    agents: validatedAgents,
    components,
    noDefaultComponents,
    dryRun: true
  });
  const preflight = await summarizeInstallPreflight(homeDir, plan);

  return {
    agents: validatedAgents,
    components: noDefaultComponents ? [] : (components ?? [...DEFAULT_COMPONENT_IDS]),
    plan,
    preflight
  };
}

export function resolveComponentSelection(selectedIds, { workspaceRoot }) {
  if (selectedIds.includes("__none__")) {
    return { noDefaults: true, selected: [] };
  }

  const selected = validateComponentIds(selectedIds, { workspaceRoot });
  return { noDefaults: false, selected };
}
