// Account-wide, append-only observations in the routing cache's Kairo home
// area. Compaction is the only rewrite and shares the append lock.
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { harnessHomePaths } from '../paths.js';
import { writeAtomicText } from '../runtime/write-atomic-json.js';
import { paceQuotaWindows } from '../intelligence/quota-pacing.js';

const RETENTION_MS = 8 * 86400000;
const STALE_LOCK_MS = 30000;

export function usageSamplesPath(homeDir, provider) {
  if (typeof provider !== 'string' || !/^[a-z][a-z0-9-]*$/.test(provider)) throw new Error('Invalid usage sample provider.');
  return join(harnessHomePaths(homeDir).sessionsDir, 'usage-samples', `${provider}.jsonl`);
}

async function readText(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}
function parseLine(line) { try { return JSON.parse(line); } catch { return null; } }
function validRow(row, provider, at, includeNewer = false) {
  return row?.provider === provider && ['5h', 'weekly'].includes(row.window)
    && Number.isFinite(row.timestamp) && row.timestamp >= at - RETENTION_MS && (includeNewer || row.timestamp <= at)
    && Number.isFinite(row.resetsAt) && row.resetsAt > row.timestamp
    && typeof row.remainingPercent === 'number' && Number.isFinite(row.remainingPercent)
    && row.remainingPercent >= 0 && row.remainingPercent <= 100;
}

/** Read-only: pruning is performed only by append, never by a reader. */
export async function readUsageSamples(homeDir, provider, { now = Date.now } = {}) {
  const text = await readText(usageSamplesPath(homeDir, provider));
  const at = now();
  return text.split('\n').map(parseLine).filter(row => validRow(row, provider, at));
}

/** Record each fresh probe's observed windows, not repeated cache deliveries.
 * Uses launch-ledger's bounded directory lock and stale-lock recovery, with
 * atomic compaction so pruning cannot overwrite a concurrent append.
 */
export async function appendUsageSamples(homeDir, provider, usage, { now = Date.now, fsOps = {} } = {}) {
  const fs = { mkdir, rename, rmdir, stat, ...fsOps }; // fsOps is an internal test seam
  const path = usageSamplesPath(homeDir, provider);
  const at = now();
  const rows = paceQuotaWindows(usage, at).flatMap(window => {
    const name = /week/i.test(window.kind) ? 'weekly' : /5h|session/i.test(window.kind) ? '5h' : null;
    const reset = Date.parse(window.resetsAtIso);
    return name && Number.isFinite(reset) ? [{ provider, window: name,
      remainingPercent: window.remainingPercent, resetsAt: reset, timestamp: at }] : [];
  });
  if (!rows.length) return [];
  const lock = path + '.lock';
  await mkdir(dirname(path), { recursive: true });
  let ownIno;
  for (let attempt = 0; ; attempt++) {
    try { await fs.mkdir(lock); ownIno = (await fs.stat(lock).catch(() => null))?.ino; break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // One bound for every retry path, so a crashed reclaimer cannot stall callers.
      if (attempt >= 100) throw new Error('Usage samples are busy; recording skipped.');
      const seen = await fs.stat(lock).catch(() => null);
      if (!seen) { await delay(5); continue; } // released between mkdir and stat
      // A busy reclaim guard returns at once: wait briefly instead of spinning.
      if (now() - seen.mtimeMs > STALE_LOCK_MS) { await removeStaleLock(fs, lock, now); await delay(5); continue; }
      await delay(20);
    }
  }
  try {
    const lines = (await readText(path)).split('\n').filter(Boolean);
    // A writer may acquire the lock after a newer probe: preserve its rows.
    const retained = lines.filter(line => validRow(parseLine(line), provider, at, true));
    if (retained.length !== lines.length) await writeAtomicText(path, retained.length ? retained.join('\n') + '\n' : '');
    const handle = await open(path, 'a');
    try { await handle.write(rows.map(row => JSON.stringify(row)).join('\n') + '\n'); }
    finally { await handle.close(); }
    return rows;
  } finally {
    // Release only our own lock; a takeover may have replaced it.
    const held = await fs.stat(lock).catch(() => null);
    if (held && held.ino === ownIno) await fs.rmdir(lock).catch(() => {});
  }
}

// Remove only the exact lock judged stale. Reclaimers serialize on a guard
// directory and re-judge staleness inside it; the lock is moved aside and its
// identity confirmed before deletion, and restored if it is not the stale one.
async function removeStaleLock(fs, lock, now) {
  const guard = `${lock}.reclaim`;
  try { await fs.mkdir(guard); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const held = await fs.stat(guard).catch(() => null);
    if (held && now() - held.mtimeMs > STALE_LOCK_MS) await fs.rmdir(guard).catch(() => {});
    return;
  }
  try {
    const seen = await fs.stat(lock).catch(() => null);
    if (!seen || now() - seen.mtimeMs <= STALE_LOCK_MS) return;
    const victim = `${lock}.stale-${randomBytes(6).toString('hex')}`;
    try { await fs.rename(lock, victim); } catch { return; }
    const moved = await fs.stat(victim).catch(() => null);
    if (moved && moved.ino === seen.ino && moved.mtimeMs === seen.mtimeMs) await fs.rmdir(victim).catch(() => {});
    else await fs.rename(victim, lock).catch(() => {}); // a live lock was grabbed: put it back
  } finally { await fs.rmdir(guard).catch(() => {}); }
}
