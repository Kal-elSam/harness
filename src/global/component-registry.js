import orchestrator from "./components/orchestrator.js";
import sddCore from "./components/sdd-core.js";

const COMPONENTS = [orchestrator, sddCore];

export const DEFAULT_COMPONENT_IDS = COMPONENTS
  .filter((component) => component.defaultEnabled)
  .map((component) => component.id);

export const COMPONENT_IDS = COMPONENTS.map((component) => component.id);

export function listComponents() {
  return [...COMPONENTS];
}

export function resolveComponent(id) {
  const component = COMPONENTS.find((candidate) => candidate.id === id);

  if (!component) {
    throw new Error(`Unknown component "${id}". Use ${COMPONENT_IDS.join(", ")}.`);
  }

  return component;
}

export function validateComponentIds(ids) {
  return ids.map((id) => resolveComponent(id).id);
}

export function resolveTargetComponents({ components = null, noDefaultComponents = false }) {
  if (noDefaultComponents) return [];
  if (components != null) {
    return validateComponentIds(components).map((id) => resolveComponent(id));
  }

  return DEFAULT_COMPONENT_IDS.map((id) => resolveComponent(id));
}

export function buildComponentStateEntries(components, adapters) {
  const managedTargets = adapters.map((adapter) => adapter.assets.configFile);

  return components.map((component) => ({
    id: component.id,
    version: component.version,
    managedTargets: [...managedTargets]
  }));
}
