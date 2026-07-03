import { join, resolve, sep } from "node:path";

export function resolveComponentTemplateDir(component, { packageRoot, workspaceRoot }) {
  if (component.source === "workspace") {
    const root = component.workspaceRoot ?? workspaceRoot;

    if (!root) {
      throw new Error(`Workspace component "${component.id}" requires a workspace root.`);
    }

    return join(resolve(root), ".harness", "components", component.id);
  }

  return join(packageRoot, "global-template", "components", component.id);
}

export function isPathInside(parentPath, candidatePath) {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);

  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}
