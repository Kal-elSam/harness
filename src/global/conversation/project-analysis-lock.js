// One project analysis at a time, per project, across processes. Both the
// manual `/project analyze` path and automatic team recovery take this lock,
// so an automatic re-analysis can never race a manual one (or another
// automatic one) for the same project.
//
// Acquisition is an exclusive create (writeAtomicJson createExclusive, which
// fails with EEXIST), so it is atomic even between separate Kairo processes.
// A lock whose holder process is gone, or which is older than the stale
// limit, is taken over once. Two processes taking over the same stale lock
// at the same instant is not prevented; it needs a crashed holder and a
// simultaneous takeover, and the worst case is one duplicate analysis.

import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const PROJECT_ANALYSIS_LOCK_SCHEMA = "kairo.project-analysis-lock/v1";

// Well above the analyst's own 180 s timeout (service.js), plus snapshot and
// validation time: a lock older than this cannot belong to a live analysis.
export const PROJECT_ANALYSIS_LOCK_STALE_MS = 10 * 60_000;

function lockPath(homeDir, projectRoot) {
  const { sessionsDir } = harnessHomePaths(homeDir);
  return join(sessionsDir, projectKeyForPath(projectRoot), "project-analysis.lock.json");
}

function defaultIsPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error?.code === "EPERM";
  }
}

async function readLock(path) {
  try {
    const doc = JSON.parse(await readFile(path, "utf8"));
    return doc?.schema === PROJECT_ANALYSIS_LOCK_SCHEMA ? doc : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} homeDir
 * @param {string} projectRoot
 * @param {{owner: string, pid?: number, now?: () => number, isPidAlive?: (pid: number) => boolean, staleAfterMs?: number}} options
 * @returns {Promise<{acquired: true, release: () => Promise<void>} | {acquired: false, holder: object|null}>}
 */
export async function acquireProjectAnalysisLock(homeDir, projectRoot, {
  owner,
  pid = process.pid,
  now = () => Date.now(),
  isPidAlive = defaultIsPidAlive,
  staleAfterMs = PROJECT_ANALYSIS_LOCK_STALE_MS
} = {}) {
  const path = lockPath(homeDir, projectRoot);
  const token = randomBytes(8).toString("hex");
  const doc = { schema: PROJECT_ANALYSIS_LOCK_SCHEMA, token, owner, pid, startedAt: new Date(now()).toISOString() };
  await mkdir(dirname(path), { recursive: true });

  const isStale = (holder) => {
    const startedAt = Date.parse(holder?.startedAt);
    return !holder || !isPidAlive(holder.pid) || !Number.isFinite(startedAt) || now() - startedAt > staleAfterMs;
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeAtomicJson(path, doc, { createExclusive: true });
      return {
        acquired: true,
        release: async () => {
          // Only remove the lock if it is still ours: after a takeover, the
          // stale holder's late release must not free the new holder's lock.
          const current = await readLock(path);
          if (current?.token === token) await unlink(path).catch(() => {});
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const holder = await readLock(path);
    if (!isStale(holder)) return { acquired: false, holder };
    await unlink(path).catch(() => {});
  }
  return { acquired: false, holder: await readLock(path) };
}
