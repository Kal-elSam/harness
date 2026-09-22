import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cursor from "../src/global/runtime/execution-adapters/cursor.js";
import codex from "../src/global/runtime/execution-adapters/codex.js";
import { CURSOR_POOL } from "../src/global/observability/cursor-entitlement.js";
import {
  readCursorAccessCache,
  resolveCursorPoolAccess,
  writeCursorAccessCache
} from "../src/global/observability/cursor-entitlement-store.js";

async function tempHome() {
  return mkdtemp(join(tmpdir(), "kairo-cursor-adapter-"));
}

// --- Cursor's own real detectQuotaExhaustion hook — all Cursor-specific
// pool-derivation/auto-exemption knowledge lives here, never leaking into
// run-supervisor.js, which only ever sees the opaque returned shape.

test("REGRESSION: cursor.detectQuotaExhaustion derives the real pool from the launched model and returns a ready invalidate() closure", async () => {
  const line = JSON.stringify({ type: "result", is_error: true, result: "You have hit your monthly limit for Composer." });
  const hit = cursor.detectQuotaExhaustion({ line, stream: "stdout", model: "composer-2.5" });
  assert.equal(hit.dedupeKey, CURSOR_POOL.CURSOR_MODELS);
  assert.match(hit.reason, /monthly limit/);

  const homeDir = await tempHome();
  await writeCursorAccessCache(homeDir, {
    fetchedAt: "2026-09-22T10:00:00.000Z",
    pools: { [CURSOR_POOL.CURSOR_MODELS]: { status: "available", reason: null, probedAt: "2026-09-22T10:00:00.000Z" } }
  });
  await hit.invalidate(homeDir);
  const cache = await readCursorAccessCache(homeDir);
  assert.equal(resolveCursorPoolAccess({ cache, pool: CURSOR_POOL.CURSOR_MODELS, now: Date.parse("2026-09-22T10:05:00.000Z") }).status, "unverified");
});

test("REGRESSION: a proxied (non-Composer) model derives the OTHER_MODELS pool, independent of CURSOR_MODELS", () => {
  const line = JSON.stringify({ type: "result", is_error: true, result: "Out of credits for this billing period." });
  const hit = cursor.detectQuotaExhaustion({ line, stream: "stdout", model: "claude-fable-5-1" });
  assert.equal(hit.dedupeKey, CURSOR_POOL.OTHER_MODELS);
});

test("REGRESSION: Cursor's opaque auto model is never a real limit-hit target, even on an otherwise-matching line", () => {
  const line = JSON.stringify({ type: "result", is_error: true, result: "You have hit your monthly limit." });
  assert.equal(cursor.detectQuotaExhaustion({ line, stream: "stdout", model: "auto" }), null);
});

test("cursor.detectQuotaExhaustion is null with no model (nothing was actually launched with a real model yet) and for ordinary non-matching output", () => {
  const line = JSON.stringify({ type: "result", is_error: true, result: "You have hit your monthly limit." });
  assert.equal(cursor.detectQuotaExhaustion({ line, stream: "stdout", model: null }), null);
  assert.equal(cursor.detectQuotaExhaustion({ line: JSON.stringify({ type: "assistant", text: "Sure, here's the fix." }), stream: "stdout", model: "composer-2.5" }), null);
});

test("REGRESSION: an adapter with no real detectQuotaExhaustion of its own (e.g. Codex) exposes the contract's real no-op default, never a fabricated signal", () => {
  assert.equal(codex.detectQuotaExhaustion({ line: "anything", stream: "stdout", model: "gpt-5" }), null);
});
