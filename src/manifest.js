import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const MANIFEST_RELATIVE_PATH = ".harness/manifest.json";

export async function readManifest(projectRoot) {
  const manifestPath = resolve(projectRoot, MANIFEST_RELATIVE_PATH);
  if (!existsSync(manifestPath)) return null;

  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

export async function writeManifest(projectRoot, manifest) {
  const manifestPath = resolve(projectRoot, MANIFEST_RELATIVE_PATH);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function createManifest({ packageName, cliVersion, mode, adapters, files, installedAt }) {
  const now = new Date().toISOString();

  return {
    packageName,
    cliVersion,
    mode,
    adapters,
    installedAt: installedAt ?? now,
    updatedAt: now,
    files
  };
}
