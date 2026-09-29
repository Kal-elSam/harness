// Append-only, per-Kairo-session log of the normalized ASK turns the sidecar
// streamed to the Rust host (`provider_event` records), so a switch, restart
// or resume can rebuild the exact history the human saw live.
//
// ASK answers never enter Pi, so Pi's `get_messages` can not restore them;
// `ask-history.json` (ask-history-store.js) is a prompt-context log with no
// tool/progress/cancel information. This file is the third, purpose-built
// record and it never replaces or feeds either of the other two.
//
// Layout: `<sessionDir>/ask-events.jsonl`, one JSON object per line, each
// with `v: 1`, `type`, `turnId`, `seq` and `at`:
//
//   {v:1,type:"turn_start",turnId,seq:0,at,prompt,piAnchor}
//   {v:1,type:"event",turnId,seq,at,kind,provider,...fields}
//   {v:1,type:"turn_end",turnId,seq,at,status:"done"|"cancelled"|"failed",message?}
//
// - `turn_start.piAnchor` is the number of Pi transcript rows known when the
//   prompt was submitted (best effort, `null` when unknown).
// - `event` mirrors a non-terminal `provider_event` (`progress|text|
//   tool_start|tool_end|error|final`) with its wire `seq`, plus one synthetic
//   `kind:"answer"` event (`{provider,model,text}`) written ONLY when no
//   non-empty `text` event carried the answer. It shares the `seq` of the
//   record before it (the wire has no seq slot between the last event and the
//   terminal); file order is authoritative.
// - `turn_end` is the terminal record (`done|cancelled|failed`), exactly once.
//
// Growth policy: when a `turn_start` makes the file hold more than
// MAX_STORED_TURNS turns, the file is rewritten keeping only the last
// MAX_STORED_TURNS turns (whole turns, never a partial one).
//
// Reliability: every write is best-effort and never throws into the ASK flow;
// reads skip unparsable lines (including a partial trailing line) and a
// missing file reads as no turns.

import { appendFile, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isValidSessionId, sessionDirFor } from "./session-registry.js";

export const ASK_EVENTS_VERSION = 1;
export const MAX_STORED_TURNS = 200;

/** @returns {string|null} null when the session id can not name a directory */
export function askEventsPath(homeDir, projectRoot, sessionId) {
  if (!homeDir || !projectRoot || !isValidSessionId(sessionId)) return null;
  return join(sessionDirFor(homeDir, projectRoot, sessionId), "ask-events.jsonl");
}

function parseLines(raw) {
  const records = [];
  for (const line of String(raw).split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === "object" && !Array.isArray(rec)
        && rec.v === ASK_EVENTS_VERSION && typeof rec.turnId === "string"
        && (rec.type === "turn_start" || rec.type === "event" || rec.type === "turn_end")) {
        records.push(rec);
      }
    } catch {
      // Corrupt or partially written line: skip it, keep the rest.
    }
  }
  return records;
}

async function readRecords(path, deps = {}) {
  try {
    return parseLines(await (deps.readFile ?? readFile)(path, "utf8"));
  } catch {
    return [];
  }
}

/**
 * Groups stored records into turns, in `turn_start` order. Records of a turn
 * without a `turn_start` are ignored. A turn with no `turn_end` (host killed
 * mid-turn) has `status: null`.
 * @returns {Array<{turnId: string, prompt: string, piAnchor: number|null, at: string|null,
 *   events: object[], status: "done"|"cancelled"|"failed"|null, message: string|null}>}
 */
export function groupTurns(records) {
  const turns = new Map();
  for (const rec of records) {
    if (rec.type === "turn_start") {
      if (turns.has(rec.turnId)) continue;
      turns.set(rec.turnId, {
        turnId: rec.turnId,
        prompt: typeof rec.prompt === "string" ? rec.prompt : "",
        piAnchor: Number.isInteger(rec.piAnchor) && rec.piAnchor >= 0 ? rec.piAnchor : null,
        at: typeof rec.at === "string" ? rec.at : null,
        events: [],
        status: null,
        message: null
      });
      continue;
    }
    const turn = turns.get(rec.turnId);
    if (!turn) continue;
    if (rec.type === "event" && typeof rec.kind === "string") {
      if (turn.status === null) turn.events.push(rec);
    } else if (rec.type === "turn_end" && turn.status === null
      && (rec.status === "done" || rec.status === "cancelled" || rec.status === "failed")) {
      turn.status = rec.status;
      turn.message = typeof rec.message === "string" ? rec.message : null;
    }
  }
  return [...turns.values()];
}

/** Reads the stored ASK turns for one Kairo session; `[]` for a missing/unreadable file or no session. */
export async function readAskTurns(homeDir, projectRoot, sessionId, deps = {}) {
  const path = askEventsPath(homeDir, projectRoot, sessionId);
  if (!path) return [];
  return groupTurns(await readRecords(path, deps));
}

/**
 * Appends one record as a single JSON line. Best-effort: resolves `false`
 * (never rejects) when there is no usable session or the write fails.
 * A `turn_start` also enforces the growth policy.
 */
export async function appendAskRecord(homeDir, projectRoot, sessionId, record, deps = {}) {
  try {
    const path = askEventsPath(homeDir, projectRoot, sessionId);
    if (!path) return false;
    // A crash mid-write can leave a partial last line with no newline; start
    // on a fresh line so the new record is never glued onto that fragment.
    const lead = (await endsMidLine(path)) ? "\n" : "";
    const line = `${lead}${JSON.stringify({ v: ASK_EVENTS_VERSION, ...record })}\n`;
    await (deps.mkdir ?? mkdir)(dirname(path), { recursive: true });
    await (deps.appendFile ?? appendFile)(path, line, "utf8");
    if (record.type === "turn_start") await compactIfNeeded(path, deps);
    return true;
  } catch {
    return false;
  }
}

async function endsMidLine(path) {
  let handle = null;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    if (size === 0) return false;
    const buf = Buffer.alloc(1);
    await handle.read(buf, 0, 1, size - 1);
    return buf[0] !== 0x0a;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function compactIfNeeded(path, deps) {
  const records = await readRecords(path, deps);
  const starts = records.filter((r) => r.type === "turn_start").map((r) => r.turnId);
  const unique = [...new Set(starts)];
  if (unique.length <= MAX_STORED_TURNS) return;
  const keep = new Set(unique.slice(-MAX_STORED_TURNS));
  const body = records.filter((r) => keep.has(r.turnId)).map((r) => JSON.stringify(r)).join("\n");
  const tmp = `${path}.tmp-${process.pid}`;
  await (deps.writeFile ?? writeFile)(tmp, `${body}\n`, "utf8");
  await (deps.rename ?? rename)(tmp, path);
}

/** Removes the session's ASK events (used by `/clear`). Best-effort. */
export async function clearAskEvents(homeDir, projectRoot, sessionId, deps = {}) {
  try {
    const path = askEventsPath(homeDir, projectRoot, sessionId);
    if (!path) return false;
    await (deps.rm ?? rm)(path, { force: true });
    return true;
  } catch {
    return false;
  }
}
