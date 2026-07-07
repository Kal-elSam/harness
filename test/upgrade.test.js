import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { readFile, stat, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { runHarnessUpgrade } from "../src/global/upgrade.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");

const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/kairo-runtime",
  cliVersion: "0.14.0"
};

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-upgrade-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user\n");
  }

  return homeDir;
}

async function mtime(path) {
  return (await stat(path)).mtimeMs;
}

test("upgrade --dry-run does not write managed state or configs", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({
    ...baseOptions,
    homeDir
  });

  const stateBefore = await readFile(paths.statePath, "utf8");
  const cursorBefore = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  const stateMtimeBefore = await mtime(paths.statePath);
  const cursorMtimeBefore = await mtime(join(homeDir, ".cursor", "AGENTS.md"));

  const outcome = await runHarnessUpgrade({
    ...baseOptions,
    homeDir,
    dryRun: true,
    fetchVersion: async () => "9.9.9"
  });

  assert.equal(outcome.dryRun, true);
  assert.equal(outcome.wrote, false);
  assert.equal(outcome.latestVersion, "9.9.9");
  assert.equal(await readFile(paths.statePath, "utf8"), stateBefore);
  assert.equal(await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8"), cursorBefore);
  assert.equal(await mtime(paths.statePath), stateMtimeBefore);
  assert.equal(await mtime(join(homeDir, ".cursor", "AGENTS.md")), cursorMtimeBefore);
});

test("upgrade without --yes defaults to dry-run preview", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  await installGlobalHarness({
    ...baseOptions,
    homeDir
  });

  const outcome = await runHarnessUpgrade({
    ...baseOptions,
    homeDir,
    fetchVersion: async () => "9.9.9"
  });

  assert.equal(outcome.dryRun, true);
  assert.equal(outcome.wrote, false);
});

test("upgrade --yes applies only with explicit flag", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({
    ...baseOptions,
    homeDir
  });

  assert.ok(existsSync(paths.root));

  const outcome = await runHarnessUpgrade({
    ...baseOptions,
    homeDir,
    yes: true,
    fetchVersion: async () => "9.9.9"
  });

  assert.equal(outcome.dryRun, false);
  assert.equal(outcome.wrote, true);
  assert.ok(existsSync(paths.root));
});

test("upgrade rejects --dry-run and --yes together", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  await installGlobalHarness({
    ...baseOptions,
    homeDir
  });

  await assert.rejects(
    () => runHarnessUpgrade({
      ...baseOptions,
      homeDir,
      dryRun: true,
      yes: true,
      fetchVersion: async () => "9.9.9"
    }),
    /either --dry-run or --yes/
  );
});

test("kairo upgrade --dry-run CLI prints latest command and writes nothing", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "harness-upgrade-cli-"));
  mkdirSync(join(homeDir, ".cursor"), { recursive: true });
  mkdirSync(join(homeDir, ".codex"), { recursive: true });

  const result = spawnSync(process.execPath, [harnessBin, "upgrade", "--dry-run"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HARNESS_HOME: homeDir,
      HARNESS_TEST_LATEST_VERSION: "9.9.9"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Published latest: 9\.9\.9/);
  assert.match(result.stdout, /npx @kal-elsam\/kairo-runtime@latest setup --dry-run/);
  assert.match(result.stdout, /Dry run: nothing was written/);
  assert.equal(existsSync(join(homeDir, ".harness")), false);
});
