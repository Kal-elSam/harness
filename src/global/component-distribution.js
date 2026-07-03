import { spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isPathInside } from "./component-paths.js";
import { COMPONENT_IDS } from "./component-registry.js";
import {
  hasWorkspaceCatalog,
  loadWorkspaceComponentCatalog,
  readWorkspaceCatalogDocument,
  workspaceCatalogPath
} from "./load-workspace-component-catalog.js";

export async function packWorkspaceComponent({ workspaceRoot, id, outPath }) {
  const root = resolve(workspaceRoot);
  const outputPath = resolve(outPath);

  if (!id || typeof id !== "string") {
    throw new Error("Component id is required.");
  }

  if (!outPath || typeof outPath !== "string") {
    throw new Error("Missing --out. Use: harness components pack <id> --out <file>");
  }

  const components = loadWorkspaceComponentCatalog(root, { bundledIds: COMPONENT_IDS });
  const component = components.find((entry) => entry.id === id);

  if (!component) {
    throw new Error(`Unknown workspace component "${id}".`);
  }

  const entry = serializeCatalogEntry(component);
  const stagingDir = await mkdtemp(join(tmpdir(), "harness-pack-"));

  try {
    await writeFile(join(stagingDir, "catalog.json"), `${JSON.stringify({ components: [entry] }, null, 2)}\n`);

    const sourceDir = join(root, ".harness", "components", component.id);
    const stagedComponentDir = join(stagingDir, component.id);
    await mkdir(stagedComponentDir, { recursive: true });

    for (const assetFile of entry.assetFiles) {
      const destination = join(stagedComponentDir, assetFile);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(sourceDir, assetFile), destination);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    runTar(["-czf", outputPath, "-C", stagingDir, "catalog.json", component.id]);

    return {
      outPath: outputPath,
      entry
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

export async function importWorkspaceComponent({ workspaceRoot, bundlePath }) {
  const root = resolve(workspaceRoot);
  const archivePath = resolve(bundlePath);

  if (!existsSync(archivePath)) {
    throw new Error(`Bundle not found: ${bundlePath}`);
  }

  assertSafeArchiveMembers(listTarMembers(archivePath));

  const extractDir = await mkdtemp(join(tmpdir(), "harness-import-"));

  try {
    runTar(["-xzf", archivePath, "-C", extractDir]);

    const catalogPath = join(extractDir, "catalog.json");
    if (!existsSync(catalogPath)) {
      throw new Error("Bundle is missing catalog.json.");
    }

    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    if (!Array.isArray(catalog.components) || catalog.components.length !== 1) {
      throw new Error("Component bundle must declare exactly one component.");
    }

    const entry = catalog.components[0];
    assertCatalogEntryShape(entry);

    if (COMPONENT_IDS.includes(entry.id)) {
      throw new Error(`Workspace component "${entry.id}" conflicts with a bundled component.`);
    }

    const targetCatalog = hasWorkspaceCatalog(root)
      ? readWorkspaceCatalogDocument(root)
      : { components: [] };

    if (!Array.isArray(targetCatalog.components)) {
      throw new Error("Workspace component catalog must declare a components array.");
    }

    if (targetCatalog.components.some((candidate) => candidate.id === entry.id)) {
      throw new Error(`Workspace component "${entry.id}" already exists.`);
    }

    const componentsRoot = join(root, ".harness", "components");
    const targetComponentDir = join(componentsRoot, entry.id);

    if (existsSync(targetComponentDir)) {
      throw new Error(`Component directory already exists: .harness/components/${entry.id}`);
    }

    const validationRoot = await mkdtemp(join(tmpdir(), "harness-import-validate-"));

    try {
      const validationComponentsRoot = join(validationRoot, ".harness", "components");
      const validationComponentDir = join(validationComponentsRoot, entry.id);
      await mkdir(validationComponentDir, { recursive: true });
      await writeFile(
        join(validationComponentsRoot, "catalog.json"),
        `${JSON.stringify({ components: [entry] }, null, 2)}\n`
      );

      for (const assetFile of entry.assetFiles) {
        const sourcePath = join(extractDir, entry.id, assetFile);
        assertDeclaredBundleAsset(sourcePath, entry.id, assetFile, extractDir);

        const destination = join(validationComponentDir, assetFile);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(sourcePath, destination);
      }

      loadWorkspaceComponentCatalog(validationRoot, { bundledIds: COMPONENT_IDS });

      await mkdir(targetComponentDir, { recursive: true });

      for (const assetFile of entry.assetFiles) {
        const destination = join(targetComponentDir, assetFile);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(join(extractDir, entry.id, assetFile), destination);
      }

      targetCatalog.components.push(entry);
      await mkdir(componentsRoot, { recursive: true });
      await writeFile(workspaceCatalogPath(root), `${JSON.stringify(targetCatalog, null, 2)}\n`);

      loadWorkspaceComponentCatalog(root, { bundledIds: COMPONENT_IDS });
    } finally {
      await rm(validationRoot, { recursive: true, force: true });
    }

    return {
      workspaceRoot: root,
      catalogPath: workspaceCatalogPath(root),
      entry
    };
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }
}

function serializeCatalogEntry(component) {
  const entry = {
    id: component.id,
    label: component.label,
    version: component.version,
    assetFiles: [...component.assetFiles]
  };

  if (component.instructions) {
    entry.instructions = component.instructions;
  }

  if (component.adapterHints && Object.keys(component.adapterHints).length > 0) {
    entry.adapterHints = { ...component.adapterHints };
  }

  return entry;
}

function assertCatalogEntryShape(entry) {
  for (const field of ["id", "label", "version", "assetFiles"]) {
    if (entry?.[field] === undefined) {
      throw new Error(`Bundle catalog entry is missing "${field}".`);
    }
  }

  if (!Array.isArray(entry.assetFiles) || entry.assetFiles.length === 0) {
    throw new Error(`Bundle component "${entry.id}" must declare at least one asset file.`);
  }
}

function assertDeclaredBundleAsset(sourcePath, componentId, assetFile, extractDir) {
  if (!existsSync(sourcePath)) {
    throw new Error(`Bundle is missing declared asset "${assetFile}".`);
  }

  const stats = lstatSync(sourcePath);
  if (stats.isSymbolicLink()) {
    throw new Error(
      `Bundle component "${componentId}" asset "${assetFile}" escapes the workspace via symlink.`
    );
  }

  if (stats.isDirectory()) {
    throw new Error(`Bundle component "${componentId}" asset "${assetFile}" must reference a file.`);
  }

  const allowedRoot = resolve(extractDir, componentId);
  if (!isPathInside(allowedRoot, sourcePath)) {
    throw new Error(
      `Bundle component "${componentId}" asset "${assetFile}" escapes its component directory.`
    );
  }
}

function listTarMembers(archivePath) {
  const stdout = runTar(["-tzf", archivePath]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function assertSafeArchiveMembers(members) {
  if (members.length === 0) {
    throw new Error("Bundle is empty.");
  }

  for (const member of members) {
    const normalized = member.replaceAll("\\", "/").replace(/\/+$/, "");

    if (!normalized) {
      throw new Error(`Bundle contains an unsafe path "${member}".`);
    }

    if (
      normalized.startsWith("/")
      || normalized.includes("..")
      || normalized.split("/").some((part) => part === ".." || part === "")
    ) {
      throw new Error(`Bundle contains an unsafe path "${member}".`);
    }
  }
}

function runTar(args) {
  const result = spawnSync("tar", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });

  if (result.error) {
    throw new Error(`Failed to run tar: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "tar failed").trim());
  }

  return result.stdout ?? "";
}
