import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildDiffJson, buildDiffReport } from "../src/global/diff.js";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { harnessHomePaths } from "../src/global/paths.js";

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

const DIFF_JSON_KEYS = [
  "ok",
  "installed",
  "status",
  "hasChanges",
  "cliVersion",
  "summary",
  "nextAction",
  "changes",
  "preserved"
];

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-diff-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user-owned content\n");
  }

  return homeDir;
}

function runHarness(args, homeDir) {
  return spawnSync(process.execPath, [harnessBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });
}

test("diff without state recommends setup dry-run and writes nothing", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  const report = await buildDiffReport(homeDir, baseOptions);

  assert.equal(report.installed, false);
  assert.equal(report.hasChanges, false);
  assert.equal(report.status, "setup-required");
  assert.match(report.nextAction, /setup --dry-run/i);
  assert.equal(existsSync(paths.root), false);

  const cli = runHarness(["diff"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /setup --dry-run/i);
  assert.equal(existsSync(paths.root), false);
});

test("diff with healthy state reports no managed changes", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });

  const report = await buildDiffReport(homeDir, baseOptions);

  assert.equal(report.status, "clean");
  assert.equal(report.hasChanges, false);
  assert.match(report.summary, /no managed changes/i);

  const cli = runHarness(["diff"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Managed changes: none/i);
});

test("diff with missing asset reports planned repair", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(paths.root, "components", "sdd-core", "workflow.md");
  await unlink(assetPath);

  const report = await buildDiffReport(homeDir, baseOptions);

  assert.equal(report.status, "drift");
  assert.equal(report.hasChanges, true);
  assert.ok(
    report.changes.some((change) =>
      change.kind === "component_asset"
      && change.status === "missing"
      && change.target.includes("components/sdd-core/workflow.md")
    )
  );

  const cli = runHarness(["diff"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /components\/sdd-core\/workflow\.md/);
});

test("diff with stale managed section reports affected target", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });

  const configPath = join(homeDir, ".cursor", "AGENTS.md");
  const original = await readFile(configPath, "utf8");
  await writeFile(configPath, original.replace("### SDD Core", "### Broken"));

  const report = await buildDiffReport(homeDir, baseOptions);

  assert.equal(report.hasChanges, true);
  assert.ok(
    report.changes.some((change) =>
      (change.kind === "component_section" || change.kind === "managed_section")
      && change.target === ".cursor/AGENTS.md"
      && change.status === "stale"
    )
  );
});

test("diff --json exposes stable shape", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });

  const report = await buildDiffReport(homeDir, baseOptions);
  const payload = buildDiffJson(report, { cliVersion });

  assert.deepEqual(Object.keys(payload), DIFF_JSON_KEYS);
  assert.equal(payload.ok, true);
  assert.equal(payload.cliVersion, cliVersion);

  const cli = runHarness(["diff", "--json"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(Object.keys(JSON.parse(cli.stdout)), DIFF_JSON_KEYS);
});

test("diff reports user content outside markers as preserved", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });

  const configPath = join(homeDir, ".cursor", "AGENTS.md");
  const original = await readFile(configPath, "utf8");
  await writeFile(configPath, original.replace("### SDD Core", "### Broken"));

  const report = await buildDiffReport(homeDir, baseOptions);
  const cursorPreserved = report.preserved.find((entry) => entry.path === ".cursor/AGENTS.md");

  assert.ok(cursorPreserved);
  assert.equal(cursorPreserved.intact, true);
  assert.match(cursorPreserved.preservedUserContent, /user-owned content/);

  const cli = runHarness(["diff"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /User-owned preserved content/);
  assert.match(cli.stdout, /\.cursor\/AGENTS\.md — intact/);
});
