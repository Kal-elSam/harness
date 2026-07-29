import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.js";
import { listAlerts } from "../src/global/runtime/alerts/alert-store.js";
import { ALERT_STATES } from "../src/global/runtime/alerts/alert-types.js";
import { RUN_STATES } from "../src/global/runtime/run-types.js";
import {
  disableMonitor, enableMonitor, getMonitorStatus, installAutostart,
  monitorDoctorCheck, notifyNewAlert, resolveMonitorPlatform, runMonitorTick
} from "../src/global/runtime/monitor/monitor.js";

test("parseArgs routes monitor actions", () => {
  assert.equal(parseArgs(["monitor"]).options.monitorAction, "status");
  assert.equal(parseArgs(["monitor", "enable"]).options.monitorAction, "enable");
  assert.throws(() => parseArgs(["monitor", "boom"]), /Unknown monitor action/);
});

test("tick alerts notify once; enable/disable degrade on linux", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-mon-"));
  const notes = [];
  const drift = async () => ([{ name: "cfg", status: "stale", category: "a", detail: "d" }]);
  const dead = { runId: "run_dead", state: RUN_STATES.RUNNING, startedAt: "2026-01-01T00:00:00.000Z" };
  const tickDeps = {
    detectDriftImpl: drift, listRunsImpl: async () => [dead], isRunAliveImpl: async () => false,
    notifyImpl: async (p) => { notes.push(p); return { sent: true }; }
  };
  const first = await runMonitorTick(homeDir, tickDeps);
  assert.ok(first.raised.length >= 2);
  assert.equal(notes.length, first.state.lastTick.created);
  assert.equal((await runMonitorTick(homeDir, tickDeps)).raised.every((r) => r.deduped), true);
  assert.equal(notes.length, first.state.lastTick.created);
  assert.ok((await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length >= 2);
  const linux = resolveMonitorPlatform("linux");
  assert.equal((await enableMonitor(homeDir, { cliEntry: "/t/k.js", platform: linux })).enabled, true);
  assert.equal((await enableMonitor(homeDir, { cliEntry: "/t/k.js", platform: linux })).autostart.supported, false);
  await disableMonitor(homeDir, { platform: linux });
  assert.equal((await getMonitorStatus(homeDir)).enabled, false);
  assert.match((await monitorDoctorCheck(homeDir)).detail, /disabled/);
});

test("notify shell:false; darwin plist survives launchctl failure", async () => {
  const calls = [];
  assert.equal((await notifyNewAlert({
    title: "Kairo", body: "hi", platform: resolveMonitorPlatform("darwin"),
    execFileImpl: async (_c, _a, opts) => { calls.push(opts); throw new Error("no"); }
  })).sent, false);
  assert.equal(calls[0].shell, false);

  const homeDir = await mkdtemp(join(tmpdir(), "kairo-mon-"));
  const platform = {
    ...resolveMonitorPlatform("darwin"),
    agentsDir: join(homeDir, "Library", "LaunchAgents"),
    plistPath: join(homeDir, "Library", "LaunchAgents", "local.kairo.monitor.plist")
  };
  await mkdir(platform.agentsDir, { recursive: true });
  const result = await installAutostart({
    homeDir, platform, nodePath: process.execPath, cliEntry: "/t/k.js",
    execFileImpl: async () => { throw new Error("launchctl"); }
  });
  assert.equal(result.installed, true);
  assert.match(await readFile(platform.plistPath, "utf8"), /tick<\/string>/);
});
