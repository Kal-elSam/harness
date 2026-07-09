import { join } from "node:path";

export function buildGraphifyContextManagedSection(context, adapter, catalogEntry) {
  const contractPath = join(context.componentsDir, "graphify-context", "context-graph.md");
  const adapterNote = catalogEntry?.adapterHints?.[adapter.id] ?? null;

  return [
    "### Graphify Context",
    "",
    `- Contract: ${contractPath}`,
    "- Optional architecture graph; read GRAPH_REPORT.md before cross-module questions.",
    "- Run `graphify update .` after code changes when the CLI is available.",
    "- Authority: user > AGENTS.md > repo docs > Engram > Graphify.",
    adapterNote
  ].filter(Boolean).join("\n");
}
