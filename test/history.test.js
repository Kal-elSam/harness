import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, appendFileSync, mkdtempSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { harnessHomePaths } from "../src/global/paths.js";
import {
  appendHistoryEvent,
  getHistoryPath,
  readHistoryEvents,
  recordPolicyHistory,
  recordRollbackHistory,
  recordSetupHistory,
  recordSyncHistory
} from "../src/global/history.js";
import { runHarnessSetup } from "../src/global/setup.js";
import { runHarnessSync } from "../src/global/sync.js";
import { writePolicyFile } from "../src/global/policy.js";
import { applyRollback } from "../src/global/rollback.js";
import { runGlobalHistory } from "../src/global/global-cli.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const cliVersion = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/harness",
  cliVersion
};

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-history-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user content\n");
  }

  return homeDir;
}

function runHarness(args, homeDir, { input = null } = {}) {
  return spawnSync(process.execPath, [harnessBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir },
    input
  });
}

function baseCliOptions(overrides = {}) {
  return {
    cwd: packageRoot,
    dryRun: false,
    yes: false,
    yesExplicit: false,
    confirm: false,
    confirmExplicit: false,
    preflight: true,
    preflightExplicit: false,
    json: false,
    interactive: false,
    ...overrides
  };
}

test("setup --confirm creates history event with cli consent", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    confirm: true,
    confirmExplicit: true,
    interactive: false
  });

  await recordSetupHistory(homeDir, {
    cliVersion,
    options: baseCliOptions({ confirm: true, confirmExplicit: true }),
    outcome,
    checksBefore: { ok: 0, missing: 0, stale: 0, warning: 0 },
    packageRoot,
    workspaceRoot: packageRoot
  });

  const { events } = await readHistoryEvents(homeDir);
  assert.equal(events.length, 1);
  assert.equal(events[0].command, "setup");
  assert.equal(events[0].action, "applied");
  assert.equal(events[0].wrote, true);
  assert.equal(events[0].consentSource, "cli");
  assert.equal(events[0].cliVersion, cliVersion);
  assert.ok(Array.isArray(events[0].agents));
  assert.ok(Array.isArray(events[0].components));
});

test("sync with ci policy records policy consent source", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });
  await writePolicyFile(homeDir, { profile: "ci" });

  const assetPath = join(harnessHomePaths(homeDir).root, "components", "sdd-core", "workflow.md");
  await unlink(assetPath);

  const outcome = await runHarnessSync({
    ...baseOptions,
    homeDir,
    confirm: true,
    confirmExplicit: false,
    interactive: false
  });

  await recordSyncHistory(homeDir, {
    cliVersion,
    options: baseCliOptions({ confirm: true }),
    outcome,
    checksBefore: { ok: 1, missing: 1, stale: 0, warning: 0 },
    packageRoot,
    workspaceRoot: packageRoot
  });

  const { events } = await readHistoryEvents(homeDir);
  assert.equal(events.length, 1);
  assert.equal(events[0].command, "sync");
  assert.equal(events[0].consentSource, "policy");
  assert.equal(events[0].policy.profile, "ci");
});

test("sync cancelled in TTY records cancelled action", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(harnessHomePaths(homeDir).root, "components", "sdd-core", "workflow.md");
  await unlink(assetPath);

  const outcome = await runHarnessSync({
    ...baseOptions,
    homeDir,
    interactive: true,
    createPrompt: () => {
      const prompt = async () => "n";
      prompt.close = async () => {};
      return prompt;
    }
  });

  await recordSyncHistory(homeDir, {
    cliVersion,
    options: baseCliOptions({ interactive: true }),
    outcome,
    checksBefore: { ok: 1, missing: 1, stale: 0, warning: 0 },
    packageRoot,
    workspaceRoot: packageRoot
  });

  const { events } = await readHistoryEvents(homeDir);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "cancelled");
  assert.equal(events[0].wrote, false);
});

test("rollback --apply records snapshot and safety backup", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({ ...baseOptions, homeDir });
  const snapshots = (await import("../src/global/backups.js")).listBackupSnapshots;
  const backupNames = await snapshots(paths.backupsDir);
  assert.ok(backupNames.length > 0);

  const snapshot = backupNames[0];
  await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "corrupted\n");

  const result = await applyRollback({ homeDir, snapshot });

  await recordRollbackHistory(homeDir, {
    cliVersion,
    snapshot,
    result
  });

  const { events } = await readHistoryEvents(homeDir);
  assert.equal(events.length, 1);
  assert.equal(events[0].command, "rollback");
  assert.deepEqual(events[0].snapshotsUsed, [snapshot]);
  assert.ok(Array.isArray(events[0].backupsCreated));
  assert.equal(events[0].backupsCreated.length, 1);
});

test("policy set and reset record history without touching state", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });
  const paths = harnessHomePaths(homeDir);
  const beforeState = await readFile(paths.statePath, "utf8");

  await recordPolicyHistory(homeDir, { cliVersion, action: "set" });
  await recordPolicyHistory(homeDir, { cliVersion, action: "reset" });

  const { events } = await readHistoryEvents(homeDir);
  assert.equal(events.length, 2);
  assert.equal(events[0].command, "policy");
  assert.equal(events[0].action, "set");
  assert.equal(events[1].action, "reset");
  assert.equal(await readFile(paths.statePath, "utf8"), beforeState);
});

