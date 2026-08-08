/**
 * Live OpenCode fleet activity from opencode.db (read-only).
 * Parent→child sessions via session.parent_id — not token telemetry.
 */
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { resolveHomeDir } from "../paths.js";

const DEFAULT_LIMIT = 40;
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveOpenCodeDbPath(homeDir = resolveHomeDir()) {
  return join(homeDir, ".local", "share", "opencode", "opencode.db");
}

export function parseSessionModel(raw) {
  if (raw == null || raw === "") return { model: null, modelShort: null, providerId: null };
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const id = typeof raw.id === "string" ? raw.id : null;
    const providerID = typeof raw.providerID === "string" ? raw.providerID : null;
    const model = id && providerID ? `${providerID}/${id}` : id;
    return { model, modelShort: id, providerId: providerID };
  }
  if (typeof raw !== "string") return { model: null, modelShort: null, providerId: null };
  try {
    return parseSessionModel(JSON.parse(raw));
  } catch {
    const slash = raw.lastIndexOf("/");
    return {
      model: raw,
      modelShort: slash >= 0 ? raw.slice(slash + 1) : raw,
      providerId: slash >= 0 ? raw.slice(0, slash) : null
    };
  }
}

function sessionState(row, nowMs, activeWindowMs) {
  if (row.time_archived) return "archived";
  if (typeof row.time_updated === "number" && nowMs - row.time_updated <= activeWindowMs) {
    return "active";
  }
  return "idle";
}

/**
 * Pure mapper: DB rows → activity tree nodes.
 */
export function mapSessionRowsToActivity(rows = [], {
  nowMs = Date.now(),
  activeWindowMs = ACTIVE_WINDOW_MS
} = {}) {
  const sessions = rows.map((row) => {
    const parsed = parseSessionModel(row.model);
    return {
      id: String(row.id),
      parentId: row.parent_id ? String(row.parent_id) : null,
      title: typeof row.title === "string" ? row.title : "",
      agent: typeof row.agent === "string" ? row.agent : null,
      model: parsed.model,
      modelShort: parsed.modelShort,
      providerId: parsed.providerId,
      timeCreated: row.time_created ?? null,
      timeUpdated: row.time_updated ?? null,
      state: sessionState(row, nowMs, activeWindowMs),
      platform: "opencode"
    };
  });

  const byAgent = new Map();
  for (const s of sessions) {
    const key = s.agent ?? "unknown";
    const prev = byAgent.get(key);
    if (!prev || (s.timeUpdated ?? 0) > (prev.timeUpdated ?? 0)) {
      byAgent.set(key, s);
    }
  }

  const agents = [...byAgent.entries()]
    .map(([id, session]) => ({
      id,
      state: session.state === "archived" ? "idle" : session.state,
      model: session.model,
      modelShort: session.modelShort,
      sessionId: session.id,
      parentId: session.parentId,
      title: session.title,
      timeUpdated: session.timeUpdated
    }))
    .sort((a, b) => {
      if (a.state === "active" && b.state !== "active") return -1;
      if (b.state === "active" && a.state !== "active") return 1;
      return (b.timeUpdated ?? 0) - (a.timeUpdated ?? 0);
    });

  return {
    platform: "opencode",
    sessions,
    agents,
    activeCount: agents.filter((a) => a.state === "active").length,
    source: "opencode.db"
  };
}

function openReadonlyDb(dbPath, DatabaseSync) {
  return new DatabaseSync(dbPath, { readOnly: true });
}

/**
 * Read recent OpenCode sessions (read-only). Inject openDatabase for tests.
 */
export async function buildOpenCodeActivity({
  homeDir = resolveHomeDir(),
  limit = DEFAULT_LIMIT,
  activeWindowMs = ACTIVE_WINDOW_MS,
  nowMs = Date.now(),
  exists = pathExists,
  openDatabase = null,
  DatabaseSync = null
} = {}) {
  const dbPath = resolveOpenCodeDbPath(homeDir);
  if (!(await exists(dbPath))) {
    return {
      ok: true,
      available: false,
      note: "OpenCode session DB not found.",
      dbPath,
      platform: "opencode",
      sessions: [],
      agents: [],
      activeCount: 0,
      generatedAt: new Date(nowMs).toISOString()
    };
  }

  let rows = [];
  try {
    let Database = DatabaseSync;
    if (!Database) {
      const prior = process.emitWarning;
      process.emitWarning = function muted(warning, ...rest) {
        const msg = typeof warning === "string" ? warning : (warning?.message ?? "");
        if (/SQLite is an experimental feature/i.test(String(msg))) return;
        return prior.apply(process, [warning, ...rest]);
      };
      try {
        ({ DatabaseSync: Database } = await import("node:sqlite"));
      } finally {
        process.emitWarning = prior;
      }
    }
    const open = openDatabase ?? ((path) => openReadonlyDb(path, Database));
    const db = open(dbPath);
    try {
      const stmt = db.prepare(`
        SELECT id, parent_id, title, agent, model, time_created, time_updated, time_archived
        FROM session
        ORDER BY time_updated DESC
        LIMIT ?
      `);
      rows = stmt.all(Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 200)));
    } finally {
      db.close?.();
    }
  } catch (error) {
    return {
      ok: false,
      available: false,
      note: `Could not read OpenCode DB: ${error?.message ?? error}`,
      dbPath,
      platform: "opencode",
      sessions: [],
      agents: [],
      activeCount: 0,
      generatedAt: new Date(nowMs).toISOString()
    };
  }

  const mapped = mapSessionRowsToActivity(rows, { nowMs, activeWindowMs });
  return {
    ok: true,
    available: true,
    note: "Live OpenCode sessions (declared parent→child). Not Cursor/Claude live.",
    dbPath,
    ...mapped,
    generatedAt: new Date(nowMs).toISOString()
  };
}
