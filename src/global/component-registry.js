import { loadComponentCatalog } from "./load-component-catalog.js";
import { loadWorkspaceComponentCatalog } from "./load-workspace-component-catalog.js";

const BUNDLED_COMPONENTS = loadComponentCatalog();

export const DEFAULT_COMPONENT_IDS = BUNDLED_COMPONENTS
  .filter((component) => component.defaultEnabled)
  .map((component) => component.id);

export const COMPONENT_IDS = BUNDLED_COMPONENTS.map((component) => component.id);

function loadWorkspaceComponents(workspaceRoot) {
  if (!workspaceRoot) return [];

  return loadWorkspaceComponentCatalog(workspaceRoot, { bundledIds: COMPONENT_IDS });
}

function mergeComponents(workspaceRoot) {
  return [...BUNDLED_COMPONENTS, ...loadWorkspaceComponents(workspaceRoot)];
}

function formatCatalogEntry(component) {
  return {
    id: component.id,
    label: component.label,
    version: component.version,
    source: component.source ?? "bundled",
    defaultEnabled: component.defaultEnabled,
    assetFiles: [...component.assetFiles],
    adapterHints: Object.keys(component.adapterHints),
    instructions: component.instructions ?? null
  };
}

export function listComponents({ workspaceRoot = null } = {}) {
  return mergeComponents(workspaceRoot);
}

export function describeComponentCatalog({ workspaceRoot = null } = {}) {
  return listComponents({ workspaceRoot }).map(formatCatalogEntry);
}

export function describeBundledComponentCatalog() {
  return BUNDLED_COMPONENTS.map(formatCatalogEntry);
}

export function describeWorkspaceComponentCatalog(workspaceRoot) {
  return loadWorkspaceComponents(workspaceRoot).map(formatCatalogEntry);
}

export function resolveComponent(id, { workspaceRoot = null } = {}) {
  const component = mergeComponents(workspaceRoot).find((candidate) => candidate.id === id);

  if (!component) {
    const available = mergeComponents(workspaceRoot).map((entry) => entry.id);
    throw new Error(`Unknown component "${id}". Use ${available.join(", ")}.`);
  }

  return component;
}

export function validateComponentIds(ids, { workspaceRoot = null } = {}) {
  return ids.map((id) => resolveComponent(id, { workspaceRoot }).id);
}

export function resolveTargetComponents({
  components = null,
  noDefaultComponents = false,
  workspaceRoot = null
} = {}) {
  if (components != null) {
    return validateComponentIds(components, { workspaceRoot }).map((id) => resolveComponent(id, { workspaceRoot }));
  }

  if (noDefaultComponents) return [];

  return DEFAULT_COMPONENT_IDS.map((id) => resolveComponent(id, { workspaceRoot }));
}

export function buildComponentStateEntries(components, adapters) {
  const managedTargets = adapters.map((adapter) => adapter.assets.configFile);

  return components.map((component) => ({
    id: component.id,
    version: component.version,
    source: component.source ?? "bundled",
    managedTargets: [...managedTargets]
  }));
}
