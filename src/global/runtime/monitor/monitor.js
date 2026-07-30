import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { harnessHomePaths } from "../../paths.js";
import { detectGlobalDrift, hasRepairableDrift } from "../../drift.js";
import { writeAtomicJson } from "../write-atomic-json.js";
import { listAlerts, saveAlert } from "../alerts/alert-store.js";
import { ALERT_SEVERITIES, ALERT_STATES } from "../alerts/alert-types.js";
import { listRunRecords } from "../run-store.js";
import { isRunAlive } from "../run-liveness.js";
import { RUN_STATES, isActiveRunState } from "../run-types.js";
import {
  installAutostart, notifyNewAlert, removeAutostart, resolveMonitorPlatform
} from "./monitor-platform.js";

export {
  installAutostart, notifyNewAlert, removeAutostart, resolveMonitorPlatform
} from "./monitor-platform.js";

const SOURCE = "monitor";
const INTERVAL = 300;

export class MonitorStateError extends Error {
  constructor(message, { code = "corrupt_monitor_state" } = {}) {
    super(message);
    this.name = "MonitorStateError";
    this.code = code;
  }
}

export function defaultMonitorState() {
  return {
    version: 1, enabled: false, intervalSec: INTERVAL,
    lastTickAt: null, lastTick: null,
    autostart: {
      platform: null, installed: false, supported: false, configured: false, loaded: false
    },
    updatedAt: null
  };
}

function assertMonitorState(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1 || typeof raw.enabled !== "boolean") {
    throw new MonitorStateError("Monitor state schema invalid.");
  }
  if (!Number.isFinite(raw.intervalSec) || raw.intervalSec < 1) {
    throw new MonitorStateError("Monitor state.intervalSec invalid.");
  }
  const a = raw.autostart;
  if (!a || typeof a !== "object"
    || typeof a.supported !== "boolean"
    || typeof a.configured !== "boolean"
    || typeof a.loaded !== "boolean"
    || typeof a.installed !== "boolean") {
    throw new MonitorStateError("Monitor state.autostart invalid.");
  }
  if (a.loaded && !a.configured) {
    throw new MonitorStateError("Monitor state.autostart loaded requires configured.");
  }
  if (a.installed !== a.loaded) {
    throw new MonitorStateError("Monitor state.autostart installed must equal loaded.");
  }
  if (!a.supported && (a.configured || a.loaded || a.installed)) {
    throw new MonitorStateError("Monitor state.autostart unsupported with lifecycle flags.");
  }
  if (!raw.enabled && (a.configured || a.loaded || a.installed)) {
    throw new MonitorStateError("Monitor disabled with active autostart lifecycle.");
  }
  return {
    ...defaultMonitorState(),
    ...raw,
    version: 1,
    enabled: raw.enabled,
    intervalSec: raw.intervalSec,
    autostart: { ...defaultMonitorState().autostart, ...a }
  };
}

