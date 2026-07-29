import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { harnessHomePaths } from "../../paths.js";
import { detectGlobalDrift, hasRepairableDrift } from "../../drift.js";
import { writeAtomicJson } from "../write-atomic-json.js";
import { listAlerts, saveAlert } from "../alerts/alert-store.js";
import { ALERT_SEVERITIES, ALERT_STATES } from "../alerts/alert-types.js";
import { listRunRecords } from "../run-store.js";
import { isRunAlive } from "../run-liveness.js";
import { RUN_STATES, isActiveRunState } from "../run-types.js";

const execFile = promisify(execFileCb);
const SOURCE = "monitor";
const LABEL = "local.kairo.monitor";
const INTERVAL = 300;

export function resolveMonitorPlatform(platform = process.platform) {
  if (platform === "darwin") {
    const agentsDir = join(homedir(), "Library", "LaunchAgents");
    return {
      id: "darwin", supportsAutostart: true, supportsNotify: true,
      agentsDir, plistPath: join(agentsDir, `${LABEL}.plist`)
    };
  }
  return {
    id: platform, supportsAutostart: false,
    supportsNotify: platform === "linux" || platform === "win32"
  };
}

export function defaultMonitorState() {
  return {
    version: 1, enabled: false, intervalSec: INTERVAL,
    lastTickAt: null, lastTick: null,
    autostart: { platform: null, installed: false, supported: false }, updatedAt: null
  };
}

export async function readMonitorState(homeDir) {
  const path = harnessHomePaths(homeDir).monitorStatePath;
  if (!existsSync(path)) return defaultMonitorState();
  try {
    return { ...defaultMonitorState(), ...JSON.parse(await readFile(path, "utf8")) };
  } catch {
    return defaultMonitorState();
  }
}

export async function writeMonitorState(homeDir, patch) {
  const { monitorDir, monitorStatePath } = harnessHomePaths(homeDir);
  await mkdir(monitorDir, { recursive: true });
  const next = { ...await readMonitorState(homeDir), ...patch, updatedAt: new Date().toISOString() };
  await writeAtomicJson(monitorStatePath, next);
  return next;
}

async function raise(homeDir, input, notifyImpl) {
  const result = await saveAlert({ ...input, source: SOURCE }, { homeDir });
  if (!result.deduped) {
    await notifyImpl({ title: "Kairo", body: `${result.alert.severity} · ${result.alert.title}` });
  }
  return result;
}

export async function notifyNewAlert({
  title, body, platform = resolveMonitorPlatform(), execFileImpl = execFile
} = {}) {
  const t = String(title ?? "Kairo").slice(0, 80);
  const b = String(body ?? "").slice(0, 180).replace(/[\r\n]+/g, " ");
  try {
    if (platform.id === "darwin") {
      await execFileImpl("osascript", [
        "-e", `display notification ${JSON.stringify(b)} with title ${JSON.stringify(t)}`
      ], { shell: false, timeout: 5000 });
      return { sent: true };
    }
    if (platform.id === "linux") {
      await execFileImpl("notify-send", [t, b], { shell: false, timeout: 5000 });
      return { sent: true };
    }
  } catch { /* degrade */ }
  return { sent: false };
}

