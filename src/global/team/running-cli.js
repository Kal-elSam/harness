import { setTimeout as delay } from 'node:timers/promises';
import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readRunningLaunches, readModelDistribution } from './launch-ledger.js';

function formatItem(row) {
  const minutes = Math.floor(row.elapsedMs / 60000);
  const elapsed = minutes < 1 ? `${Math.floor(row.elapsedMs / 1000)}s` : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${row.role} - ${row.modelId} - ${row.adapterId} (${row.agent}, ${elapsed})${row.status === 'possibly abandoned' ? ' - possibly abandoned' : ''}`;
}

/** Snapshot by default; watch emits snapshots every two seconds until interrupted. */
export async function runTeamRunningCli(options, deps = {}) {
  const home = deps.homeDir ?? resolveHomeDir();
  const root = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
  const controller = new AbortController();
  const signal = deps.signal ?? controller.signal;
  const stop = () => controller.abort();
  const seen = new Set();
  const log = deps.log ?? console.log;
  if (options.summary) {
    const result = await (deps.readModelDistribution ?? readModelDistribution)(home, root, { now: deps.now ?? Date.now });
    const line = rows => rows.map(r => `${r.modelId} (${r.adapterId}) ${r.launches}`).join(', ') || 'no launches';
    log(options.json ? JSON.stringify(result) : `Today: ${line(result.today)}\nLast 7 days: ${line(result.last7Days)}`);
    return result;
  }
  if (options.watch && !deps.signal) process.once('SIGINT', stop);
  try {
    do {
      const snapshot = await (deps.readRunningLaunches ?? readRunningLaunches)(home, root, { now: deps.now ?? Date.now });
      const abandoned = snapshot.abandoned.filter(row => !seen.has(row.id));
      abandoned.forEach(row => seen.add(row.id));
      const result = { ...snapshot, abandoned };
      log(options.json ? JSON.stringify(result) : [...result.running.map(formatItem), ...abandoned.map(formatItem)].join('\n') || 'No delegated work running.');
      if (!options.watch) return result;
      try { await (deps.sleep ?? ((ms) => delay(ms, undefined, { signal })))(2000); }
      catch (error) { if (!signal.aborted) throw error; }
    } while (!signal.aborted);
  } finally {
    if (options.watch && !deps.signal) process.removeListener('SIGINT', stop);
  }
}
