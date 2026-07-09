import { join } from "node:path";
import { buildEngramMemoryManagedSection } from "./components/engram-memory.js";
import { buildGraphifyContextManagedSection } from "./components/graphify-context.js";
import { buildOrchestratorManagedSection } from "./components/orchestrator.js";
import { buildSddCoreManagedSection } from "./components/sdd-core.js";

export const COMPONENT_BUILDERS = {
  orchestrator: buildOrchestratorManagedSection,
  "sdd-core": buildSddCoreManagedSection,
  "engram-memory": buildEngramMemoryManagedSection,
  "graphify-context": buildGraphifyContextManagedSection
};

export function resolveComponentBuilder(componentId) {
  const builder = COMPONENT_BUILDERS[componentId];

  if (!builder) {
    throw new Error(`Missing managed section builder for component "${componentId}".`);
  }

  return builder;
}

export function createManagedSectionBuilder(componentId, catalogEntry) {
  const builder = resolveComponentBuilder(componentId);

  return (context, adapter) => builder(context, adapter, catalogEntry);
}

export function createWorkspaceManagedSectionBuilder(catalogEntry) {
  return (context, adapter) => buildWorkspaceManagedSection(context, adapter, catalogEntry);
}

export function buildWorkspaceManagedSection(context, _adapter, catalogEntry) {
  const baseDir = join(context.componentsDir, catalogEntry.id);
  const lines = [`### ${catalogEntry.label}`, ""];

  for (const asset of catalogEntry.assetFiles) {
    lines.push(`- ${asset}: ${join(baseDir, asset)}`);
  }

  if (catalogEntry.instructions) {
    lines.push("", catalogEntry.instructions);
  }

  return lines.join("\n");
}
