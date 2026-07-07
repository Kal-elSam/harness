import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  COMPONENT_IDS,
  describeWorkspaceComponentCatalog,
  listComponents,
  resolveComponent,
  resolveTargetComponents
} from "../src/global/component-registry.js";
import { loadWorkspaceComponentCatalog } from "../src/global/load-workspace-component-catalog.js";
import { installGlobalHarness, uninstallGlobalHarness } from "../src/global/global-installer.js";
import { runGlobalDoctorChecks } from "../src/global/global-doctor.js";
import { hasManagedSection } from "../src/global/managed-section.js";
import { harnessHomePaths } from "../src/global/paths.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const baseOptions = { packageRoot, packageName: "@kal-elsam/kairo-runtime", cliVersion: "0.6.0" };

async function createFakeHome() {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });
  return homeDir;
}

async function writeWorkspaceCatalog(workspaceRoot, components, { skipAssets = [] } = {}) {
  const componentsRoot = join(workspaceRoot, ".harness", "components");
  await mkdir(componentsRoot, { recursive: true });

  for (const component of components) {
    const componentDir = join(componentsRoot, component.id);
    await mkdir(componentDir, { recursive: true });

    for (const assetFile of component.assetFiles) {
      if (skipAssets.includes(assetFile)) continue;
      const assetDir = dirname(join(componentDir, assetFile));
      await mkdir(assetDir, { recursive: true });
      await writeFile(join(componentDir, assetFile), `# ${component.id}:${assetFile}\n`);
    }
  }

  await writeFile(join(componentsRoot, "catalog.json"), `${JSON.stringify({ components }, null, 2)}\n`);
}

test("detects a valid workspace component catalog", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));

  await writeWorkspaceCatalog(workspaceRoot, [{
    id: "team-rules",
    label: "Team Rules",
    version: "0.1.0",
    assetFiles: ["rules.md"],
    instructions: "Follow team conventions."
  }]);

  const catalog = loadWorkspaceComponentCatalog(workspaceRoot);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].source, "workspace");
  assert.equal(catalog[0].label, "Team Rules");

  const merged = listComponents({ workspaceRoot });
  assert.equal(merged.length, 3);
  assert.deepEqual(describeWorkspaceComponentCatalog(workspaceRoot).map((entry) => entry.id), ["team-rules"]);
});

test("rejects workspace id that conflicts with bundled component", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));

  await writeWorkspaceCatalog(workspaceRoot, [{
    id: "orchestrator",
    label: "Fake Orchestrator",
    version: "9.9.9",
    assetFiles: ["rules.md"]
  }]);

  assert.throws(
    () => loadWorkspaceComponentCatalog(workspaceRoot, { bundledIds: COMPONENT_IDS }),
    /conflicts with a bundled component/
  );
});

test("rejects path traversal and missing workspace assets", async () => {
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
    () => loadWorkspaceComponentCatalog(workspaceRoot),
    /must be a relative path without "\.\."/
  );

  await writeWorkspaceCatalog(workspaceRoot, [{
    id: "missing-asset",
    label: "Missing Asset",
    version: "0.1.0",
    assetFiles: ["present.md", "ghost.md"]
  }], { skipAssets: ["ghost.md"] });

  assert.throws(
    () => loadWorkspaceComponentCatalog(workspaceRoot),
    /missing asset "ghost\.md"/
  );
});

test("rejects workspace assets that escape via symlink", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "harness-outside-"));
  const componentsRoot = join(workspaceRoot, ".harness", "components");
  const componentDir = join(componentsRoot, "linked");
  await mkdir(componentDir, { recursive: true });
  await writeFile(join(outsideDir, "secret.md"), "outside");
  await symlink(join(outsideDir, "secret.md"), join(componentDir, "linked.md"));
  await writeFile(join(componentsRoot, "catalog.json"), JSON.stringify({
    components: [{
      id: "linked",
      label: "Linked",
      version: "0.1.0",
      assetFiles: ["linked.md"]
    }]
  }));

  assert.throws(
    () => loadWorkspaceComponentCatalog(workspaceRoot),
    /escapes the workspace via symlink/
  );
});

