import { join } from "node:path";

export const AGENT_SKILLS_IDS = Object.freeze([
  "context-engineering",
  "source-driven-development",
  "frontend-ui-engineering",
  "performance-optimization",
  "observability-and-instrumentation"
]);

export function buildAgentSkillsManagedSection(context, adapter, catalogEntry) {
  const baseDir = join(context.componentsDir, "agent-skills");
  const adapterNote = catalogEntry?.adapterHints?.[adapter.id] ?? null;

  return [
    "### Agent Skills (complementary)",
    "",
    `- Skills root: ${join(baseDir, "skills")}`,
    `- Provenance: ${join(baseDir, "PROVENANCE.md")}`,
    `- License: ${join(baseDir, "LICENSE")}`,
    `- Adopted skills (only): ${AGENT_SKILLS_IDS.join(", ")}.`,
    "- Complementary only: Gentle AI remains the methodological authority for SDD, RDD, review, and Git workflow.",
    "- Do not treat these skills as replacements for Gentle AI phase skills or review gates.",
    "- After install or update, run `gentle-ai skill-registry refresh` when Gentle AI is available.",
    adapterNote
  ].filter(Boolean).join("\n");
}
