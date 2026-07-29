import { join } from "node:path";
import { resolveHomeDir } from "../../paths.js";
import { printJson } from "../../json-output.js";
import { commandHeader } from "../../brand/index.js";
import {
  disableMonitor, enableMonitor, getMonitorStatus, runMonitorTick
} from "./monitor.js";

export async function runGlobalMonitor(options, _manifest, deps = {}) {
  const homeDir = deps.homeDir ?? resolveHomeDir();
  const action = options.monitorAction ?? "status";
  const packageRoot = deps.packageRoot;
  const entry = deps.cliEntry ?? (packageRoot ? join(packageRoot, "bin", "kairo.js") : null);
  try {
    if (action === "enable") {
      await (deps.enableMonitorImpl ?? enableMonitor)(homeDir, {
        cliEntry: entry, nodePath: deps.nodePath ?? process.execPath, platform: deps.platform
      });
      await (deps.runMonitorTickImpl ?? runMonitorTick)(homeDir, {
        packageRoot, workspaceRoot: options.cwd, notifyImpl: deps.notifyImpl
      });
    } else if (action === "disable") {
      await (deps.disableMonitorImpl ?? disableMonitor)(homeDir, { platform: deps.platform });
    } else if (action === "tick") {
      const result = await (deps.runMonitorTickImpl ?? runMonitorTick)(homeDir, {
        packageRoot, workspaceRoot: options.cwd, notifyImpl: deps.notifyImpl
      });
      return done(options, { ok: true, action, raised: result.raised.length, lastTick: result.state.lastTick });
    }
    const status = await (deps.getMonitorStatusImpl ?? getMonitorStatus)(homeDir, {
      platform: deps.platform
    });
    return done(options, { ok: true, action: action === "status" ? "status" : action, ...status });
  } catch (error) {
    const message = String(error?.message ?? error);
    if (options.json) printJson({ ok: false, error: message });
    else console.error(message);
    process.exitCode = 1;
    return { ok: false, error: message };
  }
}

function done(options, payload) {
  if (options.json) { printJson(payload); return payload; }
  console.log(commandHeader(`monitor ${payload.action}`));
  if (payload.action === "tick") {
    console.log(`Raised ${payload.raised} alert(s) this tick.`);
    return payload;
  }
  console.log(`Enabled: ${payload.corrupt ? "unavailable" : payload.enabled ? "yes" : "no"} · ${payload.platform}`);
  if (payload.corrupt) console.log("State: corrupt — run monitor disable to repair");
  else {
    const a = payload.autostart;
    console.log(`Autostart: ${a?.loaded ? "loaded" : a?.configured ? "configured (not loaded)" : "off"}`
      + `${a?.supported === false ? " (unsupported)" : ""}`);
  }
  console.log(`Open alerts: ${payload.openAlerts ?? "unavailable"}`);
  if (payload.lastTickAt) {
    console.log(`Last tick: ${payload.lastTickAt}${payload.lastTick?.complete === false ? " (incomplete)" : ""}`);
  }
  return payload;
}