function plistXml({ nodePath, cliEntry, homeDir, intervalSec }) {
  const e = (v) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
  const log = join(homeDir, ".harness", "monitor");
  const n = Math.max(60, Number(intervalSec) || 300);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${e(nodePath)}</string><string>${e(cliEntry)}</string><string>monitor</string><string>tick</string></array>
<key>StartInterval</key><integer>${n}</integer><key>RunAtLoad</key><true/>
<key>EnvironmentVariables</key><dict><key>HARNESS_HOME</key><string>${e(homeDir)}</string></dict>
<key>StandardOutPath</key><string>${e(join(log, "out.log"))}</string>
<key>StandardErrorPath</key><string>${e(join(log, "err.log"))}</string>
</dict></plist>`;
}

export async function installAutostart({
  homeDir, platform = resolveMonitorPlatform(), nodePath, cliEntry,
  intervalSec = INTERVAL, execFileImpl = execFile
} = {}) {
  if (!platform.supportsAutostart) {
    return { supported: false, installed: false, detail: `unsupported on ${platform.id}` };
  }
  await mkdir(platform.agentsDir, { recursive: true });
  await mkdir(join(homeDir, ".harness", "monitor"), { recursive: true });
  await writeFile(platform.plistPath, plistXml({ nodePath, cliEntry, homeDir, intervalSec }));
  const domain = `gui/${process.getuid?.() ?? 501}`;
  try {
    await execFileImpl("launchctl", ["bootout", `${domain}/${LABEL}`], { shell: false }).catch(() => {});
    await execFileImpl("launchctl", ["bootstrap", domain, platform.plistPath], { shell: false });
  } catch (error) {
    return { supported: true, installed: true, detail: `plist ok; launchctl deferred (${error?.message ?? error})` };
  }
  return { supported: true, installed: true, detail: "LaunchAgent installed" };
}

export async function removeAutostart({
  platform = resolveMonitorPlatform(), execFileImpl = execFile
} = {}) {
  if (!platform.supportsAutostart) return { supported: false, installed: false };
  const domain = `gui/${process.getuid?.() ?? 501}`;
  await execFileImpl("launchctl", ["bootout", `${domain}/${LABEL}`], { shell: false }).catch(() => {});
  if (platform.plistPath && existsSync(platform.plistPath)) await unlink(platform.plistPath).catch(() => {});
  return { supported: true, installed: false };
}

export async function runMonitorTick(homeDir, deps = {}) {
  const {
    notifyImpl = notifyNewAlert,
    detectDriftImpl = detectGlobalDrift,
    listRunsImpl = listRunRecords,
    isRunAliveImpl = isRunAlive,
    packageRoot = null,
    workspaceRoot = null
  } = deps;
  const raised = [];
  await mkdir(harnessHomePaths(homeDir).monitorDir, { recursive: true });
  try {
    const paths = harnessHomePaths(homeDir);
    const state = existsSync(paths.statePath)
      ? JSON.parse(await readFile(paths.statePath, "utf8")) : null;
    const checks = await detectDriftImpl({
      homeDir, paths, state, packageRoot, workspaceRoot, context: { homeDir }
    });
    if (hasRepairableDrift(checks)) {
      raised.push(await raise(homeDir, {
        kind: "monitor.drift", title: "Managed configuration drift",
        summary: "Managed configs drifted. Run kairo sync.", severity: ALERT_SEVERITIES.HIGH
      }, notifyImpl));
    }
  } catch {
    raised.push(await raise(homeDir, {
      kind: "monitor.drift", title: "Governance scan unavailable",
      summary: "Monitor could not complete the drift scan.", severity: ALERT_SEVERITIES.MEDIUM
    }, notifyImpl));
  }
  let dead = 0; let failed = 0;
  try {
    for (const run of await listRunsImpl(homeDir, { limit: 40 })) {
      if (isActiveRunState(run.state) && !(await isRunAliveImpl(homeDir, run))) dead += 1;
      if (run.state === RUN_STATES.FAILED) failed += 1;
    }
  } catch { /* ignore */ }
  if (dead > 0) {
    raised.push(await raise(homeDir, {
      kind: "run.orphaned", title: "Orphaned agent run",
      summary: `${dead} active run(s) have no live process.`, severity: ALERT_SEVERITIES.HIGH
    }, notifyImpl));
  }
  if (failed > 0) {
    raised.push(await raise(homeDir, {
      kind: "run.failed", title: "Agent run failed",
      summary: `${failed} failed run(s) need attention.`, severity: ALERT_SEVERITIES.MEDIUM
    }, notifyImpl));
  }
  const lastTick = {
    raised: raised.length,
    created: raised.filter((r) => !r.deduped).length,
    deduped: raised.filter((r) => r.deduped).length
  };
  return {
    state: await writeMonitorState(homeDir, { lastTickAt: new Date().toISOString(), lastTick }),
    raised
  };
}

export async function enableMonitor(homeDir, {
  cliEntry, nodePath = process.execPath, platform = resolveMonitorPlatform(), intervalSec = INTERVAL
} = {}) {
  const autostart = await installAutostart({ homeDir, platform, nodePath, cliEntry, intervalSec });
  return writeMonitorState(homeDir, {
    enabled: true, intervalSec,
    autostart: {
      platform: platform.id, supported: autostart.supported,
      installed: autostart.installed, detail: autostart.detail ?? null
    }
  });
}

export async function disableMonitor(homeDir, { platform = resolveMonitorPlatform() } = {}) {
  const autostart = await removeAutostart({ platform });
  return writeMonitorState(homeDir, {
    enabled: false,
    autostart: {
      platform: platform.id, supported: autostart.supported,
      installed: false, detail: autostart.detail ?? null
    }
  });
}

export async function getMonitorStatus(homeDir, { platform = resolveMonitorPlatform() } = {}) {
  const state = await readMonitorState(homeDir);
  let openAlerts = 0;
  try {
    openAlerts = (await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length;
  } catch { openAlerts = null; }
  return {
    enabled: state.enabled, intervalSec: state.intervalSec,
    lastTickAt: state.lastTickAt, lastTick: state.lastTick, autostart: state.autostart,
    platform: platform.id,
    notify: { supported: platform.supportsNotify, backend: platform.id },
    openAlerts
  };
}

export async function monitorDoctorCheck(homeDir) {
  const s = await getMonitorStatus(homeDir);
  return {
    name: "monitor", status: "ok", category: "monitor",
    detail: s.enabled
      ? `enabled · last ${s.lastTickAt ?? "none"} · autostart ${s.autostart?.installed ? "on" : "off"}`
      : "disabled (opt-in · kairo monitor enable)"
  };
}
