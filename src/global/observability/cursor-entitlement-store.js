// Disk cache for real Cursor access probes (cursor-entitlement.js), keyed
// by pool. Mirrors claude-entitlement-store.js's own pattern (read→null on
// any failure, mkdir + writeAtomicJson, fetchedAt/ageLabel) — only a
// real AVAILABLE/EXHAUSTED result is ever persisted, exactly like Claude's
// own store; an UNVERIFIED probe (timeout, auth failure, unrecognized
// output) is never cached, so the next real refresh gets a genuine retry
// instead of being locked out of real evidence for the whole TTL window.

import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";
import { CURSOR_ACCESS_STATUS } from "./cursor-entitlement.js";

// A real probe spawns a genuine cursor-agent process — 15 minutes keeps
// every refresh/poll tick from re-spawning one, while still being short
// enough that a real quota recovery (a new billing period, an upgrade)
// surfaces again soon without ever needing a restart.
export const DEFAULT_CURSOR_ACCESS_TTL_MS = 15 * 60 * 1000;

function ageLabel(fetchedAtIso, nowMs = Date.now()) {
  const fetchedAt = new Date(fetchedAtIso ?? "").getTime();
  if (!Number.isFinite(fetchedAt)) return null;
  const minutes = (nowMs - fetchedAt) / 60_000;
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${Math.round(minutes / 60)}h`;
}

function isPersistableStatus(status) {
  return status === CURSOR_ACCESS_STATUS.AVAILABLE || status === CURSOR_ACCESS_STATUS.EXHAUSTED;
}

function emptyDoc(fetchedAt = new Date().toISOString()) {
  return { fetchedAt, pools: Object.create(null) };
}

/**
 * @param {string} homeDir
 * @param {object} [deps]
 * @returns {Promise<object|null>}
 */
export async function readCursorAccessCache(homeDir, deps = {}) {
  const read = deps.readFile ?? readFile;
  try {
    const raw = await read(harnessHomePaths(homeDir).cursorAccessPath, "utf8");
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object") return null;
    if (typeof doc.fetchedAt !== "string") return null;
    if (!doc.pools || typeof doc.pools !== "object" || Array.isArray(doc.pools)) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * @param {string} homeDir
 * @param {object} doc
 * @param {object} [deps]
 */
export async function writeCursorAccessCache(homeDir, doc, deps = {}) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = harnessHomePaths(homeDir).cursorAccessPath;
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, doc);
}

/**
 * Pure resolver: the live access view for one real pool, from cache.
 * @param {{cache: object|null, pool: string, now?: number, ttlMs?: number}} options
 * @returns {{status: string, reason: string|null, age: string|null, probedAt: string|null}}
 */
export function resolveCursorPoolAccess({ cache, pool, now = Date.now(), ttlMs = DEFAULT_CURSOR_ACCESS_TTL_MS } = {}) {
  const entry = cache?.pools?.[pool] ?? null;
  if (!entry || !isPersistableStatus(entry.status)) {
    return { status: CURSOR_ACCESS_STATUS.UNVERIFIED, reason: null, age: null, probedAt: null };
  }
  const probedAtMs = new Date(entry.probedAt ?? "").getTime();
  if (!Number.isFinite(probedAtMs) || now - probedAtMs > ttlMs) {
    return { status: CURSOR_ACCESS_STATUS.UNVERIFIED, reason: null, age: ageLabel(entry.probedAt, now), probedAt: entry.probedAt ?? null };
  }
  return { status: entry.status, reason: entry.reason ?? null, age: ageLabel(entry.probedAt, now), probedAt: entry.probedAt };
}

/**
 * Merges one fresh probe result into a cache doc. Discards UNVERIFIED —
 * only real AVAILABLE/EXHAUSTED evidence is ever persisted (see this
 * file's own header doc).
 * @param {object|null} cache
 * @param {{pool: string, status: string, reason?: string|null, probedAt?: string}} result
 */
export function mergeCursorAccessResult(cache, result) {
  const base = cache && typeof cache === "object" && cache.pools && typeof cache.pools === "object"
    ? { fetchedAt: cache.fetchedAt, pools: { ...cache.pools } }
    : emptyDoc();
  if (result && typeof result.pool === "string" && isPersistableStatus(result.status)) {
    const probedAt = typeof result.probedAt === "string" ? result.probedAt : new Date().toISOString();
    base.pools[result.pool] = { status: result.status, reason: result.reason ?? null, probedAt };
    base.fetchedAt = probedAt;
  }
  return base;
}

/**
 * Immediately invalidates one pool's cached entry — used when a real
 * execution reports a limit hit, so a stale AVAILABLE never outlives the
 * TTL after real evidence already contradicted it.
 * @param {object|null} cache
 * @param {string} pool
 */
export function invalidateCursorPoolAccess(cache, pool) {
  if (!cache?.pools || typeof cache.pools !== "object" || !(pool in cache.pools)) return cache ?? emptyDoc();
  const pools = { ...cache.pools };
  delete pools[pool];
  return { fetchedAt: cache.fetchedAt, pools };
}

/**
 * Persistent wrapper around the pure invalidateCursorPoolAccess above — for
 * a real execution that just reported a real limit hit, so a stale
 * AVAILABLE on disk never outlives the TTL after real evidence already
 * contradicted it. Best-effort: a read/write failure here must never
 * surface as (or replace) the real run's own state/error — see this
 * file's own header doc for why reads already fail closed to null.
 * @param {string} homeDir
 * @param {string} pool
 * @param {object} [deps]
 */
export async function invalidateStoredCursorPoolAccess(homeDir, pool, deps = {}) {
  const readCache = deps.readCursorAccessCache ?? readCursorAccessCache;
  const writeCache = deps.writeCursorAccessCache ?? writeCursorAccessCache;
  try {
    const cache = await readCache(homeDir);
    if (!cache) return;
    const updated = invalidateCursorPoolAccess(cache, pool);
    if (updated === cache) return;
    await writeCache(homeDir, updated);
  } catch {
    // best-effort — never throw, never affect the real run's own result
  }
}
