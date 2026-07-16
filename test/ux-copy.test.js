import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { installGlobalHarness } from "../src/global/global-installer.js";
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

const JSON_HELP_COMMANDS = [
  "status",
  "sync",
  "doctor",
  "adapters",
  "explain",
  "diff",
  "history",
  "history last",
  "policy",
  "report"
];

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-ux-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user content\n");
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

function snapshotLines(output, patterns) {
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  return patterns.map((pattern) => {
    const line = lines.find((entry) => pattern.test(entry));
    assert.ok(line, `expected line matching ${pattern}`);
    return line;
  });
}

test("help lists all supported JSON commands", () => {
  const cli = runHarness(["help"], mkdtempSyncSafe());
  assert.equal(cli.status, 0, cli.stderr);

  for (const command of JSON_HELP_COMMANDS) {
    assert.match(cli.stdout, new RegExp(command.replace(" ", "\\s+")), `help missing JSON command: ${command}`);
  }

  assert.match(cli.stdout, /More examples: README\.md/);
  assert.doesNotMatch(cli.stdout, /Stable fields: ok, overall/);
});

test("setup dry-run uses Backups planned copy", () => {
  const homeDir = mkdtempSyncSafe();
  const cli = runHarness(["setup", "--dry-run"], homeDir);

  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Backups planned: 0/);
  assert.doesNotMatch(cli.stdout, /^Backups: 0$/m);
  assert.match(cli.stdout, /Dry run: nothing was written\./);
});

test("sync dry-run uses Backups planned in repair summary", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(paths.root, "components", "sdd-core", "workflow.md");
  await unlink(assetPath);

  const cli = runHarness(["sync", "--dry-run", "--yes"], homeDir);
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /Planned repairs:/);
  assert.match(cli.stdout, /Backups planned:/);
});

test("status snapshots for missing, ok, and drift", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  const missing = runHarness(["status"], homeDir);
  assert.notEqual(missing.status, 0);
  snapshotLines(missing.stdout, [/Overall: MISSING/, /State: missing/]);

  await installGlobalHarness({ ...baseOptions, homeDir });

  const ok = runHarness(["status"], homeDir);
  assert.equal(ok.status, 0, ok.stderr);
  snapshotLines(ok.stdout, [/Overall: OK/, /Ecosystem healthy/]);

  await writeFile(
    join(homeDir, ".harness", "components", "sdd-core", "workflow.md"),
    "tampered\n"
  );

  const drift = runHarness(["status"], homeDir);
  assert.notEqual(drift.status, 0);
  snapshotLines(drift.stdout, [/Overall: DRIFT/, /kairo sync/]);
});

test("report and history snapshots stay concise", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });

  const history = runHarness(["history"], homeDir);
  assert.equal(history.status, 0, history.stderr);
  snapshotLines(history.stdout, [/Kairo Runtime history/, /No managed operations recorded yet/]);

  const historyLast = runHarness(["history", "last"], homeDir);
  assert.equal(historyLast.status, 0, historyLast.stderr);
  snapshotLines(historyLast.stdout, [/Kairo Runtime history last/, /No managed operations recorded yet/]);

  const report = runHarness(["report"], homeDir);
  assert.equal(report.status, 0, report.stderr);
  snapshotLines(report.stdout, [/Kairo Runtime report/, /Overall: OK/, /Diff:/]);
});

test("setup next steps do not promise automatic Engram or Graphify installation", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({
    ...baseOptions,
    homeDir,
    components: ["orchestrator", "engram-memory", "graphify-context"]
  });

  const status = runHarness(["status"], homeDir);
  assert.equal(status.status, 0, status.stderr);
  assert.doesNotMatch(status.stdout, /install.*engram/i);
  assert.doesNotMatch(status.stdout, /install.*graphify/i);
  assert.doesNotMatch(status.stdout, /auto.?install/i);

  const doctor = runHarness(["doctor"], homeDir);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /engram:binary/i);
  assert.match(doctor.stdout, /engram:agent:cursor/i);
});

test("common errors stay clear and non-destructive", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const invalidCommand = runHarness(["not-a-command"], homeDir);
  assert.notEqual(invalidCommand.status, 0);
  assert.match(invalidCommand.stderr, /Unknown command "not-a-command"/);

  const invalidLimit = runHarness(["history", "--limit", "0"], homeDir);
  assert.notEqual(invalidLimit.status, 0);
  assert.match(invalidLimit.stderr, /Invalid --limit/);

  const consentMissing = runHarness(["setup", "--agents", "cursor"], homeDir);
  assert.notEqual(consentMissing.status, 0);
  assert.match(consentMissing.stderr, /Non-interactive setup requires/);
  assert.equal(existsSync(paths.statePath), false);
});

function mkdtempSyncSafe() {
  return mkdtempSync(join(tmpdir(), "harness-ux-cli-"));
}
