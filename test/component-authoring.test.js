import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  initWorkspaceComponent,
  validateWorkspaceComponentsCatalog
} from "../src/global/component-authoring.js";
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

test("validate passes with a valid workspace catalog", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  await initWorkspaceComponent({
    workspaceRoot,
    id: "team-rules",
    label: "Team Rules"
  });

  const result = validateWorkspaceComponentsCatalog(workspaceRoot);
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].id, "team-rules");

  const cli = spawnSync(process.execPath, [harnessBin, "components", "validate", "--cwd", workspaceRoot], {
    cwd: packageRoot,
    encoding: "utf8"
  });

  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Workspace component catalog is valid/);
  assert.match(cli.stdout, /team-rules/);
});

test("validate fails clearly for traversal, missing assets, and symlink escape", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const componentsRoot = join(workspaceRoot, ".harness", "components");
  await mkdir(join(componentsRoot, "unsafe"), { recursive: true });
  await writeFile(join(componentsRoot, "catalog.json"), JSON.stringify({
    components: [{
      id: "unsafe",
      label: "Unsafe",
      version: "0.1.0",
      assetFiles: ["../secret.md"]
    }]
  }));

  assert.throws(
    () => validateWorkspaceComponentsCatalog(workspaceRoot),
    /must be a relative path without "\.\."/
  );

  await writeFile(join(componentsRoot, "catalog.json"), JSON.stringify({
    components: [{
      id: "missing-asset",
      label: "Missing",
      version: "0.1.0",
      assetFiles: ["ghost.md"]
    }]
  }));
  await mkdir(join(componentsRoot, "missing-asset"), { recursive: true });

  assert.throws(
    () => validateWorkspaceComponentsCatalog(workspaceRoot),
    /missing asset "ghost\.md"/
  );

  const outsideDir = await mkdtemp(join(tmpdir(), "harness-outside-"));
  const linkedDir = join(componentsRoot, "linked");
  await mkdir(linkedDir, { recursive: true });
  await writeFile(join(outsideDir, "secret.md"), "outside");
  await symlink(join(outsideDir, "secret.md"), join(linkedDir, "linked.md"));
  await writeFile(join(componentsRoot, "catalog.json"), JSON.stringify({
    components: [{
      id: "linked",
      label: "Linked",
      version: "0.1.0",
      assetFiles: ["linked.md"]
    }]
  }));

  assert.throws(
    () => validateWorkspaceComponentsCatalog(workspaceRoot),
    /escapes the workspace via symlink/
  );

  const cli = spawnSync(process.execPath, [harnessBin, "components", "validate", "--cwd", workspaceRoot], {
    cwd: packageRoot,
    encoding: "utf8"
  });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /escapes the workspace via symlink/);
});

test("init creates minimal workspace component structure", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));

  const result = await initWorkspaceComponent({
    workspaceRoot,
    id: "team-rules",
    label: "Team Rules"
  });

  assert.equal(result.entry.id, "team-rules");
  assert.equal(result.entry.version, "0.1.0");
  assert.deepEqual(result.entry.assetFiles, ["README.md"]);
  assert.ok(existsSync(join(workspaceRoot, ".harness", "components", "catalog.json")));
  assert.ok(existsSync(join(workspaceRoot, ".harness", "components", "team-rules", "README.md")));

  const catalog = JSON.parse(
    await readFile(join(workspaceRoot, ".harness", "components", "catalog.json"), "utf8")
  );
  assert.equal(catalog.components.length, 1);
  assert.equal(catalog.components[0].label, "Team Rules");

  const cli = spawnSync(
    process.execPath,
    [harnessBin, "components", "init", "docs-pack", "--label", "Docs Pack", "--cwd", workspaceRoot],
    { cwd: packageRoot, encoding: "utf8" }
  );
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Workspace component created/);
  assert.ok(existsSync(join(workspaceRoot, ".harness", "components", "docs-pack", "README.md")));
});

test("init rejects duplicates, bundled ids, and uppercase ids", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));

  await initWorkspaceComponent({
    workspaceRoot,
    id: "team-rules",
    label: "Team Rules"
  });

  await assert.rejects(
    () => initWorkspaceComponent({ workspaceRoot, id: "team-rules", label: "Again" }),
    /already exists/
  );

  await assert.rejects(
    () => initWorkspaceComponent({ workspaceRoot, id: "orchestrator", label: "Fake" }),
    /conflicts with a bundled component/
  );

  await assert.rejects(
    () => initWorkspaceComponent({ workspaceRoot, id: "Team-Rules", label: "Team Rules" }),
    /Invalid component id "Team-Rules"/
  );

  const duplicateCli = spawnSync(
    process.execPath,
    [harnessBin, "components", "init", "team-rules", "--label", "Again", "--cwd", workspaceRoot],
    { cwd: packageRoot, encoding: "utf8" }
  );
  assert.notEqual(duplicateCli.status, 0);
  assert.match(duplicateCli.stderr, /already exists/);

  const bundledCli = spawnSync(
    process.execPath,
    [harnessBin, "components", "init", "sdd-core", "--label", "Fake", "--cwd", workspaceRoot],
    { cwd: packageRoot, encoding: "utf8" }
  );
  assert.notEqual(bundledCli.status, 0);
  assert.match(bundledCli.stderr, /conflicts with a bundled component/);

  const uppercaseRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const uppercaseCli = spawnSync(
    process.execPath,
    [harnessBin, "components", "init", "Team-Rules", "--label", "Team Rules", "--cwd", uppercaseRoot],
    { cwd: packageRoot, encoding: "utf8" }
  );
  assert.notEqual(uppercaseCli.status, 0);
  assert.match(uppercaseCli.stderr, /Invalid component id "Team-Rules"/);
  assert.equal(existsSync(join(uppercaseRoot, ".harness", "components", "team-rules")), false);
  assert.equal(existsSync(join(uppercaseRoot, ".harness", "components", "Team-Rules")), false);
});

test("install --components uses a component created by init", async () => {
  const homeDir = await createFakeHome();
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const paths = harnessHomePaths(homeDir);

  await initWorkspaceComponent({
    workspaceRoot,
    id: "team-rules",
    label: "Team Rules"
  });

  const result = await installGlobalHarness({
    packageRoot,
    packageName: "@kal-elsam/harness",
    cliVersion: "0.7.0",
    homeDir,
    workspaceRoot,
    components: ["team-rules"],
    noDefaultComponents: true
  });

  assert.deepEqual(result.components, ["team-rules"]);
  assert.ok(existsSync(join(paths.root, "components", "team-rules", "README.md")));

  const content = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.match(content, /### Team Rules/);
});
