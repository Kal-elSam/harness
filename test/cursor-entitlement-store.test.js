import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  readCursorAccessCache,
  writeCursorAccessCache,
  resolveCursorPoolAccess,
  mergeCursorAccessResult,
  invalidateCursorPoolAccess,
  invalidateStoredCursorPoolAccess,
  DEFAULT_CURSOR_ACCESS_TTL_MS
} from "../src/global/observability/cursor-entitlement-store.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { CURSOR_ACCESS_STATUS, CURSOR_POOL } from "../src/global/observability/cursor-entitlement.js";

async function tempHome() {
  return mkdtemp(join(tmpdir(), "kairo-cursor-access-"));
}

test("readCursorAccessCache returns null on missing or corrupt JSON without throwing", async () => {
  const homeDir = await tempHome();
  assert.equal(await readCursorAccessCache(homeDir), null);

  const path = harnessHomePaths(homeDir).cursorAccessPath;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{not-json", "utf8");
  assert.equal(await readCursorAccessCache(homeDir), null);
});

test("writeCursorAccessCache persists a doc that readCursorAccessCache round-trips", async () => {
  const homeDir = await tempHome();
  const doc = {
    fetchedAt: "2026-09-22T10:00:00.000Z",
    pools: {
      [CURSOR_POOL.OTHER_MODELS]: { status: CURSOR_ACCESS_STATUS.EXHAUSTED, reason: "monthly limit", probedAt: "2026-09-22T10:00:00.000Z" }
    }
  };
  await writeCursorAccessCache(homeDir, doc);
  const onDisk = JSON.parse(await readFile(harnessHomePaths(homeDir).cursorAccessPath, "utf8"));
  assert.equal(onDisk.pools[CURSOR_POOL.OTHER_MODELS].status, CURSOR_ACCESS_STATUS.EXHAUSTED);
  assert.deepEqual(await readCursorAccessCache(homeDir), onDisk);
});

test("REGRESSION: resolveCursorPoolAccess is UNVERIFIED with no cache, and expires per-pool after the 15-minute TTL", () => {
  assert.equal(resolveCursorPoolAccess({ cache: null, pool: CURSOR_POOL.OTHER_MODELS }).status, CURSOR_ACCESS_STATUS.UNVERIFIED);

  const probedAt = "2026-09-22T10:00:00.000Z";
  const cache = { fetchedAt: probedAt, pools: { [CURSOR_POOL.OTHER_MODELS]: { status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt } } };

  const fresh = resolveCursorPoolAccess({ cache, pool: CURSOR_POOL.OTHER_MODELS, now: Date.parse("2026-09-22T10:14:00.000Z"), ttlMs: DEFAULT_CURSOR_ACCESS_TTL_MS });
  assert.equal(fresh.status, CURSOR_ACCESS_STATUS.AVAILABLE);

  const stale = resolveCursorPoolAccess({ cache, pool: CURSOR_POOL.OTHER_MODELS, now: Date.parse("2026-09-22T10:15:01.000Z"), ttlMs: DEFAULT_CURSOR_ACCESS_TTL_MS });
  assert.equal(stale.status, CURSOR_ACCESS_STATUS.UNVERIFIED);
});

test("REGRESSION: an exhausted OTHER_MODELS pool never affects CURSOR_MODELS' own independent cached state", () => {
  const now = Date.parse("2026-09-22T10:05:00.000Z");
  const cache = {
    fetchedAt: "2026-09-22T10:00:00.000Z",
    pools: {
      [CURSOR_POOL.OTHER_MODELS]: { status: CURSOR_ACCESS_STATUS.EXHAUSTED, reason: "monthly limit", probedAt: "2026-09-22T10:00:00.000Z" },
      [CURSOR_POOL.CURSOR_MODELS]: { status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt: "2026-09-22T10:00:00.000Z" }
    }
  };
  assert.equal(resolveCursorPoolAccess({ cache, pool: CURSOR_POOL.OTHER_MODELS, now }).status, CURSOR_ACCESS_STATUS.EXHAUSTED);
  assert.equal(resolveCursorPoolAccess({ cache, pool: CURSOR_POOL.CURSOR_MODELS, now }).status, CURSOR_ACCESS_STATUS.AVAILABLE);
});

test("mergeCursorAccessResult persists AVAILABLE/EXHAUSTED but discards UNVERIFIED — a transient probe failure never locks out a retry for the whole TTL", () => {
  const merged = mergeCursorAccessResult(null, { pool: CURSOR_POOL.CURSOR_MODELS, status: CURSOR_ACCESS_STATUS.UNVERIFIED, reason: "timeout", probedAt: "2026-09-22T10:00:00.000Z" });
  assert.equal(merged.pools[CURSOR_POOL.CURSOR_MODELS], undefined);

  const withReal = mergeCursorAccessResult(merged, { pool: CURSOR_POOL.CURSOR_MODELS, status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt: "2026-09-22T10:01:00.000Z" });
  assert.equal(withReal.pools[CURSOR_POOL.CURSOR_MODELS].status, CURSOR_ACCESS_STATUS.AVAILABLE);
});

test("REGRESSION: invalidateCursorPoolAccess immediately clears one pool's cached entry — a real execution's limit hit never has to wait out the TTL", () => {
  const cache = {
    fetchedAt: "2026-09-22T10:00:00.000Z",
    pools: {
      [CURSOR_POOL.OTHER_MODELS]: { status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt: "2026-09-22T10:00:00.000Z" },
      [CURSOR_POOL.CURSOR_MODELS]: { status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt: "2026-09-22T10:00:00.000Z" }
    }
  };
  const invalidated = invalidateCursorPoolAccess(cache, CURSOR_POOL.OTHER_MODELS);
  assert.equal(resolveCursorPoolAccess({ cache: invalidated, pool: CURSOR_POOL.OTHER_MODELS }).status, CURSOR_ACCESS_STATUS.UNVERIFIED);
  assert.equal(resolveCursorPoolAccess({ cache: invalidated, pool: CURSOR_POOL.CURSOR_MODELS, now: Date.parse("2026-09-22T10:05:00.000Z") }).status, CURSOR_ACCESS_STATUS.AVAILABLE, "invalidating one pool must never touch the other");
});

// --- invalidateStoredCursorPoolAccess: the real, persistent, best-effort
// wrapper a real execution's limit hit actually calls.

test("REGRESSION: invalidateStoredCursorPoolAccess clears the real persisted pool on disk — a fresh read after invalidation is UNVERIFIED, the untouched pool stays AVAILABLE", async () => {
  const homeDir = await tempHome();
  await writeCursorAccessCache(homeDir, {
    fetchedAt: "2026-09-22T10:00:00.000Z",
    pools: {
      [CURSOR_POOL.OTHER_MODELS]: { status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt: "2026-09-22T10:00:00.000Z" },
      [CURSOR_POOL.CURSOR_MODELS]: { status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt: "2026-09-22T10:00:00.000Z" }
    }
  });

  await invalidateStoredCursorPoolAccess(homeDir, CURSOR_POOL.OTHER_MODELS);

  const reread = await readCursorAccessCache(homeDir);
  const now = Date.parse("2026-09-22T10:05:00.000Z");
  assert.equal(resolveCursorPoolAccess({ cache: reread, pool: CURSOR_POOL.OTHER_MODELS, now }).status, CURSOR_ACCESS_STATUS.UNVERIFIED, "the next evaluation must re-probe the invalidated pool, never trust the stale AVAILABLE");
  assert.equal(resolveCursorPoolAccess({ cache: reread, pool: CURSOR_POOL.CURSOR_MODELS, now }).status, CURSOR_ACCESS_STATUS.AVAILABLE, "invalidating one pool must never touch the other, even through the persistent wrapper");
});

test("invalidateStoredCursorPoolAccess is a real no-op when nothing was ever cached — never writes a fabricated doc", async () => {
  const homeDir = await tempHome();
  let wrote = false;
  await invalidateStoredCursorPoolAccess(homeDir, CURSOR_POOL.OTHER_MODELS, {
    readCursorAccessCache: async () => null,
    writeCursorAccessCache: async () => { wrote = true; }
  });
  assert.equal(wrote, false);
});

test("invalidateStoredCursorPoolAccess is a real no-op when the pool wasn't cached at all — never writes when there's nothing to invalidate", async () => {
  const homeDir = await tempHome();
  await writeCursorAccessCache(homeDir, {
    fetchedAt: "2026-09-22T10:00:00.000Z",
    pools: { [CURSOR_POOL.CURSOR_MODELS]: { status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt: "2026-09-22T10:00:00.000Z" } }
  });
  let wrote = false;
  await invalidateStoredCursorPoolAccess(homeDir, CURSOR_POOL.OTHER_MODELS, {
    writeCursorAccessCache: async (...args) => { wrote = true; return writeCursorAccessCache(...args); }
  });
  assert.equal(wrote, false);
});

test("REGRESSION: invalidateStoredCursorPoolAccess is best-effort — a real read or write failure never throws, and never fabricates a doc", async () => {
  const homeDir = await tempHome();
  await assert.doesNotReject(() => invalidateStoredCursorPoolAccess(homeDir, CURSOR_POOL.OTHER_MODELS, {
    readCursorAccessCache: async () => { throw new Error("disk read boom"); }
  }));
  await assert.doesNotReject(() => invalidateStoredCursorPoolAccess(homeDir, CURSOR_POOL.OTHER_MODELS, {
    readCursorAccessCache: async () => ({ fetchedAt: "2026-09-22T10:00:00.000Z", pools: { [CURSOR_POOL.OTHER_MODELS]: { status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt: "2026-09-22T10:00:00.000Z" } } }),
    writeCursorAccessCache: async () => { throw new Error("disk write boom"); }
  }));
});