export async function readMonitorState(homeDir, { repair = false } = {}) {
  const path = harnessHomePaths(homeDir).monitorStatePath;
  if (!existsSync(path)) return defaultMonitorState();
  try {
    return assertMonitorState(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (repair) return defaultMonitorState();
    if (error instanceof MonitorStateError) throw error;
    throw new MonitorStateError("Monitor state unreadable.");
  }
}

export async function writeMonitorState(homeDir, patch, { repair = false } = {}) {
  const { monitorDir, monitorStatePath } = harnessHomePaths(homeDir);
  await mkdir(monitorDir, { recursive: true });
  const next = {
    ...await readMonitorState(homeDir, { repair }), ...patch,
    updatedAt: new Date().toISOString()
  };
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

function autostartRecord(platform, a) {
  return {
    platform: platform.id, supported: a.supported,
    configured: Boolean(a.configured), loaded: Boolean(a.loaded),
    installed: Boolean(a.loaded), detail: a.detail ?? null
  };
}

export async function runMonitorTick(homeDir, deps = {}) {
  const {
    notifyImpl = notifyNewAlert, detectDriftImpl = detectGlobalDrift,
    listRunsImpl = listRunRecords, isRunAliveImpl = isRunAlive,
    packageRoot = null, workspaceRoot = null
  } = deps;
  const raised = [];
  await mkdir(harnessHomePaths(homeDir).monitorDir, { recursive: true });
  try {
    const paths = harnessHomePaths(homeDir);
    const state = existsSync(paths.statePath)
      ? JSON.parse(await readFile(paths.statePath, "utf8")) : null;
    if (hasRepairableDrift(await detectDriftImpl({
      homeDir, paths, state, packageRoot, workspaceRoot, context: { homeDir }
    }))) {
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

  let runsOk = true; let dead = 0; let failed = 0;
  try {
    for (const run of await listRunsImpl(homeDir, { limit: 40 })) {
      if (isActiveRunState(run.state) && !(await isRunAliveImpl(homeDir, run))) dead += 1;
      if (run.state === RUN_STATES.FAILED) failed += 1;
    }
  } catch {
    runsOk = false;
    raised.push(await raise(homeDir, {
      kind: "monitor.runs-unavailable", title: "Run monitoring unavailable",
      summary: "Monitor could not inspect agent run health this tick.",
      severity: ALERT_SEVERITIES.MEDIUM
    }, notifyImpl));
  }
  if (runsOk && dead > 0) {
    raised.push(await raise(homeDir, {
      kind: "run.orphaned", title: "Orphaned agent run",
      summary: `${dead} active run(s) have no live process.`, severity: ALERT_SEVERITIES.HIGH
    }, notifyImpl));
  }
  if (runsOk && failed > 0) {
    raised.push(await raise(homeDir, {
      kind: "run.failed", title: "Agent run failed",
      summary: `${failed} failed run(s) need attention.`, severity: ALERT_SEVERITIES.MEDIUM
    }, notifyImpl));
  }

  const lastTick = {
    raised: raised.length,
    created: raised.filter((r) => !r.deduped).length,
    deduped: raised.filter((r) => r.deduped).length,
    complete: runsOk, runs: runsOk ? "ok" : "unavailable"
  };
  return {
    state: await writeMonitorState(homeDir, {
      lastTickAt: new Date().toISOString(), lastTick
    }),
    raised
  };
}

export async function enableMonitor(homeDir, {
  cliEntry, nodePath = process.execPath, platform = resolveMonitorPlatform(), intervalSec = INTERVAL
} = {}) {
  const autostart = await installAutostart({ homeDir, platform, nodePath, cliEntry, intervalSec });
  try {
    return await writeMonitorState(homeDir, {
      enabled: true, intervalSec, autostart: autostartRecord(platform, autostart)
    }, { repair: true });
  } catch (error) {
    if (autostart.loaded) await removeAutostart({ platform });
    throw error;
  }
}

export async function disableMonitor(homeDir, { platform = resolveMonitorPlatform() } = {}) {
  return writeMonitorState(homeDir, {
    enabled: false, autostart: autostartRecord(platform, await removeAutostart({ platform }))
  }, { repair: true });
}

export async function getMonitorStatus(homeDir, { platform = resolveMonitorPlatform() } = {}) {
  try {
    const state = await readMonitorState(homeDir);
    let openAlerts = 0;
    try {
      openAlerts = (await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length;
    } catch { openAlerts = null; }
    return {
      available: true, corrupt: false, enabled: state.enabled, intervalSec: state.intervalSec,
      lastTickAt: state.lastTickAt, lastTick: state.lastTick, autostart: state.autostart,
      platform: platform.id,
      notify: { supported: platform.supportsNotify, backend: platform.id }, openAlerts
    };
  } catch (error) {
    if (error?.code !== "corrupt_monitor_state") throw error;
    return {
      available: false, corrupt: true, enabled: null, intervalSec: null,
      lastTickAt: null, lastTick: null, autostart: null, platform: platform.id,
      notify: { supported: platform.supportsNotify, backend: platform.id },
      openAlerts: null, error: error.message
    };
  }
}

export async function monitorDoctorCheck(homeDir) {
  const s = await getMonitorStatus(homeDir);
  if (s.corrupt || s.available === false) {
    return {
      name: "monitor", status: "stale", category: "monitor",
      detail: "corrupt state — run kairo monitor disable to repair"
    };
  }
  if (s.enabled && s.autostart?.supported && !s.autostart?.loaded) {
    return {
      name: "monitor", status: "stale", category: "monitor",
      detail: "enabled but autostart not loaded"
    };
  }
  return {
    name: "monitor", status: "ok", category: "monitor",
    detail: s.enabled
      ? `enabled · last ${s.lastTickAt ?? "none"} · autostart ${s.autostart?.loaded ? "loaded" : "off"}`
      : "disabled (opt-in · kairo monitor enable)"
  };
}
