import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { runHarnessSync } from "../src/global/sync.js";
import { hasManagedSection } from "../src/global/managed-section.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/harness",
  cliVersion: "0.9.0"
};

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user content\n");
  }

  return homeDir;
}

test("sync --dry-run without state writes nothing and recommends setup", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  const outcome = await runHarnessSync({
    ...baseOptions,
    homeDir,
    dryRun: true
  });

  assert.equal(outcome.action, "setup-required");
  assert.equal(outcome.wrote, false);
  assert.equal(outcome.report.overall, "missing");
  assert.match(outcome.report.nextAction, /harness setup/);
  assert.equal(existsSync(paths.root), false);

  const cli = spawnSync(process.execPath, [harnessBin, "sync", "--dry-run"], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stdout, /Run "harness setup"/);
  assert.match(cli.stdout, /Dry run: nothing was written/);
  assert.equal(existsSync(paths.root), false);
});

test("sync with healthy state writes nothing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({ ...baseOptions, homeDir });
  const beforeState = await readFile(paths.statePath, "utf8");
  const beforeCursor = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  const beforeWorkflow = await readFile(join(paths.root, "components", "sdd-core", "workflow.md"));

  const outcome = await runHarnessSync({
    ...baseOptions,
    homeDir,
    yes: true
  });

  assert.equal(outcome.action, "noop");
  assert.equal(outcome.wrote, false);
  assert.equal(outcome.report.overall, "ok");
  assert.equal(await readFile(paths.statePath, "utf8"), beforeState);
  assert.equal(await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8"), beforeCursor);
  assert.deepEqual(
    await readFile(join(paths.root, "components", "sdd-core", "workflow.md")),
    beforeWorkflow
  );
});

test("sync repairs missing asset", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({ ...baseOptions, homeDir });
  const assetPath = join(paths.root, "components", "sdd-core", "workflow.md");
  await unlink(assetPath);
  assert.equal(existsSync(assetPath), false);

  const outcome = await runHarnessSync({
    ...baseOptions,
    homeDir,
    yes: true
  });

  assert.equal(outcome.action, "repaired");
  assert.equal(outcome.wrote, true);
  assert.ok(existsSync(assetPath));
  assert.equal(outcome.report.overall, "ok");
  assert.ok(outcome.result.assetsRepaired.includes("components/sdd-core/workflow.md"));
});

test("sync repairs stale managed section and preserves user content", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  await installGlobalHarness({ ...baseOptions, homeDir });
  const configPath = join(homeDir, ".cursor", "AGENTS.md");
  const original = await readFile(configPath, "utf8");
  await writeFile(configPath, original.replace("### SDD Core", "### Broken"));

  const outcome = await runHarnessSync({
    ...baseOptions,
    homeDir,
    yes: true
  });

  assert.equal(outcome.action, "repaired");
  assert.equal(outcome.report.overall, "ok");

  const repaired = await readFile(configPath, "utf8");
  assert.ok(hasManagedSection(repaired));
  assert.match(repaired, /### SDD Core/);
  assert.match(repaired, /# user content/);
  assert.ok(!repaired.includes("### Broken"));
});

test("sync --dry-run reports planned repairs without writing", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({ ...baseOptions, homeDir });
  const assetPath = join(paths.root, "components", "sdd-core", "workflow.md");
  const before = await readFile(assetPath);
  await unlink(assetPath);

  const outcome = await runHarnessSync({
    ...baseOptions,
    homeDir,
    dryRun: true
  });

  assert.equal(outcome.action, "plan");
  assert.equal(outcome.wrote, false);
  assert.equal(existsSync(assetPath), false);
  assert.equal(outcome.report.overall, "drift");
  assert.ok(outcome.result.assetsRepaired.includes("components/sdd-core/workflow.md"));

  // restore not needed; file still missing proves no write
  assert.notEqual(before.length, 0);
});
