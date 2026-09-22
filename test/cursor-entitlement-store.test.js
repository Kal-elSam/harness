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
