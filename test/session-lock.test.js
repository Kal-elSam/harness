import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSessionLock } from "../src/global/conversation/session-lock.js";

async function freshSessionDir() {
  const dir = await mkdtemp(join(tmpdir(), "kairo-session-"));
  return dir;
}

test("acquires a fresh session lock and releases it cleanly", async () => {
  const sessionDir = await freshSessionDir();
  const lock = await acquireSessionLock(sessionDir);
  const lease = JSON.parse(await readFile(join(sessionDir, "active.lock", "lease.json"), "utf8"));
  assert.equal(lease.pid, process.pid);
  await lock.release();
  await assert.rejects(() => readFile(join(sessionDir, "active.lock", "lease.json"), "utf8"));
});

test("REGRESSION: a second process trying to open the same session gets a real, clear error — never a silent 'not acquired' value", async () => {
  const sessionDir = await freshSessionDir();
  await acquireSessionLock(sessionDir);
  // Same real process, so its own PID genuinely IS alive — simulates a
  // second real holder that hasn't crashed.
  await assert.rejects(
    () => acquireSessionLock(sessionDir),
    /already open in another process/
  );
});

test("after release, a new acquire succeeds", async () => {
  const sessionDir = await freshSessionDir();
  const first = await acquireSessionLock(sessionDir);
  await first.release();
  const second = await acquireSessionLock(sessionDir);
  const lease = JSON.parse(await readFile(join(sessionDir, "active.lock", "lease.json"), "utf8"));
  assert.equal(lease.pid, process.pid);
  await second.release();
});

test("REGRESSION: a lock held by a real-but-dead PID is automatically recovered, never requiring a manual release", async () => {
  const sessionDir = await freshSessionDir();
  const lockDir = join(sessionDir, "active.lock");
  await mkdir(lockDir);
  // A PID that is syntactically valid but almost certainly not a real
  // live process on this machine right now.
  await writeFile(join(lockDir, "lease.json"), JSON.stringify({ sessionId: sessionDir, token: "stale-token", pid: 999999, createdAt: new Date().toISOString() }));
  const lock = await acquireSessionLock(sessionDir);
  const lease = JSON.parse(await readFile(join(lockDir, "lease.json"), "utf8"));
  assert.equal(lease.pid, process.pid, "the real current process must now hold the lock");
  await lock.release();
});

test("REGRESSION: release() is token-gated — it must never clobber a fresher holder's lock", async () => {
  const sessionDir = await freshSessionDir();
  const lock = await acquireSessionLock(sessionDir);
  const leasePath = join(sessionDir, "active.lock", "lease.json");
  // Simulate someone else having already recovered and re-acquired this
  // lock with a different token by the time this stale `lock` calls release.
  await writeFile(leasePath, JSON.stringify({ sessionId: sessionDir, token: "someone-elses-token", pid: process.pid, createdAt: new Date().toISOString() }));
  await lock.release();
  const lease = JSON.parse(await readFile(leasePath, "utf8"));
  assert.equal(lease.token, "someone-elses-token", "an old release() must never remove a lease it doesn't own");
});

test("a lock dir with no real lease inside is treated as stale and recovered", async () => {
  const sessionDir = await freshSessionDir();
  await mkdir(join(sessionDir, "active.lock"));
  const lock = await acquireSessionLock(sessionDir);
  const lease = JSON.parse(await readFile(join(sessionDir, "active.lock", "lease.json"), "utf8"));
  assert.equal(lease.pid, process.pid);
  await lock.release();
});
