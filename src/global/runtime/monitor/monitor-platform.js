import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
export const MONITOR_LABEL = "local.kairo.monitor";

export function resolveMonitorPlatform(platform = process.platform) {
  if (platform === "darwin") {
    const agentsDir = join(homedir(), "Library", "LaunchAgents");
    return {
      id: "darwin", supportsAutostart: true, supportsNotify: true,
      agentsDir, plistPath: join(agentsDir, `${MONITOR_LABEL}.plist`)
    };
  }
  return { id: platform, supportsAutostart: false, supportsNotify: platform === "linux" };
}

function gui() { return `gui/${process.getuid?.() ?? 501}`; }

function plist({ nodePath, cliEntry, homeDir, intervalSec }) {
  const e = (v) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
  const log = join(homeDir, ".harness", "monitor");
  const n = Math.max(60, Number(intervalSec) || 300);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${MONITOR_LABEL}</string>
<key>ProgramArguments</key><array><string>${e(nodePath)}</string><string>${e(cliEntry)}</string><string>monitor</string><string>tick</string></array>
<key>StartInterval</key><integer>${n}</integer><key>RunAtLoad</key><true/>
<key>EnvironmentVariables</key><dict><key>HARNESS_HOME</key><string>${e(homeDir)}</string></dict>
<key>StandardOutPath</key><string>${e(join(log, "out.log"))}</string>
<key>StandardErrorPath</key><string>${e(join(log, "err.log"))}</string>
</dict></plist>`;
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

export async function installAutostart({
  homeDir, platform = resolveMonitorPlatform(), nodePath, cliEntry,
  intervalSec = 300, execFileImpl = execFile
} = {}) {
  if (!platform.supportsAutostart) {
    return {
      supported: false, configured: false, loaded: false, installed: false,
      detail: `unsupported on ${platform.id}`
    };
  }
  await mkdir(platform.agentsDir, { recursive: true });
  await mkdir(join(homeDir, ".harness", "monitor"), { recursive: true });
  await writeFile(platform.plistPath, plist({ nodePath, cliEntry, homeDir, intervalSec }));
  try {
    await execFileImpl("launchctl", ["bootout", `${gui()}/${MONITOR_LABEL}`], { shell: false }).catch(() => {});
    await execFileImpl("launchctl", ["bootstrap", gui(), platform.plistPath], { shell: false });
    return { supported: true, configured: true, loaded: true, installed: true, detail: "LaunchAgent loaded" };
  } catch (error) {
    return {
      supported: true, configured: true, loaded: false, installed: false,
      detail: `plist configured; not loaded (${error?.message ?? error})`
    };
  }
}

export async function removeAutostart({
  platform = resolveMonitorPlatform(), execFileImpl = execFile
} = {}) {
  if (!platform.supportsAutostart) {
    return { supported: false, configured: false, loaded: false, installed: false };
  }
  await execFileImpl("launchctl", ["bootout", `${gui()}/${MONITOR_LABEL}`], { shell: false }).catch(() => {});
  if (platform.plistPath && existsSync(platform.plistPath)) await unlink(platform.plistPath).catch(() => {});
  return { supported: true, configured: false, loaded: false, installed: false };
}
