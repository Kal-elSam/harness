import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRun } from "../src/global/runtime/run-manager.js";
import { RUN_STATES } from "../src/global/runtime/run-types.js";
import { resolveExecutionAdapter } from "../src/global/runtime/execution-adapters/index.js";
import { CURSOR_ACCESS_STATUS, CURSOR_POOL } from "../src/global/observability/cursor-entitlement.js";
import { readCursorAccessCache, resolveCursorPoolAccess, writeCursorAccessCache } from "../src/global/observability/cursor-entitlement-store.js";
import { withStubExecutables } from "./helpers/stub-executables.js";

// These exercise the real, in-process supervisePreparedRun path (startRun's
// own default wait:true — see run-manager.js) with a fully injected spawn,
// exactly like run-manager.test.js's own generic supervision tests, but
// targeted at the new reactive Cursor invalidation wiring specifically.

function resolveCursorNoopPreflight() {
  const adapter = resolveExecutionAdapter("cursor");
  return { ...adapter, preflight: async () => ({ ok: true }) };
}

function createFakeSpawn(lines) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 5150;
    child.kill = () => { child.emit("close", 130); };
    setImmediate(() => {
      for (const line of lines) child.stdout.emit("data", `${line}\n`);
      child.emit("close", 0);
    });
    return child;
  };
}

async function seedAvailable(homeDir, pool) {
  await writeCursorAccessCache(homeDir, {
    fetchedAt: "2026-09-22T10:00:00.000Z",
    pools: { [pool]: { status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt: "2026-09-22T10:00:00.000Z" } }
  });
}

test("REGRESSION: a real Cursor execution that reports a limit hit immediately invalidates that pool's persisted cache — the run's own outcome is unaffected", async () => {
  await withStubExecutables(["cursor-agent"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-cursor-invalidation-"));
    await seedAvailable(homeDir, CURSOR_POOL.CURSOR_MODELS);

    const lines = [
      JSON.stringify({ type: "result", is_error: true, result: "You have hit your monthly limit for Composer." })
    ];

    const { completion } = await startRun({
      homeDir,
      agentId: "cursor",
      model: "composer-2.5",
      resolveAdapterImpl: resolveCursorNoopPreflight,
      task: "run tests",
      cwd: homeDir,
      cliVersion: "0.2.1",
      spawnImpl: createFakeSpawn(lines)
    });

    const final = await completion;
    assert.equal(final.state, RUN_STATES.COMPLETED, "a real limit-hit signal must never itself fail the run");

    const cache = await readCursorAccessCache(homeDir);
    assert.equal(
      resolveCursorPoolAccess({ cache, pool: CURSOR_POOL.CURSOR_MODELS, now: Date.parse("2026-09-22T10:05:00.000Z") }).status,
      CURSOR_ACCESS_STATUS.UNVERIFIED,
      "the invalidated pool must be re-probed on the next evaluation, never trusted stale"
    );
  });
});

test("REGRESSION: ordinary Cursor output with no real limit hit never invalidates the cache", async () => {
  await withStubExecutables(["cursor-agent"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-cursor-invalidation-"));
    await seedAvailable(homeDir, CURSOR_POOL.CURSOR_MODELS);

    const lines = [
      JSON.stringify({ type: "assistant", text: "Here is the real fix." }),
      JSON.stringify({ type: "result", usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } })
    ];

    const { completion } = await startRun({
      homeDir,
      agentId: "cursor",
      model: "composer-2.5",
      resolveAdapterImpl: resolveCursorNoopPreflight,
      task: "run tests",
      cwd: homeDir,
      cliVersion: "0.2.1",
      spawnImpl: createFakeSpawn(lines)
    });

    await completion;
    const cache = await readCursorAccessCache(homeDir);
    assert.equal(
      resolveCursorPoolAccess({ cache, pool: CURSOR_POOL.CURSOR_MODELS, now: Date.parse("2026-09-22T10:05:00.000Z") }).status,
      CURSOR_ACCESS_STATUS.AVAILABLE,
      "ordinary output must never trigger a real invalidation"
    );
  });
});

