import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildDiagnosticsReport,
  buildReportJson,
  DEFAULT_HISTORY_LIMIT
} from "../src/global/report.js";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { getHistoryPath } from "../src/global/history.js";
import { harnessHomePaths } from "../src/global/paths.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const cliVersion = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8")
).version;
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/kairo-runtime",
  cliVersion
};

const REPORT_JSON_KEYS = [
  "ok",
  "cliVersion",
  "homeDir",
  "adapters",
  "policy",
  "status",
  "diff",
  "history"
];

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-report-home-"));
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

async function appendHistoryEvent(homeDir, event) {
  const historyPath = getHistoryPath(homeDir);
  await mkdir(dirname(historyPath), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify(event)}\n`, { flag: "a" });
}

test("report without state shows missing status and setup next action", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  const report = await buildDiagnosticsReport(homeDir, baseOptions);

  assert.equal(report.status.overall, "missing");
  assert.equal(report.ok, false);
  assert.match(report.status.nextAction, /setup/i);
  assert.equal(report.diff.status, "setup-required");
  assert.equal(existsSync(paths.root), false);

  const cli = runHarness(["report"], homeDir);
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /Overall: MISSING/i);
  assert.match(cli.stdout, /setup/i);
  assert.equal(existsSync(paths.root), false);
});

test("report with healthy ecosystem shows overall OK and no drift", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });

  const report = await buildDiagnosticsReport(homeDir, baseOptions);

  assert.equal(report.status.overall, "ok");
  assert.equal(report.ok, true);
  assert.equal(report.diff.hasChanges, false);
  assert.match(report.diff.summary, /no managed changes/i);

  const cli = runHarness(["report"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Overall: OK/i);
  assert.match(cli.stdout, /Drift: none/i);
});

test("report with drift shows diff summary", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(paths.root, "components", "sdd-core", "workflow.md");
  await unlink(assetPath);

  const report = await buildDiagnosticsReport(homeDir, baseOptions);

  assert.equal(report.status.overall, "drift");
  assert.equal(report.diff.hasChanges, true);
  assert.ok(report.diff.changeCount > 0);

  const cli = runHarness(["report"], homeDir);
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /Planned changes:/);
  assert.match(cli.stdout, /components\/sdd-core\/workflow\.md/);
});

test("report includes recent history events with default limit", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  for (let index = 0; index < 25; index += 1) {
    await appendHistoryEvent(homeDir, {
      timestamp: `2026-07-06T00:00:${String(index).padStart(2, "0")}.000Z`,
      command: index % 2 === 0 ? "setup" : "sync",
      action: "applied",
      wrote: true,
      cliVersion
    });
  }

  const report = await buildDiagnosticsReport(homeDir, baseOptions);
  assert.equal(report.history.limit, DEFAULT_HISTORY_LIMIT);
  assert.equal(report.history.events.length, DEFAULT_HISTORY_LIMIT);
  assert.equal(report.history.events[0].command, "sync");
  assert.equal(report.history.events[report.history.events.length - 1].command, "setup");

  const cli = runHarness(["report", "--limit", "3"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  const setupLines = cli.stdout.split("\n").filter((line) => line.includes("setup"));
  const syncLines = cli.stdout.split("\n").filter((line) => line.includes("sync"));
  assert.ok(setupLines.length >= 1);
  assert.ok(syncLines.length >= 1);
});

test("report warns about corrupt history lines", async () => {
  const homeDir = await createFakeHome();
  const historyPath = getHistoryPath(homeDir);
  await mkdir(dirname(historyPath), { recursive: true });
  await writeFile(
    historyPath,
    `${JSON.stringify({ command: "setup", action: "applied", wrote: true, cliVersion })}\n{bad json\n`,
    "utf8"
  );

  const report = await buildDiagnosticsReport(homeDir, baseOptions);
  assert.equal(report.history.warnings.length, 1);
  assert.equal(report.history.events.length, 1);

  const cli = runHarness(["report"], homeDir);
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /Warning: skipped invalid history line/);
});

test("report --json emits stable parseable JSON", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });

  const cli = runHarness(["report", "--json"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);

  const parsed = JSON.parse(cli.stdout.trim());
  for (const key of REPORT_JSON_KEYS) {
    assert.ok(Object.hasOwn(parsed, key), `missing key: ${key}`);
  }
  assert.equal(parsed.cliVersion, cliVersion);
  assert.equal(parsed.status.overall, "ok");
  assert.ok(Array.isArray(parsed.history.events));
});

test("buildReportJson matches CLI --json shape", async () => {
  const homeDir = await createFakeHome();
  const report = await buildDiagnosticsReport(homeDir, baseOptions);
  const json = buildReportJson(report);

  for (const key of REPORT_JSON_KEYS) {
    assert.ok(Object.hasOwn(json, key), `missing key: ${key}`);
  }
});

test("report and report --json do not write files", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });
  const paths = harnessHomePaths(homeDir);
  const stateBefore = await readFile(paths.statePath, "utf8");

  runHarness(["report"], homeDir);
  runHarness(["report", "--json"], homeDir);

  const stateAfter = await readFile(paths.statePath, "utf8");
  assert.equal(stateAfter, stateBefore);
});

test("report --out writes only the requested file", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });
  const paths = harnessHomePaths(homeDir);
  const outPath = join(homeDir, "diagnostics.txt");
  const stateBefore = await readFile(paths.statePath, "utf8");

  const cli = runHarness(["report", "--out", outPath], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(existsSync(outPath), true);
  assert.match(await readFile(outPath, "utf8"), /Kairo Runtime report/);
  assert.match(cli.stdout, /Diagnostics report written to:/);

  const stateAfter = await readFile(paths.statePath, "utf8");
  assert.equal(stateAfter, stateBefore);
});

test("report --out --json writes JSON to the requested file", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });
  const outPath = join(homeDir, "diagnostics.json");

  const cli = runHarness(["report", "--json", "--out", outPath], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(existsSync(outPath), true);

  const parsed = JSON.parse((await readFile(outPath, "utf8")).trim());
  assert.equal(parsed.cliVersion, cliVersion);
  assert.equal(parsed.status.overall, "ok");
});
