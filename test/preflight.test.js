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
import { shouldShowPreflight } from "../src/global/preflight.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const cliVersion = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8")
).version;
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/harness",
  cliVersion
};

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-preflight-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user-owned content\n");
  }

  return homeDir;
}

function runHarness(args, homeDir, extraEnv = {}) {
  return spawnSync(process.execPath, [harnessBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir, ...extraEnv }
  });
}

test("shouldShowPreflight skips dry-run, json, and disabled preflight", () => {
  assert.equal(shouldShowPreflight({ preflight: true, dryRun: false, json: false, applying: true }), true);
  assert.equal(shouldShowPreflight({ preflight: false, dryRun: false, json: false, applying: true }), false);
  assert.equal(shouldShowPreflight({ preflight: true, dryRun: true, json: false, applying: true }), false);
  assert.equal(shouldShowPreflight({ preflight: true, dryRun: false, json: true, applying: true }), false);
  assert.equal(shouldShowPreflight({ preflight: true, dryRun: false, json: false, applying: false }), false);
});

test("setup --yes shows managed preflight before applying", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const cli = runHarness(["setup", "--yes", "--agents", "cursor"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Harness preflight — setup/);
  assert.match(cli.stdout, /Managed markers:/);
  assert.match(cli.stdout, /harness:managed:start/);
  assert.match(cli.stdout, /Planned managed changes:/);
  assert.match(cli.stdout, /configured/);
  assert.equal(existsSync(paths.statePath), true);

  const preflightIndex = cli.stdout.indexOf("Harness preflight — setup");
  const configuredIndex = cli.stdout.indexOf("configured");
  assert.ok(preflightIndex >= 0 && configuredIndex > preflightIndex);
});

test("setup --yes --no-preflight omits preflight output", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  const cli = runHarness(["setup", "--yes", "--no-preflight", "--agents", "cursor"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.doesNotMatch(cli.stdout, /Harness preflight — setup/);
  assert.match(cli.stdout, /configured/);
});

test("setup --dry-run does not show preflight", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  const cli = runHarness(["setup", "--yes", "--dry-run", "--agents", "cursor"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.doesNotMatch(cli.stdout, /Harness preflight — setup/);
  assert.match(cli.stdout, /Dry run: nothing was written/);
});

test("sync apply shows preflight before repairs", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(
    harnessHomePaths(homeDir).root,
    "components",
    "sdd-core",
    "workflow.md"
  );
  await unlink(assetPath);

  const cli = runHarness(["sync"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Harness preflight — sync/);
  assert.match(cli.stdout, /Planned managed changes:/);

  const preflightIndex = cli.stdout.indexOf("Harness preflight — sync");
  const repairedIndex = cli.stdout.indexOf("Applied repairs:");
  assert.ok(preflightIndex >= 0 && repairedIndex > preflightIndex);
  assert.equal(existsSync(assetPath), true);
});

test("sync --no-preflight omits preflight output", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(
    harnessHomePaths(homeDir).root,
    "components",
    "sdd-core",
    "workflow.md"
  );
  await unlink(assetPath);

  const cli = runHarness(["sync", "--no-preflight"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.doesNotMatch(cli.stdout, /Harness preflight — sync/);
  assert.match(cli.stdout, /Applied repairs:/);
});

test("sync --dry-run and --json do not show preflight", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(
    harnessHomePaths(homeDir).root,
    "components",
    "sdd-core",
    "workflow.md"
  );
  await unlink(assetPath);

  const dryRunCli = runHarness(["sync", "--dry-run"], homeDir);
  assert.doesNotMatch(dryRunCli.stdout, /Harness preflight — sync/);
  assert.match(dryRunCli.stdout, /Planned repairs:/);
  assert.equal(dryRunCli.status, 1);

  const jsonCli = runHarness(["sync", "--dry-run", "--json"], homeDir);
  assert.doesNotMatch(jsonCli.stdout, /Harness preflight — sync/);
  assert.match(jsonCli.stdout, /"ok"/);
  assert.equal(jsonCli.status, 1);
});

test("upgrade --yes shows preflight before applying", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });

  const cli = runHarness(["upgrade", "--yes"], homeDir, {
    HARNESS_TEST_LATEST_VERSION: "9.9.9"
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Harness preflight — upgrade/);
  assert.match(cli.stdout, /Applied upgrade with the current CLI package/);

  const preflightIndex = cli.stdout.indexOf("Harness preflight — upgrade");
  const appliedIndex = cli.stdout.indexOf("Applied upgrade");
  assert.ok(preflightIndex >= 0 && appliedIndex > preflightIndex);
});

test("upgrade --yes --no-preflight omits preflight output", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });

  const cli = runHarness(["upgrade", "--yes", "--no-preflight"], homeDir, {
    HARNESS_TEST_LATEST_VERSION: "9.9.9"
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.doesNotMatch(cli.stdout, /Harness preflight — upgrade/);
  assert.match(cli.stdout, /Applied upgrade with the current CLI package/);
});

test("diff remains read-only without preflight header", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  const cli = runHarness(["diff"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Harness diff — managed content preview/);
  assert.doesNotMatch(cli.stdout, /Harness preflight —/);
});