test("installs workspace component assets under ~/.harness/components/<id>/", async () => {
  const homeDir = await createFakeHome();
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const paths = harnessHomePaths(homeDir);

  await writeWorkspaceCatalog(workspaceRoot, [{
    id: "team-rules",
    label: "Team Rules",
    version: "0.1.0",
    assetFiles: ["rules.md"],
    instructions: "Follow team conventions."
  }]);

  const result = await installGlobalHarness({
    ...baseOptions,
    homeDir,
    workspaceRoot,
    components: ["team-rules"],
    noDefaultComponents: true
  });

  assert.deepEqual(result.components, ["team-rules"]);
  assert.ok(existsSync(join(paths.root, "components", "team-rules", "rules.md")));

  const content = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.match(content, /### Team Rules/);
  assert.match(content, /rules\.md:/);
  assert.match(content, /Follow team conventions\./);

  const component = resolveComponent("team-rules", { workspaceRoot });
  assert.match(
    component.buildManagedSection({ componentsDir: join(paths.root, "components") }, { assets: { configFile: ".cursor/AGENTS.md" } }),
    /Team Rules/
  );
});

test("doctor detects drift for workspace component assets", async () => {
  const homeDir = await createFakeHome();
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const paths = harnessHomePaths(homeDir);

  await writeWorkspaceCatalog(workspaceRoot, [{
    id: "team-rules",
    label: "Team Rules",
    version: "0.1.0",
    assetFiles: ["rules.md"]
  }]);

  await installGlobalHarness({
    ...baseOptions,
    homeDir,
    workspaceRoot,
    components: ["team-rules"],
    noDefaultComponents: true
  });

  const healthy = await runGlobalDoctorChecks(homeDir, { packageRoot, workspaceRoot });
  assert.equal(
    healthy.checks.find((check) => check.name === "~/.harness/components/team-rules/rules.md").status,
    "ok"
  );

  await writeFile(join(paths.root, "components", "team-rules", "rules.md"), "tampered");

  const stale = await runGlobalDoctorChecks(homeDir, { packageRoot, workspaceRoot });
  assert.equal(
    stale.checks.find((check) => check.name === "~/.harness/components/team-rules/rules.md").status,
    "stale"
  );
});

test("uninstall removes workspace managed sections and copied components", async () => {
  const homeDir = await createFakeHome();
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));
  const paths = harnessHomePaths(homeDir);

  await writeWorkspaceCatalog(workspaceRoot, [{
    id: "team-rules",
    label: "Team Rules",
    version: "0.1.0",
    assetFiles: ["rules.md"]
  }]);

  await installGlobalHarness({
    ...baseOptions,
    homeDir,
    workspaceRoot,
    components: ["team-rules"],
    noDefaultComponents: true
  });

  const result = await uninstallGlobalHarness({ homeDir });
  assert.deepEqual(result.components, ["team-rules"]);
  assert.equal(existsSync(join(paths.root, "components")), false);

  const content = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.ok(!hasManagedSection(content));
  assert.ok(!content.includes("Team Rules"));
});

test("harness components lists bundled and workspace catalogs", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));

  await writeWorkspaceCatalog(workspaceRoot, [{
    id: "team-rules",
    label: "Team Rules",
    version: "0.1.0",
    assetFiles: ["rules.md"]
  }]);

  const result = spawnSync(process.execPath, [harnessBin, "components", "--cwd", workspaceRoot], {
    cwd: packageRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Bundled: 2/);
  assert.match(result.stdout, /Workspace: 1/);
  assert.match(result.stdout, /team-rules \(0\.1\.0\) \[workspace\]/);
});

test("resolveTargetComponents resolves bundled and workspace ids together", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-workspace-"));

  await writeWorkspaceCatalog(workspaceRoot, [{
    id: "team-rules",
    label: "Team Rules",
    version: "0.1.0",
    assetFiles: ["rules.md"]
  }]);

  const targets = resolveTargetComponents({
    components: ["orchestrator", "team-rules"],
    workspaceRoot
  });

  assert.deepEqual(targets.map((component) => component.id), ["orchestrator", "team-rules"]);
  assert.equal(targets[0].source, "bundled");
  assert.equal(targets[1].source, "workspace");
});
