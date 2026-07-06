import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildExplainJson, buildExplainReport } from "../src/global/explain.js";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { GLOBAL_AGENT_IDS } from "../src/global/registry.js";
import { SECTION_END, SECTION_START } from "../src/global/managed-section.js";

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

const EXPLAIN_JSON_KEYS = [
  "ok",
  "installed",
  "cliVersion",
  "nextAction",
  "markers",
  "stateRoot",
  "writesTo",
  "adapters",
  "configFiles",
  "components",
  "backups",
  "policy"
];

const ALL_AGENT_ROOTS = [
  [".cursor"],
  [".codex"],
  [".config", "opencode"],
  [".claude"]
];

async function createFakeHomeWithAllAgents({ withUserCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-explain-home-"));

  for (const parts of ALL_AGENT_ROOTS) {
    await mkdir(join(homeDir, ...parts), { recursive: true });
  }

  if (withUserCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user-owned marker\n");
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

test("explain without state recommends setup and writes nothing", async () => {
  const homeDir = await createFakeHomeWithAllAgents();
  const paths = harnessHomePaths(homeDir);
  const before = Date.now();

  const report = await buildExplainReport(homeDir);

  assert.equal(report.installed, false);
  assert.match(report.nextAction, /harness setup/i);
  assert.equal(existsSync(paths.root), false);

  const cli = runHarness(["explain"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /run setup/i);
  assert.match(cli.stdout, /read-only/i);
  assert.ok(Date.now() >= before);
  assert.equal(existsSync(paths.root), false);
});

test("explain after setup lists all four adapters", async () => {
  const homeDir = await createFakeHomeWithAllAgents();
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["all"] });

  const report = await buildExplainReport(homeDir);
  assert.equal(report.installed, true);
  assert.deepEqual(
    report.adapters.filter((adapter) => adapter.managed).map((adapter) => adapter.id),
    GLOBAL_AGENT_IDS
  );

  const cli = runHarness(["explain"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  for (const adapterId of GLOBAL_AGENT_IDS) {
    assert.match(cli.stdout, new RegExp(`${adapterId}\\s+detected\\s+managed`));
  }
});

test("explain --json exposes stable shape", async () => {
  const homeDir = await createFakeHomeWithAllAgents();
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["all"] });

  const report = await buildExplainReport(homeDir);
  const payload = buildExplainJson(report, { cliVersion });

  assert.deepEqual(Object.keys(payload), EXPLAIN_JSON_KEYS);
  assert.equal(payload.installed, true);
  assert.equal(payload.ok, true);
  assert.equal(payload.cliVersion, cliVersion);
  assert.equal(payload.markers.start, SECTION_START);
  assert.equal(payload.markers.end, SECTION_END);
  assert.equal(payload.adapters.length, 4);
  assert.equal(payload.configFiles.length, 4);
  assert.ok(payload.components.length >= 1);
  assert.ok(Array.isArray(payload.writesTo));
  assert.ok(Array.isArray(payload.backups));

  const cli = runHarness(["explain", "--json"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  const cliPayload = JSON.parse(cli.stdout);
  assert.deepEqual(Object.keys(cliPayload), EXPLAIN_JSON_KEYS);
});

test("explain reports user content outside managed markers as preserved", async () => {
  const homeDir = await createFakeHomeWithAllAgents({ withUserCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["cursor"] });

  const report = await buildExplainReport(homeDir);
  const cursor = report.configFiles.find((file) => file.adapterId === "cursor");

  assert.ok(cursor);
  assert.equal(cursor.hasManagedSection, true);
  assert.equal(cursor.hasPreservedUserContent, true);
  assert.match(cursor.preservedUserContent, /user-owned marker/);

  const cli = runHarness(["explain"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /user-owned preserved: yes/);

  const json = JSON.parse(runHarness(["explain", "--json"], homeDir).stdout);
  const jsonCursor = json.configFiles.find((file) => file.adapterId === "cursor");
  assert.equal(jsonCursor.hasPreservedUserContent, true);
  assert.match(jsonCursor.preservedUserContent, /user-owned marker/);
});
