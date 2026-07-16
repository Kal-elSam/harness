/** Component Manifest v2 — contract + validation. V1 catalogs normalize in-memory. */

export const COMPONENT_MANIFEST_SCHEMA_VERSION = 2;
export const COMPONENT_KINDS = Object.freeze(["component"]);
export const COMPONENT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
export const COMPONENT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9.-]*$/;
export const HEALTH_CHECK_TYPES = Object.freeze(["assets", "drift", "integration"]);

export function normalizeCatalogDocument(document, {
  source = "bundled",
  bundledIds = [],
  requireDefaultEnabled = source === "bundled"
} = {}) {
  if (!isObject(document)) throw new Error("Component catalog must be a JSON object.");
  const schemaVersion = resolveSchemaVersion(document);
  if (!Array.isArray(document.components)) {
    throw new Error("Component catalog must declare a components array.");
  }
  const components = document.components.map((entry, index) =>
    normalizeManifestEntry(entry, { source, requireDefaultEnabled, index })
  );
  validateCatalogGraph(components, { bundledIds, source });
  return { schemaVersion, components };
}

export function normalizeManifestEntry(entry, {
  source = "bundled",
  requireDefaultEnabled = false,
  index = null
} = {}) {
  if (!isObject(entry)) throw new Error(entryError(index, entry?.id, "must be an object."));
  for (const field of ["id", "label", "version", "assetFiles"]) {
    if (entry[field] === undefined) throw new Error(entryError(index, entry.id, `is missing "${field}".`));
  }
  if (requireDefaultEnabled && entry.defaultEnabled === undefined) {
    throw new Error(entryError(index, entry.id, 'is missing "defaultEnabled".'));
  }

  const id = match(entry.id, COMPONENT_ID_PATTERN)
    ? entry.id
    : fail(entryError(index, entry.id, `has invalid id "${entry.id}". Use lowercase letters, digits, and hyphens.`));
  const label = nonEmpty(entry.label, id, "label");
  const version = match(entry.version, COMPONENT_VERSION_PATTERN)
    ? entry.version
    : fail(`Component "${id}" has invalid version "${entry.version}". Use semver (e.g. 1.0.0).`);
  const kind = entry.kind === undefined
    ? "component"
    : (COMPONENT_KINDS.includes(entry.kind) ? entry.kind : fail(`Component "${id}" has invalid kind "${entry.kind}". Use: ${COMPONENT_KINDS.join(", ")}.`));

  const normalized = {
    schemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
    id,
    kind,
    label,
    version,
    defaultEnabled: Boolean(requireDefaultEnabled ? entry.defaultEnabled : (entry.defaultEnabled ?? false)),
    capabilities: idList(entry.capabilities, id, "capabilities", CAPABILITY_ID_PATTERN),
    dependencies: idList(entry.dependencies, id, "dependencies", COMPONENT_ID_PATTERN),
    healthChecks: healthChecks(entry.healthChecks, id),
    assetFiles: assets(entry.assetFiles, id),
    adapterHints: hints(entry.adapterHints, id)
  };

  if (source === "workspace" && entry.instructions != null) {
    if (typeof entry.instructions !== "string") fail(`Component "${id}" instructions must be a string.`);
    normalized.instructions = entry.instructions;
  }
  return normalized;
}

export function validateCatalogGraph(components, { bundledIds = [], source = "bundled" } = {}) {
  const seen = new Set();
  const ids = new Set(components.map((c) => c.id));
  for (const component of components) {
    if (seen.has(component.id)) fail(`Duplicate component id "${component.id}".`);
    seen.add(component.id);
    if (source === "workspace" && bundledIds.includes(component.id)) {
      fail(`Workspace component "${component.id}" conflicts with a bundled component.`);
    }
    for (const dependency of component.dependencies) {
      if (dependency === component.id) fail(`Component "${component.id}" cannot depend on itself.`);
      if (!ids.has(dependency) && !bundledIds.includes(dependency)) {
        fail(`Component "${component.id}" depends on unknown component "${dependency}".`);
      }
    }
  }
  const cycle = detectDependencyCycles(components);
  if (cycle) fail(`Component dependency cycle detected: ${cycle.join(" -> ")}.`);
}

