import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { createWorkspaceManagedSectionBuilder } from "./component-builders.js";
import { isPathInside } from "./component-paths.js";

export function workspaceCatalogPath(workspaceRoot) {
  return join(resolve(workspaceRoot), ".harness", "components", "catalog.json");
}

export function hasWorkspaceCatalog(workspaceRoot) {
  if (!workspaceRoot) return false;
  return existsSync(workspaceCatalogPath(workspaceRoot));
}

export function readWorkspaceCatalogDocument(workspaceRoot) {
  return JSON.parse(readFileSync(workspaceCatalogPath(workspaceRoot), "utf8"));
}

export function loadWorkspaceComponentCatalog(workspaceRoot, { bundledIds = [] } = {}) {
  if (!workspaceRoot || !hasWorkspaceCatalog(workspaceRoot)) {
    return [];
  }

  const resolvedRoot = resolve(workspaceRoot);
  const catalog = readWorkspaceCatalogDocument(resolvedRoot);
  const componentsRoot = join(resolvedRoot, ".harness", "components");
  const entries = catalog.components;

  if (!Array.isArray(entries)) {
    throw new Error("Workspace component catalog must declare a components array.");
  }

  const seen = new Set();
  const components = [];

  for (const entry of entries) {
    validateWorkspaceEntry(entry, { componentsRoot, workspaceRoot: resolvedRoot, bundledIds, seen });
    seen.add(entry.id);

    components.push({
      id: entry.id,
      label: entry.label,
      version: entry.version,
      source: "workspace",
      defaultEnabled: false,
      assetFiles: [...entry.assetFiles],
      adapterHints: { ...(entry.adapterHints ?? {}) },
      instructions: entry.instructions ?? null,
      workspaceRoot: resolvedRoot,
      buildManagedSection: createWorkspaceManagedSectionBuilder(entry)
    });
  }

  return components;
}

function validateWorkspaceEntry(entry, { componentsRoot, workspaceRoot, bundledIds, seen }) {
  const required = ["id", "label", "version", "assetFiles"];

  for (const field of required) {
    if (entry[field] === undefined) {
      throw new Error(`Workspace component catalog entry is missing "${field}".`);
    }
  }

  if (!Array.isArray(entry.assetFiles) || entry.assetFiles.length === 0) {
    throw new Error(`Workspace component "${entry.id}" must declare at least one asset file.`);
  }

  if (bundledIds.includes(entry.id)) {
    throw new Error(`Workspace component "${entry.id}" conflicts with a bundled component.`);
  }

  if (seen.has(entry.id)) {
    throw new Error(`Duplicate workspace component id "${entry.id}".`);
  }

  const componentDir = join(componentsRoot, entry.id);

  for (const assetFile of entry.assetFiles) {
    validateAssetFile(assetFile, { componentDir, componentId: entry.id, workspaceRoot });
  }
}

function validateAssetFile(assetFile, { componentDir, componentId, workspaceRoot }) {
  if (typeof assetFile !== "string" || assetFile.length === 0) {
    throw new Error(`Workspace component "${componentId}" has an invalid asset path.`);
  }

  if (assetFile.startsWith("/") || assetFile.includes("\\") || assetFile.includes("..")) {
    throw new Error(`Workspace component "${componentId}" asset "${assetFile}" must be a relative path without "..".`);
  }

  if (assetFile.endsWith("/")) {
    throw new Error(`Workspace component "${componentId}" asset "${assetFile}" must reference a file.`);
  }

  const assetPath = join(componentDir, ...assetFile.split("/"));
  const normalized = resolve(assetPath);

  if (!isPathInside(componentDir, normalized)) {
    throw new Error(`Workspace component "${componentId}" asset "${assetFile}" escapes its component directory.`);
  }

  if (!existsSync(assetPath)) {
    throw new Error(`Workspace component "${componentId}" is missing asset "${assetFile}".`);
  }

  if (lstatSync(assetPath).isDirectory()) {
    throw new Error(`Workspace component "${componentId}" asset "${assetFile}" must reference a file.`);
  }

  assertAssetStaysInWorkspace(assetPath, workspaceRoot, componentId, assetFile);
}

function assertAssetStaysInWorkspace(assetPath, workspaceRoot, componentId, assetFile) {
  const workspaceReal = realpathSync(workspaceRoot);
  const assetReal = realpathSync(assetPath);

  if (!isPathInside(workspaceReal, assetReal)) {
    throw new Error(`Workspace component "${componentId}" asset "${assetFile}" escapes the workspace via symlink.`);
  }
}
