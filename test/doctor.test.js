import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installHarness } from "../src/template-installer.js";
import { runDoctorChecks } from "../src/doctor.js";
import { createFixturePackageRoot, createProject } from "./test-fixtures.js";

test("doctor reports missing required files", async () => {
  const project = await createProject();
  const { checks, ok } = await runDoctorChecks(project);

  assert.equal(ok, false);
  const agentsCheck = checks.find((check) => check.name === "AGENTS.md");
  assert.equal(agentsCheck.status, "missing");
});

test("doctor passes when required files exist", async () => {
  const project = await createProject();
  await mkdir(join(project.root, "docs", "ai"), { recursive: true });
  await writeFile(join(project.root, "AGENTS.md"), "# demo-app\n");
  await writeFile(join(project.root, "docs", "ai", "harness.md"), "harness\n");
  await writeFile(join(project.root, "docs", "ai", "memory.md"), "memory\n");

  const { ok } = await runDoctorChecks(project);
  assert.equal(ok, true);
});

test("doctor warns when no manifest exists yet", async () => {
  const project = await createProject();
  const { checks } = await runDoctorChecks(project);

  const manifestCheck = checks.find((check) => check.name === ".harness/manifest.json");
  assert.equal(manifestCheck.status, "warning");
});

test("doctor reports ok manifest status after install", async () => {
  const packageRoot = await createFixturePackageRoot();
  const project = await createProject();

  await installHarness({
    project,
    packageRoot,
    mode: "minimal",
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0"
  });

  const { checks } = await runDoctorChecks(project);
  const manifestCheck = checks.find((check) => check.name === ".harness/manifest.json");
  assert.equal(manifestCheck.status, "ok");
  assert.match(manifestCheck.detail, /mode=minimal/);
});

test("doctor flags manifest drift when a tracked file is removed", async () => {
  const packageRoot = await createFixturePackageRoot();
  const project = await createProject();

  await installHarness({
    project,
    packageRoot,
    mode: "minimal",
    packageName: "@kal-elsam/harness",
    cliVersion: "0.2.0"
  });

  await unlink(join(project.root, "docs", "ai", "memory.md"));

  const { checks } = await runDoctorChecks(project);
  const driftCheck = checks.find((check) => check.name === "manifest drift");
  assert.ok(driftCheck);
  assert.match(driftCheck.detail, /docs\/ai\/memory\.md/);
});
