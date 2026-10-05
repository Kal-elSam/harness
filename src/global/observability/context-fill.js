import { open, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readCursorFill } from "./context-fill-cursor.js";

const HEAD_BYTES = 65_536;
const TAIL_BYTES = 512_000;
const CLAUDE_CONTEXT_WINDOWS = {
  "claude-sonnet-5-5": 1_000_000
};

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function contextBand(ratio) {
  if (typeof ratio !== "number") return "unknown";
  if (ratio < 0.5) return "comfortable";
  if (ratio < 0.7) return "handoff";
  return "saturated";
}

export function claudeProjectKey(cwd) {
  return resolve(cwd).replaceAll("/", "-");
}

function reading(adapter, status, extra = {}) {
  const ratio = typeof extra.ratio === "number" ? extra.ratio : null;
  return {
    adapter,
    status,
    used: extra.used ?? null,
    limit: extra.limit ?? null,
    ratio,
    band: contextBand(ratio),
    model: extra.model ?? null,
    detail: extra.detail ?? null
  };
}

export function codexFillFromRecord(record) {
  const payload = record?.payload ?? {};
  if (record?.type === "session_meta") {
    const limit = finite(payload.context_window);
    return {
      cwd: typeof payload.cwd === "string" ? payload.cwd : null,
      limit: limit > 0 ? limit : null
    };
  }
  const info = payload.info ?? payload;
  const last = info?.last_token_usage;
  if (!last || typeof last !== "object") return null;
  const used = finite(last.total_tokens) ?? finite(last.input_tokens);
  const limit = finite(info.model_context_window);
  if (used == null) return null;
  return { used, limit: limit > 0 ? limit : null };
}

export function claudeFillFromRecord(record) {
  if (record?.type !== "assistant") return null;
  const model = record.message?.model;
  if (typeof model !== "string" || model === "<synthetic>") return null;
  const usage = record.message?.usage;
  if (!usage || typeof usage !== "object") return null;
  const used = (finite(usage.input_tokens) ?? 0)
    + (finite(usage.cache_read_input_tokens) ?? 0)
    + (finite(usage.cache_creation_input_tokens) ?? 0);
  if (used <= 0) return null;
  return { used, model };
}

async function readSlice(path, { start, length }) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function parseLines(text, { dropPartialHead = false } = {}) {
  const lines = text.split("\n");
  if (dropPartialHead) lines.shift();
  const records = [];
  for (const line of lines) {
    if (!line.includes("token") && !line.includes("session_meta") && !line.includes("assistant")) continue;
    try { records.push(JSON.parse(line)); } catch { /* skip a partial or non-json line */ }
  }
  return records;
}

async function listJsonl(dir) {
  const found = [];
  async function walk(current, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "subagents") continue;
        await walk(path, depth + 1);
      } else if (entry.name.endsWith(".jsonl")) {
        const info = await stat(path);
        found.push({ path, mtimeMs: info.mtimeMs, size: info.size });
      }
    }
  }
  await walk(dir, 0);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found;
}

async function readCodex(homeDir, cwd) {
  const files = await listJsonl(join(homeDir, ".codex", "sessions"));
  const target = resolve(cwd);
  for (const file of files) {
    const head = await readSlice(file.path, { start: 0, length: Math.min(HEAD_BYTES, file.size) });
    const meta = parseLines(head).map(codexFillFromRecord).find((item) => item?.cwd);
    if (!meta || resolve(meta.cwd) !== target) continue;
    const tailStart = Math.max(0, file.size - TAIL_BYTES);
    const tail = await readSlice(file.path, { start: tailStart, length: file.size - tailStart });
    const usage = parseLines(tail, { dropPartialHead: tailStart > 0 }).map(codexFillFromRecord).filter((item) => item?.used != null).at(-1);
    if (!usage) return reading("codex", "absent", { detail: "Session matches this directory but has no token record yet." });
    const limit = usage.limit ?? meta.limit;
    const ratio = limit ? usage.used / limit : null;
    return reading("codex", ratio == null ? "tokens_only" : "measured", {
      used: usage.used,
      limit,
      ratio,
      detail: "Last Codex turn versus model_context_window."
    });
  }
  return reading("codex", "absent", { detail: "No Codex session for this directory." });
}

