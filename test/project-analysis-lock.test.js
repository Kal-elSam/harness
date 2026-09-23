import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireProjectAnalysisLock } from "../src/global/conversation/project-analysis-lock.js";

const alive = () => true;
const dead = () => false;

async function home() {
  return mkdtemp(join(tmpdir(), "kairo-lock-"));
}

test("one analysis per project at a time: a second acquire sees the holder until release", async () => {
  const homeDir = await home();
  const first = await acquireProjectAnalysisLock(homeDir, "/work/a", { owner: "manual", isPidAlive: alive });
  assert.equal(first.acquired, true);

  const second = await acquireProjectAnalysisLock(homeDir, "/work/a", { owner: "automatic-recovery", isPidAlive: alive });
  assert.equal(second.acquired, false);
  assert.equal(second.holder.owner, "manual");
  assert.equal(typeof second.holder.startedAt, "string");

  await first.release();
  const third = await acquireProjectAnalysisLock(homeDir, "/work/a", { owner: "automatic-recovery", isPidAlive: alive });
  assert.equal(third.acquired, true);
  await third.release();
});

test("locks are per project", async () => {
  const homeDir = await home();
  const a = await acquireProjectAnalysisLock(homeDir, "/work/a", { owner: "manual", isPidAlive: alive });
  const b = await acquireProjectAnalysisLock(homeDir, "/work/b", { owner: "manual", isPidAlive: alive });
  assert.equal(a.acquired, true);
  assert.equal(b.acquired, true);
  await a.release();
  await b.release();
});

test("a lock left by a dead process or older than the stale limit is taken over", async () => {
  const homeDir = await home();
  const abandoned = await acquireProjectAnalysisLock(homeDir, "/work/a", { owner: "manual", isPidAlive: alive });
  assert.equal(abandoned.acquired, true);
  const afterCrash = await acquireProjectAnalysisLock(homeDir, "/work/a", { owner: "automatic-recovery", isPidAlive: dead });
  assert.equal(afterCrash.acquired, true, "the holder's process is gone");
  await afterCrash.release();

  const start = Date.parse("2026-09-23T10:00:00Z");
  const old = await acquireProjectAnalysisLock(homeDir, "/work/b", { owner: "manual", isPidAlive: alive, now: () => start });
  assert.equal(old.acquired, true);
  const tooSoon = await acquireProjectAnalysisLock(homeDir, "/work/b", { owner: "automatic-recovery", isPidAlive: alive, now: () => start + 60_000, staleAfterMs: 600_000 });
  assert.equal(tooSoon.acquired, false);
  const late = await acquireProjectAnalysisLock(homeDir, "/work/b", { owner: "automatic-recovery", isPidAlive: alive, now: () => start + 600_001, staleAfterMs: 600_000 });
  assert.equal(late.acquired, true, "older than the stale limit");
  await late.release();
});

test("releasing a lock that was taken over never removes the new holder's lock", async () => {
  const homeDir = await home();
  const original = await acquireProjectAnalysisLock(homeDir, "/work/a", { owner: "manual", isPidAlive: alive });
  const takeover = await acquireProjectAnalysisLock(homeDir, "/work/a", { owner: "automatic-recovery", isPidAlive: dead });
  assert.equal(takeover.acquired, true);

  await original.release();
  const probe = await acquireProjectAnalysisLock(homeDir, "/work/a", { owner: "manual", isPidAlive: alive });
  assert.equal(probe.acquired, false, "the takeover's lock must survive the stale holder's release");
  assert.equal(probe.holder.owner, "automatic-recovery");
  await takeover.release();
});
