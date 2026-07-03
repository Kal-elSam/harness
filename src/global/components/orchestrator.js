import { join } from "node:path";

export const ORCHESTRATOR_VERSION = "1.0.0";

export default {
  id: "orchestrator",
  version: ORCHESTRATOR_VERSION,
  defaultEnabled: true,
  assetFiles: ["orchestrator.md"],

  buildManagedSection(context, adapter) {
    const contractPath = join(context.componentsDir, "orchestrator", "orchestrator.md");

    return [
      "### Orchestrator",
      "",
      `- Contract: ${contractPath}`,
      "- Coordinates cross-agent handoffs; does not replace any agent.",
      `- Adapter target: ~/${adapter.assets.configFile}`,
      "- Repository AGENTS.md governs when a repo harness is present."
    ].join("\n");
  }
};