async function readClaude(homeDir, cwd) {
  const files = await listJsonl(join(homeDir, ".claude", "projects", claudeProjectKey(cwd)));
  const file = files[0];
  if (!file) return reading("claude", "absent", { detail: "No Claude session for this directory." });
  const tailStart = Math.max(0, file.size - TAIL_BYTES);
  const tail = await readSlice(file.path, { start: tailStart, length: file.size - tailStart });
  const usage = parseLines(tail, { dropPartialHead: tailStart > 0 }).map(claudeFillFromRecord).filter(Boolean).at(-1);
  if (!usage) return reading("claude", "absent", { detail: "Claude session has no measured assistant usage." });
  const limit = CLAUDE_CONTEXT_WINDOWS[usage.model] ?? null;
  if (!limit) {
    return reading("claude", "tokens_only", {
      used: usage.used,
      model: usage.model,
      detail: "Claude stores tokens, not a trustworthy window size, so there is no percentage."
    });
  }
  const ratio = usage.used / limit;
  return reading("claude", "measured", {
    used: usage.used,
    limit,
    ratio,
    model: usage.model
  });
}

async function readOpenCode(homeDir, cwd) {
  const dbPath = join(homeDir, ".local", "share", "opencode", "opencode.db");
  try { await stat(dbPath); } catch {
    return reading("opencode", "absent", { detail: "No OpenCode database." });
  }
  let DatabaseSync;
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    const text = typeof warning === "string" ? warning : warning?.message ?? "";
    if (text.includes("SQLite is an experimental feature")) return;
    return emitWarning.call(process, warning, ...args);
  };
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return reading("opencode", "unavailable", { detail: "node:sqlite is unavailable." });
  } finally {
    process.emitWarning = emitWarning;
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare(`
      SELECT tokens_input, tokens_cache_read, tokens_output, model
      FROM session
      WHERE directory = ? AND time_archived IS NULL
      ORDER BY time_updated DESC
      LIMIT 1
    `).get(resolve(cwd));
    if (!row) return reading("opencode", "absent", { detail: "No OpenCode session for this directory." });
    const used = (finite(row.tokens_input) ?? 0) + (finite(row.tokens_cache_read) ?? 0);
    let model = null;
    try { model = JSON.parse(row.model)?.id ?? null; } catch { model = typeof row.model === "string" ? row.model : null; }
    if (used <= 0) return reading("opencode", "absent", { model, detail: "OpenCode session has no tokens yet." });
    return reading("opencode", "cumulative", {
      used,
      model,
      detail: "OpenCode session counters accumulate across the chat. They are not the live window."
    });
  } catch {
    return reading("opencode", "unavailable", { detail: "OpenCode database could not be read." });
  } finally {
    db?.close();
  }
}

export async function readContextFill({ homeDir, cwd = process.cwd() } = {}) {
  const root = resolve(cwd);
  const home = resolve(homeDir);
  const [codex, claude, opencode, cursor] = await Promise.all([
    readCodex(home, root),
    readClaude(home, root),
    readOpenCode(home, root),
    readCursorFill(home, root)
  ]);
  return { cwd: root, readings: [codex, claude, opencode, cursor] };
}

export function formatContextFill(report) {
  const lines = [`Context fill for ${report.cwd}`, ""];
  for (const item of report.readings) {
    const percent = item.ratio == null ? "  —" : `${Math.round(item.ratio * 100)}%`.padStart(4, " ");
    const used = item.used == null ? "" : ` ${item.used}${item.limit ? ` / ${item.limit}` : " tokens"}`;
    lines.push(`${item.adapter.padEnd(9)} ${percent}  ${item.status.padEnd(12)}${used}`);
    if (item.detail) lines.push(`          ${item.detail}`);
  }
  return lines.join("\n");
}
