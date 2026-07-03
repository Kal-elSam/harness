import { join } from "node:path";

export function buildOrchestratorManagedSection(context, adapter) {
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
