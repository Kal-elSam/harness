import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashBuffer } from "../hash.js";
import { resolveComponentTemplateDir } from "./component-paths.js";

export async function installComponentAssets({ packageRoot, workspaceRoot = null, paths, components, dryRun = false }) {
  const coreFiles = {};

  for (const component of components) {
    const installed = await installComponentFiles({
      packageRoot,
      workspaceRoot,
      paths,
      component,
      dryRun,
      shouldRepair: () => true
    });
    Object.assign(coreFiles, installed);
  }

  return coreFiles;
}

export async function repairComponentAssets({
  packageRoot,
  workspaceRoot = null,
  paths,
  components,
  state,
  dryRun = false
}) {
  const coreFiles = { ...state?.coreFiles };
  const repaired = [];
  const unchanged = [];

  for (const component of components) {
    const installed = await installComponentFiles({
      packageRoot,
      workspaceRoot,
      paths,
      component,
      dryRun,
      shouldRepair: async (relativePath, destinationPath, templateContent) => {
        const expectedHash = hashBuffer(templateContent);

        if (!existsSync(destinationPath)) {
          repaired.push(relativePath);
          return true;
        }

        const diskContent = await readFile(destinationPath);
        const diskHash = hashBuffer(diskContent);
        const trackedHash = state?.coreFiles?.[relativePath];

        if (diskHash !== expectedHash || trackedHash !== expectedHash) {
          repaired.push(relativePath);
          return true;
        }

        unchanged.push(relativePath);
        return false;
      }
    });

    Object.assign(coreFiles, installed);
  }

  return { coreFiles, repaired, unchanged };
}

async function installComponentFiles({
  packageRoot,
  workspaceRoot,
  paths,
  component,
  dryRun,
  shouldRepair
}) {
  const templateDir = resolveComponentTemplateDir(component, { packageRoot, workspaceRoot });
  const coreFiles = {};

  if (!existsSync(templateDir)) return coreFiles;

  for (const assetFile of component.assetFiles) {
    const sourcePath = join(templateDir, assetFile);
    const relativePath = `components/${component.id}/${assetFile}`;
    const destinationPath = join(paths.root, relativePath);
    const content = await readFile(sourcePath);
    const needsRepair = await shouldRepair(relativePath, destinationPath, content);

    if (!needsRepair) {
      coreFiles[relativePath] = hashBuffer(content);
      continue;
    }

    if (!dryRun) {
      await mkdir(dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, content);
    }

    coreFiles[relativePath] = hashBuffer(content);
  }

  return coreFiles;
}
