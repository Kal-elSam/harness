import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initWorkspaceComponent, validateWorkspaceComponentsCatalog } from "../src/global/component-authoring.js";
import {
  importWorkspaceComponent,
  packWorkspaceComponent
} from "../src/global/component-distribution.js";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { harnessHomePaths } from "../src/global/paths.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");

async function createFakeHome() {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });
  return homeDir;
}

function runTar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("pack produces a portable component bundle", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const outPath = join(workspaceRoot, "team-rules.tgz");

  await initWorkspaceComponent({
    workspaceRoot,
    id: "team-rules",
    label: "Team Rules"
  });

  const result = await packWorkspaceComponent({
    workspaceRoot,
    id: "team-rules",
    outPath
  });

  assert.equal(result.entry.id, "team-rules");
  assert.ok(existsSync(outPath));

  const list = spawnSync("tar", ["-tzf", outPath], { encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /catalog\.json/);
  assert.match(list.stdout, /team-rules\/README\.md/);
});

test("import into an empty workspace creates catalog and assets", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const bundlePath = join(sourceRoot, "team-rules.tgz");

  await initWorkspaceComponent({
    workspaceRoot: sourceRoot,
    id: "team-rules",
    label: "Team Rules"
  });
  await packWorkspaceComponent({
    workspaceRoot: sourceRoot,
    id: "team-rules",
    outPath: bundlePath
  });

  const result = await importWorkspaceComponent({
    workspaceRoot: targetRoot,
    bundlePath
  });

  assert.equal(result.entry.id, "team-rules");
  assert.ok(existsSync(join(targetRoot, ".harness", "components", "catalog.json")));
  assert.ok(existsSync(join(targetRoot, ".harness", "components", "team-rules", "README.md")));

  const catalog = JSON.parse(
    await readFile(join(targetRoot, ".harness", "components", "catalog.json"), "utf8")
  );
  assert.equal(catalog.components.length, 1);
  assert.equal(catalog.components[0].label, "Team Rules");
});

test("import rejects duplicate component ids", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const bundlePath = join(sourceRoot, "team-rules.tgz");

  await initWorkspaceComponent({
    workspaceRoot: sourceRoot,
    id: "team-rules",
    label: "Team Rules"
  });
  await packWorkspaceComponent({
    workspaceRoot: sourceRoot,
    id: "team-rules",
    outPath: bundlePath
  });
  await initWorkspaceComponent({
    workspaceRoot: targetRoot,
    id: "team-rules",
    label: "Team Rules"
  });

  await assert.rejects(
    () => importWorkspaceComponent({ workspaceRoot: targetRoot, bundlePath }),
    /already exists/
  );
});

test("import rejects bundles with traversal or symlink escape", async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));

  const traversalStaging = await mkdtemp(join(tmpdir(), "harness-bundle-"));
  const traversalBundle = join(traversalStaging, "unsafe.tgz");
  await writeFile(join(traversalStaging, "catalog.json"), JSON.stringify({
    components: [{
      id: "unsafe",
      label: "Unsafe",
      version: "0.1.0",
      assetFiles: ["../secret.md"]
    }]
  }));
  await mkdir(join(traversalStaging, "unsafe"), { recursive: true });
  await writeFile(join(traversalStaging, "secret.md"), "secret");
  runTar(["-czf", traversalBundle, "-C", traversalStaging, "catalog.json", "unsafe", "secret.md"]);

  await assert.rejects(
    () => importWorkspaceComponent({ workspaceRoot: targetRoot, bundlePath: traversalBundle }),
    /must be a relative path without "\.\."|unsafe path|escapes its component directory/
  );

  const symlinkStaging = await mkdtemp(join(tmpdir(), "harness-bundle-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "harness-outside-"));
  const symlinkBundle = join(symlinkStaging, "linked.tgz");
  await writeFile(join(outsideDir, "secret.md"), "outside");
  await mkdir(join(symlinkStaging, "linked"), { recursive: true });
  await writeFile(join(symlinkStaging, "catalog.json"), JSON.stringify({
    components: [{
      id: "linked",
      label: "Linked",
      version: "0.1.0",
      assetFiles: ["linked.md"]
    }]
  }));
  await symlink(join(outsideDir, "secret.md"), join(symlinkStaging, "linked", "linked.md"));
  runTar(["-czf", symlinkBundle, "-C", symlinkStaging, "catalog.json", "linked"]);

  await assert.rejects(
    () => importWorkspaceComponent({ workspaceRoot: targetRoot, bundlePath: symlinkBundle }),
    /escapes the workspace via symlink/
  );

  assert.equal(existsSync(join(targetRoot, ".harness")), false);
});

test("import then validate and install succeed", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);
  const bundlePath = join(sourceRoot, "team-rules.tgz");

  await initWorkspaceComponent({
    workspaceRoot: sourceRoot,
    id: "team-rules",
    label: "Team Rules"
  });
  await packWorkspaceComponent({
    workspaceRoot: sourceRoot,
    id: "team-rules",
    outPath: bundlePath
  });
  await importWorkspaceComponent({
    workspaceRoot: targetRoot,
    bundlePath
  });

  const validated = validateWorkspaceComponentsCatalog(targetRoot);
  assert.equal(validated.components[0].id, "team-rules");

  const validateCli = spawnSync(
    process.execPath,
    [harnessBin, "components", "validate", "--cwd", targetRoot],
    { cwd: packageRoot, encoding: "utf8" }
  );
  assert.equal(validateCli.status, 0, validateCli.stderr);

  const installResult = await installGlobalHarness({
    packageRoot,
    packageName: "@kal-elsam/harness",
    cliVersion: "0.8.0",
    homeDir,
    workspaceRoot: targetRoot,
    components: ["team-rules"],
    noDefaultComponents: true
  });

  assert.deepEqual(installResult.components, ["team-rules"]);
  assert.ok(existsSync(join(paths.root, "components", "team-rules", "README.md")));

  const content = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.match(content, /### Team Rules/);
});

test("components pack and import CLI commands work", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const bundlePath = join(sourceRoot, "docs-pack.tgz");

  const initCli = spawnSync(
    process.execPath,
    [harnessBin, "components", "init", "docs-pack", "--label", "Docs Pack", "--cwd", sourceRoot],
    { cwd: packageRoot, encoding: "utf8" }
  );
  assert.equal(initCli.status, 0, initCli.stderr);

  const packCli = spawnSync(
    process.execPath,
    [harnessBin, "components", "pack", "docs-pack", "--out", bundlePath, "--cwd", sourceRoot],
    { cwd: packageRoot, encoding: "utf8" }
  );
  assert.equal(packCli.status, 0, packCli.stderr);
  assert.match(packCli.stdout, /Workspace component packed/);
  assert.ok(existsSync(bundlePath));

  const importCli = spawnSync(
    process.execPath,
    [harnessBin, "components", "import", bundlePath, "--cwd", targetRoot],
    { cwd: packageRoot, encoding: "utf8" }
  );
  assert.equal(importCli.status, 0, importCli.stderr);
  assert.match(importCli.stdout, /Workspace component imported/);
  assert.ok(existsSync(join(targetRoot, ".harness", "components", "docs-pack", "README.md")));
});
