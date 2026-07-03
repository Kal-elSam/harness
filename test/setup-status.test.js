import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { runHarnessSetup } from "../src/global/setup.js";
import { buildStatusReport } from "../src/global/status.js";
import { harnessHomePaths } from "../src/global/paths.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/harness",
  cliVersion: "0.8.0"
};

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user\n");
  }

  return homeDir;
}

test("setup --dry-run writes nothing", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    dryRun: true,
    interactive: false
  });

  assert.equal(outcome.cancelled, false);
  assert.deepEqual(outcome.result.agents, ["cursor", "codex"]);
  assert.deepEqual(outcome.result.components, ["orchestrator", "sdd-core"]);
  assert.equal(existsSync(paths.root), false);
  assert.equal(existsSync(join(homeDir, ".cursor", "AGENTS.md")), false);
});

test("setup detects agents and matches install plan", async () => {
  const homeDir = await createFakeHome();

  const setupOutcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    dryRun: true,
    interactive: false
  });

  const installResult = await installGlobalHarness({
    ...baseOptions,
    homeDir,
    dryRun: true
  });

  assert.deepEqual(setupOutcome.result.agents, installResult.agents);
  assert.deepEqual(setupOutcome.result.components, installResult.components);
  assert.deepEqual(setupOutcome.result.coreFiles, installResult.coreFiles);
});

test("setup applies the same safe result as install", async () => {
  const setupHome = await createFakeHome({ withCursorConfig: true });
  const installHome = await createFakeHome({ withCursorConfig: true });

  const setupOutcome = await runHarnessSetup({
    ...baseOptions,
    homeDir: setupHome,
    interactive: false,
    yes: true
  });

  const installResult = await installGlobalHarness({
    ...baseOptions,
    homeDir: installHome
  });

  assert.deepEqual(setupOutcome.result.agents, installResult.agents);
  assert.deepEqual(setupOutcome.result.components, installResult.components);
  assert.deepEqual(
    [...setupOutcome.result.coreFiles].sort(),
    [...installResult.coreFiles].sort()
  );

  const setupPaths = harnessHomePaths(setupHome);
  const installPaths = harnessHomePaths(installHome);
  assert.ok(existsSync(join(setupPaths.root, "state.json")));
  assert.ok(existsSync(join(installPaths.root, "state.json")));

  const setupCursor = await readFile(join(setupHome, ".cursor", "AGENTS.md"), "utf8");
  const installCursor = await readFile(join(installHome, ".cursor", "AGENTS.md"), "utf8");
  assert.match(setupCursor, /<!-- harness:managed:start -->/);
  assert.match(installCursor, /<!-- harness:managed:start -->/);
  assert.match(setupCursor, /### Orchestrator/);
  assert.match(installCursor, /### Orchestrator/);
});

test("setup honors explicit agents and components", async () => {
  const homeDir = await createFakeHome();

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    agents: ["cursor"],
    components: ["orchestrator"],
    dryRun: true,
    interactive: false
  });

  assert.deepEqual(outcome.result.agents, ["cursor"]);
  assert.deepEqual(outcome.result.components, ["orchestrator"]);
});

test("status reports missing before install", async () => {
  const homeDir = await createFakeHome();
  const report = await buildStatusReport(homeDir, { packageRoot });

  assert.equal(report.overall, "missing");
  assert.match(report.nextAction, /harness setup/);
  assert.equal(report.ok, false);
});

test("status reports ok after install and drift after tamper", async () => {
  const homeDir = await createFakeHome();

  await installGlobalHarness({ ...baseOptions, homeDir });
  const healthy = await buildStatusReport(homeDir, { packageRoot });
  assert.equal(healthy.overall, "ok");
  assert.equal(healthy.components.length, 2);
  assert.ok(healthy.agents.some((agent) => agent.id === "cursor" && agent.managed));
  assert.match(healthy.nextAction, /healthy/i);

  await writeFile(join(homeDir, ".harness", "components", "sdd-core", "workflow.md"), "tampered");
  const drifted = await buildStatusReport(homeDir, { packageRoot });
  assert.equal(drifted.overall, "drift");
  assert.match(drifted.nextAction, /harness sync/);
  assert.equal(
    drifted.components.find((component) => component.id === "sdd-core").status,
    "stale"
  );
});

test("harness setup --dry-run and status CLI work", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  const setupCli = spawnSync(process.execPath, [harnessBin, "setup", "--dry-run"], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });

  assert.equal(setupCli.status, 0, setupCli.stderr);
  assert.match(setupCli.stdout, /Harness setup — local AI ecosystem configurator/);
  assert.match(setupCli.stdout, /Dry run: nothing was written/);
  assert.match(setupCli.stdout, /Agents: cursor, codex/);

  const missingStatus = spawnSync(process.execPath, [harnessBin, "status"], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });
  assert.notEqual(missingStatus.status, 0);
  assert.match(missingStatus.stdout, /Overall: MISSING/);

  await installGlobalHarness({ ...baseOptions, homeDir });

  const okStatus = spawnSync(process.execPath, [harnessBin, "status"], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });
  assert.equal(okStatus.status, 0, okStatus.stderr);
  assert.match(okStatus.stdout, /Overall: OK/);
  assert.match(okStatus.stdout, /orchestrator/);

  await writeFile(join(homeDir, ".harness", "components", "sdd-core", "workflow.md"), "tampered");
  const driftStatus = spawnSync(process.execPath, [harnessBin, "status"], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });
  assert.notEqual(driftStatus.status, 0);
  assert.match(driftStatus.stdout, /Overall: DRIFT/);
  assert.match(driftStatus.stdout, /harness sync/);
});
