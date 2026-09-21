// A real exclusive lock for "this Kairo session is open in this process" —
// same real mkdir-is-atomic + lease.json + PID-liveness pattern already
// proven in architect-store.js's acquireRequestLock, adapted for a
// genuinely different use case: that lock dedups short-lived (~15 min)
// identical requests under the PROJECT root; this one guards a single
// long-lived (hours, legitimately) session directory under the harness
// home, and a live holder must be a real, clear error to the second
// process — never a silent "not acquired" a caller could ignore.

import { mkdir, readFile, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

// A session can legitimately stay open for hours (a real human working in
// `kairo start`) — nowhere near the 15-minute window that fits a one-shot
// request dedup lock. This only ever matters as a fallback for a lease
// with no real PID recorded (a defensive edge case, not the normal path:
// the normal path always recovers via real PID liveness, regardless of
// age).
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

async function readLease(leasePath, deps) {
  const read = deps.readFile ?? readFile;
  let raw;
  try { raw = await read(leasePath, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  try { return JSON.parse(raw); }
  catch { return null; } // a corrupt lease (e.g. truncated by a crash mid-write) is never a real live holder — treat exactly like a missing one, never an uncaught parse error blocking recovery forever.
}

async function isStale(leasePath, { nowMs, staleAfterMs }, deps) {
  const lease = await readLease(leasePath, deps);
  if (!lease) return true; // a lock dir with no real lease inside is never a real live holder
  if (Number.isSafeInteger(lease.pid) && lease.pid > 0) return !processIsAlive(lease.pid);
  const createdMs = Date.parse(lease.createdAt ?? "");
  const ageMs = nowMs - (Number.isFinite(createdMs) ? createdMs : 0);
  return ageMs >= staleAfterMs;
}

async function removeLock(lockDir, leasePath, deps) {
  const unlinkImpl = deps.unlink ?? unlink;
  const rmdirImpl = deps.rmdir ?? rmdir;
  await unlinkImpl(leasePath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  await rmdirImpl(lockDir).catch((error) => { if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error; });
}

/**
 * Acquires the exclusive lock for one session directory. Throws a real,
 * clear error (never a silent `{acquired: false}` a caller could ignore)
 * when the session is genuinely held by another live process — the real
 * requirement is "a second process gets an unambiguous error", not a
 * value the caller might not check.
 * @param {string} sessionDir - the real, already-resolved directory for this one session
 * @param {{sessionId?: string, now?: Date, staleAfterMs?: number}} [opts]
 * @returns {Promise<{release: () => Promise<void>}>}
 */
export async function acquireSessionLock(sessionDir, {
  sessionId = sessionDir, now = new Date(), staleAfterMs = DEFAULT_STALE_AFTER_MS
} = {}, deps = {}) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const lockDir = join(sessionDir, "active.lock");
  const leasePath = join(lockDir, "lease.json");
  const token = randomBytes(16).toString("hex");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdirImpl(lockDir, { recursive: false });
      await writeJson(leasePath, { sessionId, token, pid: process.pid, createdAt: now.toISOString() }, { createExclusive: true });
      return {
        async release() {
          const lease = await readLease(leasePath, deps);
          if (!lease || lease.token !== token) return; // never clobber a fresher holder's lock
          await removeLock(lockDir, leasePath, deps);
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") {
        await removeLock(lockDir, leasePath, deps).catch(() => {});
        throw error;
      }
      if (attempt === 0 && await isStale(leasePath, { nowMs: now.getTime(), staleAfterMs }, deps)) {
        await removeLock(lockDir, leasePath, deps);
        continue;
      }
      const lease = await readLease(leasePath, deps);
      throw new Error(
        `Session is already open in another process${lease?.pid ? ` (pid ${lease.pid})` : ""}. `
        + "Close it there first, or resume a different session."
      );
    }
  }
  throw new Error("Could not acquire the session lock after recovering a stale one — try again.");
}
