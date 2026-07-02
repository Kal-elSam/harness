import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { COMPATIBILITY_LINKS, adapterForPath, listTemplateFiles, pathExists, renderFileContent } from "./harness-files.js";
import { hashBuffer } from "./hash.js";
import { createManifest, readManifest, writeManifest } from "./manifest.js";

export async function installHarness({ project, packageRoot, mode, adapters, packageName, cliVersion, force = false, dryRun = false }) {
  const templateFiles = await listTemplateFiles(packageRoot, mode, { adapters });
  const normalizedAdapters = adapters == null ? null : [...adapters].sort();
  const result = { mode, adapters: normalizedAdapters, created: [], skipped: [], updated: [] };
  const manifestFiles = {};

  for (const { relativePath, sourcePath } of templateFiles) {
    const destinationPath = resolve(project.root, relativePath);
    const exists = await pathExists(destinationPath);

    if (exists && !force) {
      result.skipped.push(relativePath);
      continue;
    }

    const content = await renderFileContent(sourcePath, project);

    if (!dryRun) {
      await mkdir(dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, content);
    }

    result[exists ? "updated" : "created"].push(relativePath);
    manifestFiles[relativePath] = hashBuffer(content);
  }

  await createCompatibilityLinks(project.root, { adapters: normalizedAdapters, force, dryRun, result });

  if (!dryRun) {
    const existingManifest = await readManifest(project.root);
    await writeManifest(project.root, createManifest({
      packageName,
      cliVersion,
      mode,
      adapters: normalizedAdapters ?? existingManifest?.adapters,
      files: { ...existingManifest?.files, ...manifestFiles },
      installedAt: existingManifest?.installedAt
    }));
  }

  return result;
}

async function createCompatibilityLinks(root, { adapters, force, dryRun, result }) {
  for (const [linkPath, target] of COMPATIBILITY_LINKS) {
    const adapter = adapterForPath(linkPath);
    if (adapters && adapter && !adapters.includes(adapter)) continue;

    const destination = resolve(root, linkPath);
    const exists = await pathExists(destination);

    if (exists && !force) continue;

    if (!dryRun) {
      await mkdir(dirname(destination), { recursive: true });
      if (exists) continue;
      try {
        await symlink(target, destination);
      } catch {
        await writeFile(destination, `Compatibility pointer. Source of truth: ${target}\n`, "utf8");
      }
    }

    if (!exists) result.created.push(linkPath);
  }
}
