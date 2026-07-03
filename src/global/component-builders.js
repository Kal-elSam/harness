import { join } from "node:path";
import { buildOrchestratorManagedSection } from "./components/orchestrator.js";
import { buildSddCoreManagedSection } from "./components/sdd-core.js";

export const COMPONENT_BUILDERS = {
  orchestrator: buildOrchestratorManagedSection,
  "sdd-core": buildSddCoreManagedSection
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
