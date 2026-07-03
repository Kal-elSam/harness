import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { hashBuffer } from "../hash.js";

export async function installComponentAssets({ packageRoot, paths, components, dryRun = false }) {
  const coreFiles = {};

  for (const component of components) {
    const installed = await installComponentFiles({
      packageRoot,
      paths,
      component,
      dryRun,
      shouldRepair: () => true
    });
    Object.assign(coreFiles, installed);
  }

  return coreFiles;
}

export async function repairComponentAssets({ packageRoot, paths, components, state, dryRun = false }) {
  const coreFiles = { ...state?.coreFiles };
  const repaired = [];
  const unchanged = [];

  for (const component of components) {
    const installed = await installComponentFiles({
      packageRoot,
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

async function installComponentFiles({ packageRoot, paths, component, dryRun, shouldRepair }) {
  const templateDir = resolve(packageRoot, "global-template", "components", component.id);
  const coreFiles = {};

  if (!existsSync(templateDir)) return coreFiles;

  const entries = await readdir(templateDir);

  for (const entry of entries) {
    const sourcePath = join(templateDir, entry);
    const relativePath = `components/${component.id}/${entry}`;
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
