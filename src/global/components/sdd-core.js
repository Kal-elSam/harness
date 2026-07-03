import { join } from "node:path";

export const SDD_CORE_VERSION = "1.0.0";

export default {
  id: "sdd-core",
  version: SDD_CORE_VERSION,
  defaultEnabled: true,
  assetFiles: ["workflow.md", "spec-sizing.md", "handoff.md"],

  buildManagedSection(context, adapter) {
    const baseDir = join(context.componentsDir, "sdd-core");
    const adapterNote = adapterHint(adapter.id);

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
};

function adapterHint(adapterId) {
  switch (adapterId) {
    case "cursor":
      return "- In repos with workspace harness: also read `.cursor/rules/` and `docs/specs/`.";
    case "codex":
      return "- In repos with workspace harness: also read `.codex/skills/sdd/` when present.";
    case "claude":
      return "- In repos with workspace harness: repo `AGENTS.md` wins over `CLAUDE.md` pointers.";
    case "opencode":
      return "- In repos with workspace harness: also read `.opencode/` SDD assets when present.";
    default:
      return null;
  }
}
