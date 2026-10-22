// Account-wide, append-only observations in the routing cache's Kairo home
// area. Compaction is the only rewrite and shares the append lock.
import { mkdir, open, readFile, rmdir, stat } from 'node:fs/promises';
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
export async function appendUsageSamples(homeDir, provider, usage, { now = Date.now } = {}) {
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
  for (let attempt = 0; ; attempt++) {
    try { await mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = await stat(lock).then(s => now() - s.mtimeMs, () => 0);
      if (age > STALE_LOCK_MS) { await rmdir(lock).catch(() => {}); continue; }
      if (attempt >= 100) throw new Error('Usage samples are busy; recording skipped.');
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
  } finally { await rmdir(lock); }
}