test("REGRESSION: repeated matching limit lines in the same run invalidate (and write) exactly once per pool, never once per line", async () => {
  await withStubExecutables(["cursor-agent"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-cursor-invalidation-"));
    await seedAvailable(homeDir, CURSOR_POOL.OTHER_MODELS);

    let invalidateCalls = 0;
    function resolveAdapterWithSpy() {
      const adapter = resolveExecutionAdapter("cursor");
      return {
        ...adapter,
        preflight: async () => ({ ok: true }),
        detectQuotaExhaustion(args) {
          const hit = adapter.detectQuotaExhaustion(args);
          if (!hit) return null;
          return { ...hit, invalidate: async (dir) => { invalidateCalls += 1; return hit.invalidate(dir); } };
        }
      };
    }

    const limitLine = JSON.stringify({ type: "result", is_error: true, result: "Out of credits for this billing period." });
    const { completion } = await startRun({
      homeDir,
      agentId: "cursor",
      model: "claude-fable-5-1",
      resolveAdapterImpl: resolveAdapterWithSpy,
      task: "run tests",
      cwd: homeDir,
      cliVersion: "0.2.1",
      spawnImpl: createFakeSpawn([limitLine, limitLine, limitLine])
    });

    await completion;
    assert.equal(invalidateCalls, 1, "three repeated matching lines must invalidate exactly once, not three times");
  });
});

test("REGRESSION: the run only completes after a slow invalidate has actually finished — never before", async () => {
  await withStubExecutables(["cursor-agent"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-cursor-invalidation-"));
    await seedAvailable(homeDir, CURSOR_POOL.CURSOR_MODELS);

    let invalidateSettled = false;

    function resolveAdapterWithSlowInvalidate() {
      const adapter = resolveExecutionAdapter("cursor");
      return {
        ...adapter,
        preflight: async () => ({ ok: true }),
        detectQuotaExhaustion(args) {
          const hit = adapter.detectQuotaExhaustion(args);
          if (!hit) return null;
          return {
            ...hit,
            invalidate: async (dir) => {
              await new Promise((resolve) => setTimeout(resolve, 20));
              const result = await hit.invalidate(dir);
              invalidateSettled = true;
              return result;
            }
          };
        }
      };
    }

    const limitLine = JSON.stringify({ type: "result", is_error: true, result: "You have hit your monthly limit for Composer." });
    const { completion } = await startRun({
      homeDir,
      agentId: "cursor",
      model: "composer-2.5",
      resolveAdapterImpl: resolveAdapterWithSlowInvalidate,
      task: "run tests",
      cwd: homeDir,
      cliVersion: "0.2.1",
      spawnImpl: createFakeSpawn([limitLine])
    });

    await completion;
    assert.equal(invalidateSettled, true, "the run must not complete before its own reactive invalidation has settled");
  });
});

test("REGRESSION: a real cache-invalidation failure never fails or alters the run's own outcome — best-effort, fire-and-forget", async () => {
  await withStubExecutables(["cursor-agent"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-cursor-invalidation-"));

    function resolveAdapterWithFailingInvalidate() {
      const adapter = resolveExecutionAdapter("cursor");
      return {
        ...adapter,
        preflight: async () => ({ ok: true }),
        detectQuotaExhaustion(args) {
          const hit = adapter.detectQuotaExhaustion(args);
          if (!hit) return null;
          return { ...hit, invalidate: async () => { throw new Error("disk boom"); } };
        }
      };
    }

    const limitLine = JSON.stringify({ type: "result", is_error: true, result: "You have hit your monthly limit for Composer." });
    const { completion } = await startRun({
      homeDir,
      agentId: "cursor",
      model: "composer-2.5",
      resolveAdapterImpl: resolveAdapterWithFailingInvalidate,
      task: "run tests",
      cwd: homeDir,
      cliVersion: "0.2.1",
      spawnImpl: createFakeSpawn([limitLine])
    });

    const final = await completion;
    assert.equal(final.state, RUN_STATES.COMPLETED, "a real invalidation failure must never surface as (or replace) the run's own real outcome");
  });
});
