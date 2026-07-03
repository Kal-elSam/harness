import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveComponent } from "./component-registry.js";
import { hashBuffer } from "../hash.js";

export async function installComponentAssets({ packageRoot, paths, components, dryRun = false }) {
  const coreFiles = {};

  for (const component of components) {
    const templateDir = resolve(packageRoot, "global-template", "components", component.id);
    if (!existsSync(templateDir)) continue;

    const entries = await readdir(templateDir);

    for (const entry of entries) {
      const sourcePath = join(templateDir, entry);
      const destinationPath = join(paths.root, "components", component.id, entry);
      const content = await readFile(sourcePath);

      if (!dryRun) {
        await mkdir(dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, content);
      }

      coreFiles[`components/${component.id}/${entry}`] = hashBuffer(content);
    }
  }

  return coreFiles;
}

export function componentFileChecks(paths, state) {
  const componentFiles = Object.entries(state?.coreFiles ?? {})
    .filter(([relativePath]) => relativePath.startsWith("components/"));

  if (componentFiles.length === 0 && (state?.components?.length ?? 0) > 0) {
    return [{
      name: "~/.harness/components",
      status: "missing",
      detail: "Installed components recorded but no component assets found on disk."
    }];
  }

  return componentFiles.map(([relativePath, expectedHash]) => {
    const absolutePath = join(paths.root, relativePath);
    const exists = existsSync(absolutePath);

    if (!exists) {
      return {
        name: `~/.harness/${relativePath}`,
        status: "missing",
        detail: "Tracked component asset missing on disk."
      };
    }

    return {
      name: `~/.harness/${relativePath}`,
      status: "ok",
      detail: expectedHash ? `hash=${expectedHash.slice(0, 8)}` : undefined
    };
  });
}

export async function componentSectionChecks(homeDir, state) {
  const checks = [];

  for (const stateEntry of state?.components ?? []) {
    const component = resolveComponent(stateEntry.id);
    const heading = component.id === "sdd-core" ? "### SDD Core" : "### Orchestrator";
    const targets = stateEntry.managedTargets ?? [];
    let missingTarget = false;
    let staleSection = false;

    for (const configFile of targets) {
      const configPath = join(homeDir, configFile);
      if (!existsSync(configPath)) {
        missingTarget = true;
        continue;
      }

      const content = await readFile(configPath, "utf8");
      if (!content.includes(heading)) staleSection = true;
    }

    let status = "ok";
    let detail = `Managed section present for ${component.id}`;

    if (missingTarget) {
      status = "missing";
      detail = `Managed target missing for ${component.id}`;
    } else if (staleSection) {
      status = "warning";
      detail = `Stale or missing managed section for ${component.id}. Run "harness update".`;
    }

    checks.push({ name: `component:${component.id}`, status, detail });
  }

  return checks;
}
