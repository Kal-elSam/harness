import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { runGlobalDoctorChecks } from "../src/global/global-doctor.js";
import { harnessHomePaths } from "../src/global/paths.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseOptions = { packageRoot, packageName: "@kal-elsam/harness", cliVersion: "0.4.0" };

async function createFakeHome() {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-doctor-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  return homeDir;
}

test("doctor reports missing state before install", async () => {
  const homeDir = await createFakeHome();
  const { checks, ok } = await runGlobalDoctorChecks(homeDir);

  assert.equal(ok, false);
  const stateCheck = checks.find((check) => check.name === "~/.harness/state.json");
  assert.equal(stateCheck.status, "missing");
});

test("doctor passes after a global install and reports agents and backups", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const { checks, ok } = await runGlobalDoctorChecks(homeDir);

  assert.equal(ok, true);
  assert.equal(checks.find((check) => check.name === "~/.harness/state.json").status, "ok");
  assert.equal(checks.find((check) => check.name === "~/.harness/components/orchestrator/orchestrator.md").status, "ok");
  assert.equal(checks.find((check) => check.name === "component:sdd-core").status, "ok");
  assert.equal(checks.find((check) => check.name === "agent:cursor").status, "ok");
  assert.equal(checks.find((check) => check.name === "agent:claude").status, "info");
  assert.ok(checks.find((check) => check.name === "~/.harness/backups"));
});

test("doctor flags an installed agent whose config disappeared", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });
  await rm(join(homeDir, ".cursor", "AGENTS.md"));

  const { checks, ok } = await runGlobalDoctorChecks(homeDir);

  assert.equal(ok, false);
  assert.equal(checks.find((check) => check.name === "agent:cursor").status, "missing");
});

test("doctor warns when a config exists without a managed section", async () => {
  const homeDir = await createFakeHome();
  await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "unmanaged\n");

  const { checks } = await runGlobalDoctorChecks(homeDir);

  const cursorCheck = checks.find((check) => check.name === "agent:cursor");
  assert.equal(cursorCheck.status, "warning");
  assert.match(cursorCheck.detail, /No managed section/);
});

test("doctor flags a tracked component asset missing on disk", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const paths = harnessHomePaths(homeDir);
  await rm(join(paths.root, "components", "sdd-core", "workflow.md"));

  const { checks, ok } = await runGlobalDoctorChecks(homeDir);

  assert.equal(ok, false);
  assert.equal(checks.find((check) => check.name === "~/.harness/components/sdd-core/workflow.md").status, "missing");
});
