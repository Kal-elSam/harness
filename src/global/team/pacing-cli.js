// Read-only account pacing: no probes, locks, recovery, or cache writes.
import { readFile } from 'node:fs/promises';
import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readCachedUsage } from '../host/workspace-cache.js';
import { readUsageSamples } from '../observability/usage-samples.js';
import { launchLedgerPath } from './launch-ledger.js';
import { paceQuotaWindows, quotaBurnRate, quotaPressure } from '../intelligence/quota-pacing.js';

const HOUR = 3600000, MAX_AGE = 30 * 60000;
const severity = { HEALTHY: 0, WATCH: 1, CONSERVE: 2, CRITICAL: 3 };
const known = p => p && p.tier !== null && p.windows.length > 0;
const runway = p => Math.min(Infinity, ...p.windows.filter(w => w.exhaustionInMs !== null && w.resetsInMs !== null && w.exhaustionInMs <= w.resetsInMs).map(w => w.exhaustionInMs));
const projected = p => {
  const values = p.windows.flatMap(w => Number.isFinite(w.projectedRemaining) ? [w.projectedRemaining] : []);
  return values.length ? Math.min(...values) : null;
};

/** Reference ordering, before launch-count balancing. Null means tied/unknown. */
export function comparePacingAvailability(claude, codex) {
  if (!known(claude) || !known(codex)) return null;
  if (claude.expectedDeadTimeMs !== codex.expectedDeadTimeMs) return codex.expectedDeadTimeMs < claude.expectedDeadTimeMs ? 'codex' : 'claude';
  if (claude.tier !== codex.tier) return severity[codex.tier] < severity[claude.tier] ? 'codex' : 'claude';
  if (runway(claude) !== runway(codex)) return runway(codex) > runway(claude) ? 'codex' : 'claude';
  const a = projected(claude), b = projected(codex);
  return a === null || b === null || Math.abs(a - b) <= 1e-12 ? null : b > a ? 'codex' : 'claude';
}

export function chooseNextWriter(providers, counts = {}) {
  if (!known(providers.claude) && !known(providers.codex)) return null;
  const preferred = comparePacingAvailability(providers.claude, providers.codex)
    ?? ((counts.claude ?? 0) > (counts.codex ?? 0) ? 'codex' : 'claude');
  return preferred === 'codex' ? 'team-builder-codex' : 'team-builder';
}

export function buildPacingSnapshot(capacities, samples = {}, launches = [], now = Date.now()) {
  const providers = Object.fromEntries(Object.entries(capacities).map(([provider, capacity]) => {
    const own = samples[provider] ?? [];
    const windows = (capacity.quotaWindows ?? []).map(w => {
      const rate = quotaBurnRate(w, { samples: own, now });
      const exhaustion = rate > 0 ? w.remainingPercent / rate : null;
      return { name: w.kind, remainingPercent: w.remainingPercent, resetsAt: w.resetsAtIso,
        resetsInMs: w.resetsInMs, projectedRemaining: rate === null ? null : (w.remainingPercent - rate * w.resetsInMs) / 100,
        exhaustionInMs: exhaustion,
        tier: quotaPressure({ quotaWindows: [w] }, { samples: own, now }).tier,
        expectedDeadTimeMs: exhaustion !== null && w.resetsInMs !== null ? Math.max(0, w.resetsInMs - exhaustion) : 0 };
    });
    return [provider, { tier: windows.length ? quotaPressure(capacity, { samples: own, now }).tier : null,
      windows, expectedDeadTimeMs: windows.length ? Math.max(0, ...windows.map(w => w.expectedDeadTimeMs)) : null }];
  }));
  const writerCounts = { claude: 0, codex: 0 };
  for (const row of launches) {
    const at = Date.parse(row.at);
    if (row.source === 'launch' && row.role === 'Builder' && Object.hasOwn(writerCounts, row.adapterId)
      && at <= now && at >= now - 7 * 24 * HOUR) writerCounts[row.adapterId]++;
  }
  return { providers, writerCounts, preferredProvider: comparePacingAvailability(providers.claude, providers.codex), nextWriter: chooseNextWriter(providers, writerCounts) };
}

async function readLedger(home, root) {
  try { return (await readFile(launchLedgerPath(home, root), 'utf8')).split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export async function runTeamPacingCli(options, deps = {}) {
  const home = deps.homeDir ?? resolveHomeDir(), now = (deps.now ?? Date.now)();
  const root = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
  const cached = await (deps.readCachedUsage ?? readCachedUsage)(home);
  const usage = cached && Number.isFinite(cached.savedAt) && cached.savedAt <= now && now - cached.savedAt <= MAX_AGE ? cached.value?.usage ?? {} : {};
  const sources = { claude: usage.claude, codex: usage.codex, 'opencode-go': usage.opencode?.go };
  const capacities = {}, samples = {};
  for (const [provider, source] of Object.entries(sources)) {
    const rows = await (deps.readUsageSamples ?? readUsageSamples)(home, provider, { now: () => now });
    const latest = new Map();
    for (const row of rows) if (row.timestamp <= now && now - row.timestamp <= MAX_AGE && row.resetsAt > now
      && (!latest.has(row.window) || latest.get(row.window).timestamp < row.timestamp)) latest.set(row.window, row);
    const observed = [...latest.values()].map(row => ({ name: row.window, remainingPercent: row.remainingPercent, resetsAt: row.resetsAt / 1000 }));
    const windows = paceQuotaWindows(source, now);
    // Newer account samples win per window, never manufacture a reset/remainder.
    for (const w of paceQuotaWindows({ windows: observed }, now)) {
      const index = windows.findIndex(old => /week/i.test(old.kind) === /week/i.test(w.kind));
      if (index < 0) windows.push(w);
      else if (latest.get(w.kind)?.timestamp >= (cached?.savedAt ?? 0)) windows[index] = w;
    }
    capacities[provider] = { quotaWindows: windows };
    samples[provider] = rows.map(row => ({ ...row, window: windows.find(w => /week/i.test(w.kind) === /week/i.test(row.window))?.kind ?? row.window, ts: row.timestamp }));
  }
  const result = { ok: true, generatedAt: new Date(now).toISOString(), ...buildPacingSnapshot(capacities, samples, await (deps.readLedger ?? readLedger)(home, root), now) };
  const minutes = ms => ms === null ? 'unknown' : `${Math.ceil(ms / 60000)}m`;
  const text = Object.entries(result.providers).map(([name, p]) => `${name} ${p.windows.map(w => `${w.name} ${w.remainingPercent}%`).join(' ') || 'quota unknown'} ${p.tier ?? 'UNKNOWN'}; dead ${minutes(p.expectedDeadTimeMs)}; reset ${p.windows.map(w => w.resetsAt ?? 'unknown').join(', ') || 'unknown'}`).join('\n');
  (deps.log ?? console.log)(options.json ? JSON.stringify(result) : text);
  return result;
}