test("history --json emits parseable JSON", () => {
  const homeDir = mkdtempSyncSafe();
  appendHistoryEventSync(homeDir, {
    timestamp: "2026-07-06T00:00:00.000Z",
    command: "setup",
    action: "applied",
    wrote: true,
    dryRun: false,
    cliVersion
  });

  const cli = runHarness(["history", "--json"], homeDir);
  assert.equal(cli.status, 0);
  const parsed = JSON.parse(cli.stdout.trim());
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.cliVersion, cliVersion);
});

test("history --limit 1 returns only the most recent event", () => {
  const homeDir = mkdtempSyncSafe();
  appendHistoryEventSync(homeDir, {
    timestamp: "2026-07-06T00:00:00.000Z",
    command: "setup",
    action: "applied",
    wrote: true,
    dryRun: false,
    cliVersion
  });
  appendHistoryEventSync(homeDir, {
    timestamp: "2026-07-06T00:00:01.000Z",
    command: "sync",
    action: "repaired",
    wrote: true,
    dryRun: false,
    cliVersion
  });

  const cli = runHarness(["history", "--limit", "1", "--json"], homeDir);
  assert.equal(cli.status, 0);
  const parsed = JSON.parse(cli.stdout.trim());
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].command, "sync");
});

test("readHistoryEvents skips corrupt lines with warnings", async () => {
  const homeDir = await createFakeHome();
  const historyPath = getHistoryPath(homeDir);
  await mkdir(dirname(historyPath), { recursive: true });
  await writeFile(
    historyPath,
    `${JSON.stringify({ command: "setup", action: "applied", wrote: true, cliVersion })}\n{bad json\n`,
    "utf8"
  );

  const { events, warnings } = await readHistoryEvents(homeDir);
  assert.equal(events.length, 1);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].line, 2);
});

test("recordSetupHistory skips dry-run without writing history file", async () => {
  const homeDir = await createFakeHome();

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    dryRun: true,
    interactive: false
  });

  await recordSetupHistory(homeDir, {
    cliVersion,
    options: baseCliOptions({ dryRun: true }),
    outcome,
    checksBefore: null,
    packageRoot,
    workspaceRoot: packageRoot
  });

  assert.equal(existsSync(join(homeDir, ".harness")), false);
  const { events } = await readHistoryEvents(homeDir);
  assert.equal(events.length, 0);
});

test("CLI setup --dry-run does not create harness home or history", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  const cli = runHarness(["setup", "--dry-run"], homeDir);
  assert.equal(cli.status, 0);
  assert.equal(existsSync(join(homeDir, ".harness")), false);

  const { events } = await readHistoryEvents(homeDir);
  assert.equal(events.length, 0);
});

test("CLI sync --dry-run does not persist history events", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(paths.root, "components", "sdd-core", "workflow.md");
  await unlink(assetPath);

  const cli = runHarness(["sync", "--dry-run", "--json"], homeDir);
  const parsed = JSON.parse(cli.stdout.trim());
  assert.equal(parsed.action, "plan");
  assert.equal(parsed.wrote, false);
  assert.equal(existsSync(assetPath), false);

  const { events } = await readHistoryEvents(homeDir);
  assert.equal(events.length, 0);
});

test("CLI setup --yes and sync --yes create history events", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const setupCli = runHarness(["setup", "--yes"], homeDir);
  assert.equal(setupCli.status, 0);
  assert.ok(existsSync(paths.statePath));

  const assetPath = join(paths.root, "components", "sdd-core", "workflow.md");
  await unlink(assetPath);

  const syncCli = runHarness(["sync", "--yes"], homeDir);
  assert.equal(syncCli.status, 0);

  const historyCli = runHarness(["history", "--json"], homeDir);
  assert.equal(historyCli.status, 0);
  const parsed = JSON.parse(historyCli.stdout.trim());
  assert.ok(parsed.events.length >= 2);
  assert.ok(parsed.events.some((event) => event.command === "setup" && event.wrote === true));
  assert.ok(parsed.events.some((event) => event.command === "sync" && event.wrote === true));
});

test("runGlobalHistory prints warning for corrupt lines", async () => {
  const homeDir = await createFakeHome();
  const historyPath = getHistoryPath(homeDir);
  await mkdir(dirname(historyPath), { recursive: true });
  await appendFile(historyPath, `${JSON.stringify({ command: "setup", action: "applied", wrote: true, cliVersion })}\n{bad\n`, "utf8");

  const logs = [];
  const originalWarn = console.warn;
  const previousHome = process.env.HARNESS_HOME;
  console.warn = (...args) => logs.push(args.join(" "));
  process.env.HARNESS_HOME = homeDir;

  try {
    await runGlobalHistory({ json: false, limit: null }, { version: cliVersion });
  } finally {
    console.warn = originalWarn;
    if (previousHome == null) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
  }

  assert.ok(logs.some((line) => line.includes("skipped invalid history line")));
});

function mkdtempSyncSafe() {
  return mkdtempSync(join(tmpdir(), "harness-history-cli-"));
}

function appendHistoryEventSync(homeDir, event) {
  const historyPath = getHistoryPath(homeDir);
  mkdirSync(dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, `${JSON.stringify(event)}\n`, "utf8");
}
