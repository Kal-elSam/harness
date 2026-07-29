import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { listAlerts } from "../src/global/runtime/alerts/alert-store.js";
import { ALERT_STATES } from "../src/global/runtime/alerts/alert-types.js";
import { RUN_STATES } from "../src/global/runtime/run-types.js";
import {
  disableMonitor, enableMonitor, getMonitorStatus, installAutostart,
  monitorDoctorCheck, notifyNewAlert, resolveMonitorPlatform, runMonitorTick
} from "../src/global/runtime/monitor/monitor.js";

test("parseArgs routes monitor actions", () => {
  assert.equal(parseArgs(["monitor"]).options.monitorAction, "status");
  assert.throws(() => parseArgs(["monitor", "boom"]), /Unknown monitor action/);
});

test("tick alerts notify once; linux enable degrades", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-mon-"));
  const notes = [];
  const dead = { runId: "run_dead", state: RUN_STATES.RUNNING, startedAt: "2026-01-01T00:00:00.000Z" };
  const deps = {
    detectDriftImpl: async () => ([{ name: "c", status: "stale", category: "a", detail: "d" }]),
    listRunsImpl: async () => [dead], isRunAliveImpl: async () => false,
    notifyImpl: async (p) => { notes.push(p); return { sent: true }; }
  };
  const first = await runMonitorTick(homeDir, deps);
  assert.equal(first.state.lastTick.complete, true);
  assert.equal(notes.length, first.state.lastTick.created);
  assert.equal((await runMonitorTick(homeDir, deps)).raised.every((r) => r.deduped), true);
  assert.ok((await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length >= 2);
  const linux = resolveMonitorPlatform("linux");
  assert.equal((await enableMonitor(homeDir, { cliEntry: "/t/k.js", platform: linux })).enabled, true);
  await disableMonitor(homeDir, { platform: linux });
  assert.equal((await getMonitorStatus(homeDir)).enabled, false);
});

test("corrupt state unavailable; disable repairs; runs failure incomplete", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-mon-"));
  const { monitorDir, monitorStatePath } = harnessHomePaths(homeDir);
  await mkdir(monitorDir, { recursive: true });
  await writeFile(monitorStatePath, "{not-json");
  const status = await getMonitorStatus(homeDir);
  assert.equal(status.corrupt, true);
  assert.equal(status.enabled, null);
  assert.equal((await monitorDoctorCheck(homeDir)).status, "stale");
  await disableMonitor(homeDir, { platform: resolveMonitorPlatform("linux") });
  assert.equal((await getMonitorStatus(homeDir)).corrupt, false);

  const tick = await runMonitorTick(homeDir, {
    detectDriftImpl: async () => ([]),
    listRunsImpl: async () => { throw new Error("boom"); },
    notifyImpl: async () => ({ sent: false })
  });
  assert.equal(tick.state.lastTick.complete, false);
  assert.ok(tick.raised.some((r) => r.alert.kind === "monitor.runs-unavailable"));
});

test("bootstrap not loaded; win32 notify unsupported; shell:false", async () => {
  assert.equal(resolveMonitorPlatform("win32").supportsNotify, false);
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
  assert.equal(result.configured, true);
  assert.equal(result.loaded, false);
  assert.equal(result.installed, false);
  assert.match(await readFile(platform.plistPath, "utf8"), /tick<\/string>/);
});

test("nested invalid fails closed; tick does not repair; unloaded is stale", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-mon-"));
  const { monitorDir, monitorStatePath } = harnessHomePaths(homeDir);
  await mkdir(monitorDir, { recursive: true });
  const writeState = (body) => writeFile(monitorStatePath, `${JSON.stringify(body)}\n`);
  const baseAuto = {
    platform: "darwin", supported: true, configured: true, loaded: false, installed: false
  };
  await writeState({ version: 1, enabled: true, intervalSec: "bad", autostart: baseAuto });
  assert.equal((await getMonitorStatus(homeDir)).corrupt, true);
  await writeState({ version: 1, enabled: true, intervalSec: 300, autostart: "corrupt" });
  assert.equal((await getMonitorStatus(homeDir)).corrupt, true);
  await writeState({ version: 1, enabled: true, intervalSec: 300 });
  assert.equal((await getMonitorStatus(homeDir)).corrupt, true);
  await writeState({
    version: 1, enabled: true, intervalSec: 300,
    autostart: { ...baseAuto, loaded: true, configured: false, installed: false }
  });
  assert.equal((await getMonitorStatus(homeDir)).corrupt, true);
  await writeState({ version: 1, enabled: true, intervalSec: 300, autostart: "corrupt" });
  await assert.rejects(
    () => runMonitorTick(homeDir, {
      detectDriftImpl: async () => ([]), listRunsImpl: async () => [],
      notifyImpl: async () => ({ sent: false })
    }),
    (e) => e?.code === "corrupt_monitor_state" || /invalid|unreadable/i.test(String(e?.message))
  );
  assert.equal((await getMonitorStatus(homeDir)).corrupt, true);
  await writeState({ version: 1, enabled: true, intervalSec: 300, autostart: baseAuto });
  assert.equal((await monitorDoctorCheck(homeDir)).status, "stale");
});
