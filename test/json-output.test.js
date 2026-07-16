import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { harnessHomePaths } from "../src/global/paths.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const cliVersion = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version;
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/kairo-runtime",
  cliVersion
};

const STABLE_KEYS = [
  "ok",
  "overall",
  "agents",
  "components",
  "componentHealth",
  "checks",
  "backups",
  "nextAction",
  "policy",
  "cliVersion"
];

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-json-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user\n");
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

function parseJsonStdout(cli) {
  assert.equal(cli.stderr, "", cli.stderr);
  return JSON.parse(cli.stdout);
}

function assertStableEnvelope(payload) {
  for (const key of STABLE_KEYS) {
    assert.ok(key in payload, `missing stable field: ${key}`);
  }
  assert.equal(Object.keys(payload).slice(0, STABLE_KEYS.length).join(","), STABLE_KEYS.join(","));
  assert.equal(typeof payload.ok, "boolean");
  assert.equal(typeof payload.overall, "string");
  assert.ok(Array.isArray(payload.agents));
  assert.ok(Array.isArray(payload.components));
  assert.ok(Array.isArray(payload.componentHealth));
  assert.ok(Array.isArray(payload.checks));
  assert.equal(typeof payload.backups, "number");
  assert.equal(typeof payload.nextAction, "string");
  assert.equal(typeof payload.policy, "object");
  assert.equal(payload.cliVersion, cliVersion);
}

test("status --json before setup reports missing and exits non-zero", async () => {
  const homeDir = await createFakeHome();
  const cli = runHarness(["status", "--json"], homeDir);

  assert.notEqual(cli.status, 0);
  const payload = parseJsonStdout(cli);
  assertStableEnvelope(payload);
  assert.equal(payload.ok, false);
  assert.equal(payload.overall, "missing");
  assert.match(payload.nextAction, /kairo setup/);
});

test("status --json after setup reports ok and exits zero", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const cli = runHarness(["status", "--json"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  const payload = parseJsonStdout(cli);
  assertStableEnvelope(payload);
  assert.equal(payload.ok, true);
  assert.equal(payload.overall, "ok");
  assert.ok(payload.components.length > 0);
});

test("sync --dry-run --json with drift reports planned repairs and does not write", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({ ...baseOptions, homeDir });
  const assetPath = join(paths.root, "components", "sdd-core", "workflow.md");
  await unlink(assetPath);
  assert.equal(existsSync(assetPath), false);

  const cli = runHarness(["sync", "--dry-run", "--json"], homeDir);
  assert.notEqual(cli.status, 0);
  const payload = parseJsonStdout(cli);
  assertStableEnvelope(payload);
  assert.equal(payload.ok, false);
  assert.equal(payload.overall, "drift");
  assert.equal(payload.action, "plan");
  assert.equal(payload.wrote, false);
  assert.ok(payload.assetsRepaired.includes("components/sdd-core/workflow.md"));
  assert.equal(existsSync(assetPath), false);
});

test("doctor --json preserves detailed checks", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const cli = runHarness(["doctor", "--json"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  const payload = parseJsonStdout(cli);
  assertStableEnvelope(payload);
  assert.equal(payload.ok, true);
  assert.equal(payload.overall, "ok");
  assert.ok(payload.checks.length > 0);
  assert.ok(payload.checks.every((check) => check.name && check.status));
  assert.ok(payload.checks.some((check) => check.name === "~/.harness/state.json"));
});

test("human status output remains the default", async () => {
  const homeDir = await createFakeHome();
  const cli = runHarness(["status"], homeDir);

  assert.notEqual(cli.status, 0);
  assert.match(cli.stdout, /Kairo Runtime status — local AI ecosystem/);
  assert.match(cli.stdout, /Overall: MISSING/);
  assert.throws(() => JSON.parse(cli.stdout));
});
