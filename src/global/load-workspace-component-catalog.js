import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { createWorkspaceManagedSectionBuilder } from "./component-builders.js";
import { normalizeCatalogDocument } from "./component-manifest.js";
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
  const { components: entries } = normalizeCatalogDocument(catalog, {
    source: "workspace",
    bundledIds,
    requireDefaultEnabled: false
  });

  return entries.map((entry) => {
    const componentDir = join(componentsRoot, entry.id);

    for (const assetFile of entry.assetFiles) {
      validateAssetPresence(assetFile, {
        componentDir,
        componentId: entry.id,
        workspaceRoot: resolvedRoot
      });
    }

    return {
      ...entry,
      source: "workspace",
      defaultEnabled: false,
      instructions: entry.instructions ?? null,
      workspaceRoot: resolvedRoot,
      buildManagedSection: createWorkspaceManagedSectionBuilder(entry)
    };
  });
}

function validateAssetPresence(assetFile, { componentDir, componentId, workspaceRoot }) {
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
