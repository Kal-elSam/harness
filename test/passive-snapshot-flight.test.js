import test from "node:test";
import assert from "node:assert/strict";
import {
  PASSIVE_SNAPSHOT_MAX_ENTRIES,
  PASSIVE_SNAPSHOT_TTL_MS,
  buildPassiveSnapshotKey,
  passiveSnapshotFlightSizeForTests,
  passiveSnapshotInFlightSizeForTests,
  resetPassiveSnapshotFlightForTests,
  runPassiveObservabilitySnapshot
} from "../src/global/observability/passive-snapshot-flight.js";

test("passive snapshot flight: coalesce, TTL, force, key, error retry, LRU", async () => {
  resetPassiveSnapshotFlightForTests();
  let calls = 0;
  let clock = 1_000;
  const providers = () => [{ id: "gentle" }, { id: "graphify" }];
  const build = async (ctx) => {
    calls += 1;
    return { n: calls, head: ctx.headSha, cwd: ctx.cwd };
  };
  const opts = { build, now: () => clock, listProviders: providers, ttlMs: 5_000, maxEntries: 8 };

  const ctx = { cwd: "/ws", headSha: "abc" };
  assert.equal(buildPassiveSnapshotKey(ctx, { listProviders: providers }), "/ws\0abc\0gentle,graphify");

  const [a, b] = await Promise.all([
    runPassiveObservabilitySnapshot(ctx, opts),
    runPassiveObservabilitySnapshot(ctx, opts)
  ]);
  assert.equal(calls, 1);
  assert.equal(a.n, 1);
  assert.equal(b.n, 1);

  clock += 1_000;
  const cached = await runPassiveObservabilitySnapshot(ctx, opts);
  assert.equal(calls, 1);
  assert.equal(cached.n, 1);

  const forced = await runPassiveObservabilitySnapshot(ctx, { ...opts, force: true });
  assert.equal(calls, 2);
  assert.equal(forced.n, 2);

  let inFlightStarted = false;
  let release;
  const gate = new Promise((r) => { release = r; });
  const slowBuild = async () => {
    inFlightStarted = true;
    await gate;
    calls += 1;
    return { n: calls };
  };
  const slowOpts = { ...opts, build: slowBuild, force: true };
  const p1 = runPassiveObservabilitySnapshot(ctx, slowOpts);
  await Promise.resolve();
  assert.equal(inFlightStarted, true);
  const p2 = runPassiveObservabilitySnapshot(ctx, { ...slowOpts, force: true });
  release();
  const [s1, s2] = await Promise.all([p1, p2]);
  assert.equal(s1.n, s2.n);
  assert.equal(calls, 3);

  clock += PASSIVE_SNAPSHOT_TTL_MS + 1;
  await runPassiveObservabilitySnapshot(ctx, opts);
  assert.equal(calls, 4);

  const other = await runPassiveObservabilitySnapshot({ cwd: "/other", headSha: "abc" }, opts);
  assert.equal(other.cwd, "/other");
  assert.equal(calls, 5);

  resetPassiveSnapshotFlightForTests();
  let failOnce = true;
  const flaky = async () => {
    calls += 1;
    if (failOnce) {
      failOnce = false;
      throw new Error("boom");
    }
    return { n: calls };
  };
  await assert.rejects(() => runPassiveObservabilitySnapshot(ctx, { ...opts, build: flaky }), /boom/);
  const recovered = await runPassiveObservabilitySnapshot(ctx, { ...opts, build: flaky });
  assert.equal(recovered.n, calls);

  resetPassiveSnapshotFlightForTests();
  for (let i = 0; i < PASSIVE_SNAPSHOT_MAX_ENTRIES + 2; i += 1) {
    await runPassiveObservabilitySnapshot(
      { cwd: `/ws-${i}`, headSha: "h" },
      { ...opts, build: async () => ({ i }) }
    );
  }
  assert.equal(passiveSnapshotFlightSizeForTests(), PASSIVE_SNAPSHOT_MAX_ENTRIES);
});

test("passive snapshot flight: capacity pressure never double-starts a key", async () => {
  resetPassiveSnapshotFlightForTests();
  const providers = () => [{ id: "gentle" }];
  const started = new Map();
  /** @type {Array<() => void>} */
  const unlocks = [];
  const build = async (ctx) => {
    const k = ctx.cwd;
    started.set(k, (started.get(k) ?? 0) + 1);
    await new Promise((resolve) => { unlocks.push(resolve); });
    return { cwd: k };
  };
  const opts = {
    build, now: () => 1_000, listProviders: providers,
    ttlMs: 5_000, maxEntries: PASSIVE_SNAPSHOT_MAX_ENTRIES
  };

  const pending = [];
  for (let i = 0; i < PASSIVE_SNAPSHOT_MAX_ENTRIES + 1; i += 1) {
    pending.push(runPassiveObservabilitySnapshot({ cwd: `/ws-${i}`, headSha: "h" }, opts));
  }
  await Promise.resolve();
  assert.equal(passiveSnapshotInFlightSizeForTests(), PASSIVE_SNAPSHOT_MAX_ENTRIES + 1);
  assert.equal(passiveSnapshotFlightSizeForTests(), 0);

  const joinFirst = runPassiveObservabilitySnapshot({ cwd: "/ws-0", headSha: "h" }, opts);
  await Promise.resolve();
  assert.equal(started.get("/ws-0"), 1);

  for (const unlock of unlocks) unlock();
  const results = await Promise.all([...pending, joinFirst]);
  assert.equal(results[0].cwd, "/ws-0");
  assert.equal(results.at(-1).cwd, "/ws-0");
  assert.equal(started.get("/ws-0"), 1);
  for (let i = 0; i < PASSIVE_SNAPSHOT_MAX_ENTRIES + 1; i += 1) {
    assert.equal(started.get(`/ws-${i}`), 1);
  }
  assert.equal(passiveSnapshotInFlightSizeForTests(), 0);
  assert.equal(passiveSnapshotFlightSizeForTests(), PASSIVE_SNAPSHOT_MAX_ENTRIES);
});

test("passive snapshot flight: force reject invalidates seeded cache", async () => {
  resetPassiveSnapshotFlightForTests();
  let calls = 0;
  let clock = 1_000;
  const providers = () => [{ id: "gentle" }];
  const ctx = { cwd: "/ws", headSha: "abc" };
  const opts = {
    now: () => clock, listProviders: providers, ttlMs: 5_000, maxEntries: 8
  };

  await runPassiveObservabilitySnapshot(ctx, {
    ...opts,
    build: async () => {
      calls += 1;
      return { n: calls, tag: "seed" };
    }
  });
  assert.equal(calls, 1);
  assert.equal(passiveSnapshotFlightSizeForTests(), 1);

  await assert.rejects(
    () => runPassiveObservabilitySnapshot(ctx, {
      ...opts,
      force: true,
      build: async () => {
        calls += 1;
        throw new Error("refresh boom");
      }
    }),
    /refresh boom/
  );
  assert.equal(calls, 2);
  assert.equal(passiveSnapshotFlightSizeForTests(), 0);

  const rebuilt = await runPassiveObservabilitySnapshot(ctx, {
    ...opts,
    build: async () => {
      calls += 1;
      return { n: calls, tag: "rebuild" };
    }
  });
  assert.equal(calls, 3);
  assert.equal(rebuilt.tag, "rebuild");
  assert.equal(rebuilt.n, 3);
});
