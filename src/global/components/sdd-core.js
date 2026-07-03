import { join } from "node:path";

export function buildSddCoreManagedSection(context, adapter, catalogEntry) {
  const baseDir = join(context.componentsDir, "sdd-core");
  const adapterNote = catalogEntry?.adapterHints?.[adapter.id] ?? null;

  return [
    "### SDD Core",
    "",
    `- Workflow: ${join(baseDir, "workflow.md")}`,
    `- Spec sizing: ${join(baseDir, "spec-sizing.md")}`,
    `- Handoff rules: ${join(baseDir, "handoff.md")}`,
    "- Classify work as basic, standard, or complex before implementing.",
    "- No significant feature without a spec; no bug fix without a failing test first.",
    adapterNote
  ].filter(Boolean).join("\n");
}
