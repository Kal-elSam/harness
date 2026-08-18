"use strict";

const { spawnSync } = require("node:child_process");
const { existsSync, realpathSync } = require("node:fs");
const { basename, delimiter, isAbsolute, join } = require("node:path");

function parseNodeMajor(raw) {
  const match = String(raw ?? "").trim().replace(/^v/, "").match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

function resolveNodeExecutable(opts = {}) {
  const spawn = opts.spawnSync ?? spawnSync;
  const execPath = opts.execPath ?? process.execPath;
  const binName = process.platform === "win32" ? "node.exe" : "node";
  const seen = new Set();
  const list = [];
  if (execPath && isAbsolute(execPath) && /^(?:node|node\.exe)$/i.test(basename(execPath))) {
    list.push(execPath);
  }
  for (const dir of (opts.pathValue ?? process.env.PATH ?? "").split(delimiter)) {
    if (dir) list.push(join(dir, binName));
  }
  for (const candidate of list) {
    if (!candidate || seen.has(candidate) || !isAbsolute(candidate) || !existsSync(candidate)) continue;
    seen.add(candidate);
    const probed = spawn(candidate, ["-p", "process.versions.node"], { encoding: "utf8", timeout: 4000 });
    if (probed.status !== 0 || parseNodeMajor(probed.stdout) < 20) continue;
    try { return realpathSync(candidate); } catch { return candidate; }
  }
  return null;
}

function resolveWorkspaceBundlePath(extensionPath) {
  if (!extensionPath || !isAbsolute(extensionPath)) return null;
  const bundlePath = join(extensionPath, "dist", "kairo-workspace.cjs");
  return existsSync(bundlePath) ? bundlePath : null;
}

module.exports = { parseNodeMajor, resolveNodeExecutable, resolveWorkspaceBundlePath };
