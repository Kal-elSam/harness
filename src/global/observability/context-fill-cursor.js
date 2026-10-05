import { stat } from "node:fs/promises";
import { join } from "node:path";

function contextBand(ratio) {
  if (typeof ratio !== "number") return "unknown";
  if (ratio < 0.5) return "comfortable";
  if (ratio < 0.7) return "handoff";
  return "saturated";
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function reading(status, extra = {}) {
  const ratio = typeof extra.ratio === "number" ? extra.ratio : null;
  return {
    adapter: "cursor",
    status,
    used: null,
    limit: null,
    ratio,
    band: contextBand(ratio),
    model: null,
    detail: extra.detail ?? null
  };
}

export function cursorStatePath(homeDir) {
  if (process.platform !== "darwin") return null;
  return join(homeDir, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
}

export function cursorFillFromHeader(value, cwd) {
  let data;
  try {
    data = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
  if (data?.workspaceIdentifier?.uri?.fsPath !== cwd) return null;
  const percent = finite(data.contextUsagePercent);
  if (percent == null) return null;
  const ratio = percent / 100;
  return reading("measured", { ratio });
}

async function openSqlite(dbPath) {
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    const text = typeof warning === "string" ? warning : warning?.message ?? "";
    if (text.includes("SQLite is an experimental feature")) return;
    return emitWarning.call(process, warning, ...args);
  };
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(dbPath, { readOnly: true });
  } finally {
    process.emitWarning = emitWarning;
  }
}

export async function readCursorFill(homeDir, cwd) {
  const dbPath = cursorStatePath(homeDir);
  if (!dbPath) return reading("unavailable", { detail: "Cursor context is only read from the macOS state database." });
  try { await stat(dbPath); } catch {
    return reading("absent", { detail: "No Cursor state database." });
  }
  let db;
  try {
    db = await openSqlite(dbPath);
    const rows = db.prepare("SELECT value FROM composerHeaders ORDER BY lastUpdatedAt DESC LIMIT 30").all();
    for (const row of rows) {
      const fill = cursorFillFromHeader(row.value, cwd);
      if (fill) return fill;
    }
    return reading("absent", { detail: "No Cursor composer for this directory." });
  } catch {
    return reading("unavailable", { detail: "Cursor state database could not be read." });
  } finally {
    db?.close();
  }
}
