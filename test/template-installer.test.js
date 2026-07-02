import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installHarness } from "../src/template-installer.js";
import { readManifest } from "../src/manifest.js";
import { createFixturePackageRoot, createProject } from "./test-fixtures.js";

test("installs only whitelisted files in minimal mode", async () => {
  const packageRoot = await createFixturePackageRoot();
  const project = await createProject();

  const result = await installHarness({
    project,
    packageRoot,
    mode: "minimal",
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0"
  });

  for (const relativePath of ["AGENTS.md", "docs/ai/harness.md", "docs/ai/memory.md"]) {
    assert.ok(result.created.includes(relativePath), `expected ${relativePath} to be created`);
  }
  assert.ok(!result.created.includes("docs/extra.md"));
  assert.ok(!result.created.includes("evals/README.md"));
  assert.equal(await readFile(join(project.root, "AGENTS.md"), "utf8"), "# demo-app\n");
});

test("standard mode excludes evals but keeps extra docs", async () => {
  const packageRoot = await createFixturePackageRoot();
  const project = await createProject();

  const result = await installHarness({
    project,
    packageRoot,
    mode: "standard",
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0"
  });

  assert.ok(result.created.includes("docs/extra.md"));
  assert.ok(!result.created.includes("evals/README.md"));
});

test("enterprise mode installs every template file", async () => {
  const packageRoot = await createFixturePackageRoot();
  const project = await createProject();

  const result = await installHarness({
    project,
    packageRoot,
    mode: "enterprise",
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0"
  });

  assert.ok(result.created.includes("evals/README.md"));
  assert.ok(result.created.includes("docs/extra.md"));
});

test("writes .harness/manifest.json with file hashes", async () => {
  const packageRoot = await createFixturePackageRoot();
  const project = await createProject();

  await installHarness({
    project,
    packageRoot,
    mode: "enterprise",
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0"
  });

  const manifest = await readManifest(project.root);

  assert.equal(manifest.mode, "enterprise");
  assert.equal(manifest.packageName, "@kal-elsam/harness");
  assert.equal(manifest.cliVersion, "0.2.0");
  assert.match(manifest.files["AGENTS.md"], /^[0-9a-f]{64}$/);
  assert.ok(manifest.files["evals/README.md"]);
});

test("dry-run does not write files or a manifest", async () => {
  const packageRoot = await createFixturePackageRoot();
  const project = await createProject();

  await installHarness({
    project,
    packageRoot,
    mode: "minimal",
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0",
    dryRun: true
  });

  const manifest = await readManifest(project.root);
  assert.equal(manifest, null);
});

test("does not overwrite existing files without --force", async () => {
  const packageRoot = await createFixturePackageRoot();
  const project = await createProject();

  await writeFile(join(project.root, "AGENTS.md"), "custom\n");

  const result = await installHarness({
    project,
    packageRoot,
    mode: "minimal",
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0"
  });

  assert.ok(result.skipped.includes("AGENTS.md"));
  assert.equal(await readFile(join(project.root, "AGENTS.md"), "utf8"), "custom\n");
});

test("installs only selected adapters plus core files", async () => {
  const packageRoot = await createFixturePackageRoot();
  const project = await createProject();

  const result = await installHarness({
    project,
    packageRoot,
    mode: "standard",
    adapters: ["cursor"],
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0"
  });

  assert.ok(result.created.includes("AGENTS.md"));
  assert.ok(result.created.includes(".cursor/rules/core.mdc"));
  assert.ok(!result.created.includes(".codex/skills/sdd.md"));
  assert.ok(!result.created.includes(".claude/settings.md"));

  const manifest = await readManifest(project.root);
  assert.deepEqual(manifest.adapters, ["cursor"]);
});
