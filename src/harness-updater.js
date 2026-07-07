import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { COMPATIBILITY_LINKS, MODES, adapterForPath, listTemplateFiles, pathExists, renderFileContent } from "./harness-files.js";
import { hashBuffer } from "./hash.js";
import { createManifest, readManifest, writeManifest } from "./manifest.js";
import { formatCliCommand } from "./global/brand/cli.js";

export async function updateHarness({ project, packageRoot, packageName, cliVersion, mode, adapters, force = false, dryRun = false }) {
  const manifest = await readManifest(project.root);

  if (!manifest) {
    throw new Error(`No .harness/manifest.json found. Run "${formatCliCommand("init")}" first.`);
  }

  const effectiveMode = mode ?? manifest.mode;

  if (!MODES.has(effectiveMode)) {
    throw new Error(`Invalid mode "${effectiveMode}". Use minimal, standard, or enterprise.`);
  }

  const effectiveAdapters = adapters == null ? manifest.adapters ?? null : [...adapters].sort();
  const templateFiles = await listTemplateFiles(packageRoot, effectiveMode, { adapters: effectiveAdapters });
  const result = {
    mode: effectiveMode,
    adapters: effectiveAdapters,
    created: [],
    updated: [],
    unchanged: [],
    skippedModified: [],
    skippedUntracked: []
  };
  const nextFiles = { ...manifest.files };

  for (const { relativePath, sourcePath } of templateFiles) {
    await reconcileFile({ project, relativePath, sourcePath, manifest, force, dryRun, result, nextFiles });
  }

  await createMissingCompatibilityLinks(project.root, { adapters: effectiveAdapters, dryRun, result });

  if (!dryRun) {
    await writeManifest(project.root, createManifest({
      packageName: manifest.packageName ?? packageName,
      cliVersion,
      mode: effectiveMode,
      adapters: effectiveAdapters,
      files: nextFiles,
      installedAt: manifest.installedAt
    }));
  }

  return result;
}

async function reconcileFile({ project, relativePath, sourcePath, manifest, force, dryRun, result, nextFiles }) {
  const destinationPath = resolve(project.root, relativePath);
  const newContent = await renderFileContent(sourcePath, project);
  const newHash = hashBuffer(newContent);
  const exists = await pathExists(destinationPath);

  if (!exists) {
    if (!dryRun) await writeManagedFile(destinationPath, newContent);
    result.created.push(relativePath);
    nextFiles[relativePath] = newHash;
    return;
  }

  const trackedHash = manifest.files[relativePath];
  const currentHash = hashBuffer(await readFile(destinationPath));
  const isUnmodifiedSinceInstall = Boolean(trackedHash) && trackedHash === currentHash;

  if (isUnmodifiedSinceInstall) {
    nextFiles[relativePath] = newHash;

    if (currentHash === newHash) {
      result.unchanged.push(relativePath);
    } else {
      if (!dryRun) await writeManagedFile(destinationPath, newContent);
      result.updated.push(relativePath);
    }

    return;
  }

  if (!force) {
    result[trackedHash ? "skippedModified" : "skippedUntracked"].push(relativePath);
    return;
  }

  if (!dryRun) await writeManagedFile(destinationPath, newContent);
  result.updated.push(relativePath);
  nextFiles[relativePath] = newHash;
}

async function writeManagedFile(destinationPath, content) {
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, content);
}

async function createMissingCompatibilityLinks(root, { adapters, dryRun, result }) {
  for (const [linkPath, target] of COMPATIBILITY_LINKS) {
    const adapter = adapterForPath(linkPath);
    if (adapters && adapter && !adapters.includes(adapter)) continue;

    const destination = resolve(root, linkPath);
    const exists = await pathExists(destination);

    if (exists) continue;

    if (!dryRun) {
      await mkdir(dirname(destination), { recursive: true });
      try {
        await symlink(target, destination);
      } catch {
        await writeFile(destination, `Compatibility pointer. Source of truth: ${target}\n`, "utf8");
      }
    }

    result.created.push(linkPath);
  }
}
