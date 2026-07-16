import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { COMPONENT_IDS } from "./component-registry.js";
import {
  hasWorkspaceCatalog,
  loadWorkspaceComponentCatalog,
  readWorkspaceCatalogDocument,
  workspaceCatalogPath
} from "./load-workspace-component-catalog.js";
import { formatCliCommand } from "./brand/cli.js";

const COMPONENT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const DEFAULT_VERSION = "0.1.0";
const DEFAULT_ASSET = "README.md";

export function validateWorkspaceComponentsCatalog(workspaceRoot) {
  const root = resolve(workspaceRoot);

  if (!hasWorkspaceCatalog(root)) {
    throw new Error("No workspace catalog at .harness/components/catalog.json");
  }

  const components = loadWorkspaceComponentCatalog(root, { bundledIds: COMPONENT_IDS });

  return {
    workspaceRoot: root,
    catalogPath: workspaceCatalogPath(root),
    components
  };
}

export async function initWorkspaceComponent({ workspaceRoot, id, label }) {
  const root = resolve(workspaceRoot);
  const componentId = normalizeComponentId(id);
  const componentLabel = normalizeLabel(label);

  if (COMPONENT_IDS.includes(componentId)) {
    throw new Error(`Component id "${componentId}" conflicts with a bundled component.`);
  }

  const componentsRoot = join(root, ".harness", "components");
  const componentDir = join(componentsRoot, componentId);
  const assetPath = join(componentDir, DEFAULT_ASSET);
  const catalogPath = workspaceCatalogPath(root);
  const catalog = hasWorkspaceCatalog(root)
    ? readWorkspaceCatalogDocument(root)
    : { components: [] };

  if (!Array.isArray(catalog.components)) {
    throw new Error("Workspace component catalog must declare a components array.");
  }

  if (catalog.components.some((entry) => entry.id === componentId)) {
    throw new Error(`Workspace component "${componentId}" already exists.`);
  }

  if (existsSync(componentDir)) {
    throw new Error(`Component directory already exists: .harness/components/${componentId}`);
  }

  const entry = {
    id: componentId,
    label: componentLabel,
    version: DEFAULT_VERSION,
    assetFiles: [DEFAULT_ASSET]
  };

  await mkdir(componentDir, { recursive: true });
  await writeFile(assetPath, buildDefaultReadme(componentLabel, componentId));
  catalog.components.push(entry);
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

  return {
    workspaceRoot: root,
    catalogPath,
    componentDir,
    assetPath,
    entry
  };
}

function normalizeComponentId(id) {
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("Component id is required.");
  }

  const componentId = id.trim();

  if (!COMPONENT_ID_PATTERN.test(componentId)) {
    throw new Error(
      `Invalid component id "${id}". Use lowercase letters, digits, and hyphens (e.g. team-rules).`
    );
  }

  return componentId;
}

function normalizeLabel(label) {
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new Error(`Missing --label. Use: ${formatCliCommand('components init <id> --label "My Label"')}`);
  }

  return label.trim();
}

function buildDefaultReadme(label, id) {
  return [
    `# ${label}`,
    "",
    `Workspace component \`${id}\`.`,
    "",
    "Edit this file, then run:",
    "",
    "```bash",
    formatCliCommand("components validate"),
    formatCliCommand(`install --components ${id}`),
    "```",
    ""
  ].join("\n");
}
