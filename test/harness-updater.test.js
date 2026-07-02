import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHarness } from "../src/template-installer.js";
import { updateHarness } from "../src/harness-updater.js";
import { detectProject } from "../src/project-detection.js";
import { createProject } from "./test-fixtures.js";

async function setupInstalledFixture() {
  const packageRoot = await mkdtemp(join(tmpdir(), "harness-pkg-"));
  const templateRoot = join(packageRoot, "repo-template", "docs", "ai");
  await mkdir(templateRoot, { recursive: true });

  await writeFile(join(packageRoot, "repo-template", "AGENTS.md"), "# [PROJECT_NAME] v1\n");
  await writeFile(join(templateRoot, "harness.md"), "harness v1\n");
  await writeFile(join(templateRoot, "memory.md"), "memory v1\n");

  const root = await mkdtemp(join(tmpdir(), "harness-project-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "demo-app" }));
  const project = await detectProject(root);

  await installHarness({
    project,
    packageRoot,
    mode: "minimal",
    packageName: "@kal-elsam/harness",
    cliVersion: "0.1.0"
  });

  return { packageRoot, project };
}

test("update applies new template content for unmodified files", async () => {
  const { packageRoot, project } = await setupInstalledFixture();
  await writeFile(join(packageRoot, "repo-template", "AGENTS.md"), "# [PROJECT_NAME] v2\n");

  const result = await updateHarness({
    project,
    packageRoot,
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0"
  });

  assert.ok(result.updated.includes("AGENTS.md"));
  assert.equal(await readFile(join(project.root, "AGENTS.md"), "utf8"), "# demo-app v2\n");
});

test("update skips files modified by the user", async () => {
  const { packageRoot, project } = await setupInstalledFixture();
  await writeFile(join(project.root, "AGENTS.md"), "# customized by user\n");
  await writeFile(join(packageRoot, "repo-template", "AGENTS.md"), "# [PROJECT_NAME] v2\n");

  const result = await updateHarness({
    project,
    packageRoot,
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0"
  });

  assert.ok(result.skippedModified.includes("AGENTS.md"));
  assert.equal(await readFile(join(project.root, "AGENTS.md"), "utf8"), "# customized by user\n");
});

test("update --force overwrites files modified by the user", async () => {
  const { packageRoot, project } = await setupInstalledFixture();
  await writeFile(join(project.root, "AGENTS.md"), "# customized by user\n");
  await writeFile(join(packageRoot, "repo-template", "AGENTS.md"), "# [PROJECT_NAME] v2\n");

  const result = await updateHarness({
    project,
    packageRoot,
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0",
    force: true
  });

  assert.ok(result.updated.includes("AGENTS.md"));
  assert.equal(await readFile(join(project.root, "AGENTS.md"), "utf8"), "# demo-app v2\n");
});

test("update --dry-run previews changes without writing", async () => {
  const { packageRoot, project } = await setupInstalledFixture();
  await writeFile(join(packageRoot, "repo-template", "AGENTS.md"), "# [PROJECT_NAME] v2\n");

  const result = await updateHarness({
    project,
    packageRoot,
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0",
    dryRun: true
  });

  assert.ok(result.updated.includes("AGENTS.md"));
  assert.equal(await readFile(join(project.root, "AGENTS.md"), "utf8"), "# demo-app v1\n");
});

test("update creates files added in later template versions", async () => {
  const { packageRoot, project } = await setupInstalledFixture();
  await writeFile(join(packageRoot, "repo-template", "docs", "ai", "git-workflow.md"), "git workflow doc\n");

  const result = await updateHarness({
    project,
    packageRoot,
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0"
  });

  assert.ok(result.created.includes("docs/ai/git-workflow.md"));
});

test("update fails clearly when no manifest exists yet", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "harness-pkg-"));
  await mkdir(join(packageRoot, "repo-template"), { recursive: true });
  const project = await createProject();

  await assert.rejects(
    () => updateHarness({ project, packageRoot, packageName: "@kal-elsam/harness", cliVersion: "0.2.0" }),
    /harness init/
  );
});