export function detectDependencyCycles(components) {
  const graph = new Map(components.map((c) => [c.id, c.dependencies]));
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  for (const id of graph.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;

  function visit(id) {
    if (visited.has(id)) return null;
    if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id];
    visiting.add(id);
    stack.push(id);
    for (const dependency of graph.get(id) ?? []) {
      if (!graph.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  }
}

export function assertSafeAssetPath(assetFile, componentId) {
  if (typeof assetFile !== "string" || !assetFile) fail(`Component "${componentId}" has an invalid asset path.`);
  if (assetFile.startsWith("/") || assetFile.includes("\\") || assetFile.includes("..")) {
    fail(`Component "${componentId}" asset "${assetFile}" must be a relative path without "..".`);
  }
  if (assetFile.endsWith("/")) fail(`Component "${componentId}" asset "${assetFile}" must reference a file.`);
  return assetFile;
}

function resolveSchemaVersion(document) {
  if (document.schemaVersion === undefined) return 1;
  const version = document.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > COMPONENT_MANIFEST_SCHEMA_VERSION) {
    fail(`Unsupported component catalog schemaVersion "${version}".`);
  }
  return version;
}

function assets(assetFiles, id) {
  if (!Array.isArray(assetFiles) || assetFiles.length === 0) fail(`Component "${id}" must declare at least one asset file.`);
  return unique(assetFiles.map((asset) => assertSafeAssetPath(asset, id)), id, "asset");
}

function idList(value, id, field, pattern) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`Component "${id}" ${field} must be an array.`);
  return unique(value.map((item) => {
    if (typeof item !== "string" || !pattern.test(item)) fail(`Component "${id}" has invalid ${field} entry "${item}".`);
    return item;
  }), id, field);
}

function healthChecks(value, id) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`Component "${id}" healthChecks must be an array.`);
  const seen = new Set();
  return value.map((check) => {
    if (!isObject(check)) fail(`Component "${id}" healthChecks entries must be objects.`);
    if (typeof check.id !== "string" || !CAPABILITY_ID_PATTERN.test(check.id)) {
      fail(`Component "${id}" healthCheck has invalid id "${check.id}".`);
    }
    if (typeof check.type !== "string" || !HEALTH_CHECK_TYPES.includes(check.type)) {
      fail(`Component "${id}" healthCheck "${check.id}" has invalid type "${check.type}".`);
    }
    if (seen.has(check.id)) fail(`Component "${id}" declares duplicate healthCheck "${check.id}".`);
    seen.add(check.id);
    return { id: check.id, type: check.type, optional: Boolean(check.optional) };
  });
}

function hints(value, id) {
  if (value === undefined) return {};
  if (!isObject(value)) fail(`Component "${id}" adapterHints must be an object.`);
  const normalized = {};
  for (const [key, hint] of Object.entries(value)) {
    if (typeof hint !== "string") fail(`Component "${id}" adapterHints.${key} must be a string.`);
    normalized[key] = hint;
  }
  return normalized;
}

function unique(items, id, field) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item)) fail(`Component "${id}" declares duplicate ${field} entry "${item}".`);
    seen.add(item);
    out.push(item);
  }
  return out;
}

function nonEmpty(value, id, field) {
  if (typeof value !== "string" || !value.trim()) fail(`Component "${id}" ${field} must be a non-empty string.`);
  return value.trim();
}

function match(value, pattern) {
  return typeof value === "string" && pattern.test(value);
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function entryError(index, id, message) {
  return `${id ? `Component "${id}"` : `Component catalog entry${index == null ? "" : ` #${index}`}`} ${message}`;
}

function fail(message) {
  throw new Error(message);
}
