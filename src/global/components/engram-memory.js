import { join } from "node:path";

export function buildEngramMemoryManagedSection(context, adapter, catalogEntry) {
  const contractPath = join(context.componentsDir, "engram-memory", "memory.md");
  const adapterNote = catalogEntry?.adapterHints?.[adapter.id] ?? null;

  return [
    "### Engram Memory",
    "",
    `- Contract: ${contractPath}`,
    "- Optional persistent memory; repo AGENTS.md and docs/ai/ govern when present.",
    "- Search memory before non-trivial tasks; save decisions, bugs, and conventions proactively.",
    "- Authority: user > AGENTS.md > repo docs > Engram > Graphify.",
    adapterNote
  ].filter(Boolean).join("\n");
}
