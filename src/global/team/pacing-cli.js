// Account pacing reuses routing refresh only when current quota is unavailable.
import { readFile } from 'node:fs/promises';
import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readRoutingInputCache, refreshRoutingInputs } from './routing-input-cache.js';
import { isRoutingQuotaUsable, routingQuotaWindows } from './quota-snapshot.js';
import { readCachedUsage } from '../host/workspace-cache.js';
import { readUsageSamples } from '../observability/usage-samples.js';
import { launchLedgerPath } from './launch-ledger.js';
import { paceQuotaWindows, alignSamplesToWindows, providerPacingWindows, quotaPressure } from '../intelligence/quota-pacing.js';
import { windowLabel } from '../hosts/pacing-context.js';

const HOUR = 3600000, MAX_AGE = 2 * 60_000;
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
    const windows = providerPacingWindows(capacity, own, now);
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

export function formatDuration(ms) {
  const minutes = Math.ceil(ms / 60000), hours = Math.floor(minutes / 60);
  return hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;
}
function localReset(iso, now) {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  return date.toDateString() === new Date(now).toDateString()
    ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function readLedger(home, root) {
  try { return (await readFile(launchLedgerPath(home, root), 'utf8')).split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export async function runTeamPacingCli(options, deps = {}) {
  const home = deps.homeDir ?? resolveHomeDir();
  let now = (deps.now ?? Date.now)();
  const root = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
  const cached = await (deps.readCachedUsage ?? readCachedUsage)(home);
  const fresh = at => Number.isFinite(at) && at <= now && now - at <= MAX_AGE;
  const usage = fresh(cached?.savedAt) ? cached.value?.usage ?? {} : {};
  let routing;
  if (!fresh(cached?.savedAt)) {
    const read = deps.readRoutingInputCache ?? readRoutingInputCache;
    // Usable for 30 minutes; anything older than MAX_AGE is refreshed without being dropped.
    const valid = value => isRoutingQuotaUsable(value, now);
    const current = value => valid(value) && fresh(value.generatedAt);
    const background = async () => {
      const { startBackgroundRefresh } = deps.startBackgroundRefresh ? deps : await import('./background-refresh.js');
      await startBackgroundRefresh({ homeDir: home, projectRoot: root });
    };
    try {
      routing = await read(home, root);
      if (!current(routing) && options.noWait) {
        // Hosts with a short hook budget: answer now (usable data is kept), refresh detached.
        await background().catch(() => {});
      } else if (!current(routing)) {
        const stale = valid(routing) ? routing : null;
        try {
          await (deps.refreshRoutingInputs ?? refreshRoutingInputs)({ homeDir: home, cwd: root }, deps);
          routing = await read(home, root);
          now = (deps.now ?? Date.now)();
        } catch (error) { if (!stale) throw error; routing = stale; }
      }
      if (!valid(routing)) routing = null;
    } catch { routing = null; } // Offline refresh must not block the host.
  }
  const sources = { claude: usage.claude, codex: usage.codex, 'opencode-go': usage.opencode?.go };
  const capacities = {}, samples = {};
  for (const [provider, source] of Object.entries(sources)) {
    const rows = await (deps.readUsageSamples ?? readUsageSamples)(home, provider, { now: () => now });
    const latest = new Map();
    for (const row of rows) if (row.timestamp <= now && now - row.timestamp <= MAX_AGE && row.resetsAt > now
      && (!latest.has(row.window) || latest.get(row.window).timestamp < row.timestamp)) latest.set(row.window, row);
    const observed = [...latest.values()].map(row => ({ name: row.window, remainingPercent: row.remainingPercent, resetsAt: row.resetsAt / 1000 }));
    const windows = routingQuotaWindows(routing, provider, now)?.map(w => ({ ...w,
      resetsInMs: w.resetsAtIso ? Math.max(0, Date.parse(w.resetsAtIso) - now) : w.resetsInMs })) ?? paceQuotaWindows(source, now);
    // Newer account samples win per window, never manufacture a reset/remainder.
    for (const w of paceQuotaWindows({ windows: observed }, now)) {
      const index = windows.findIndex(old => /week/i.test(old.kind) === /week/i.test(w.kind));
      if (index < 0) windows.push(w);
      else if (latest.get(w.kind)?.timestamp >= (routing?.generatedAt ?? cached?.savedAt ?? 0)) windows[index] = w;
    }
    capacities[provider] = { quotaWindows: windows };
    samples[provider] = alignSamplesToWindows(rows, windows);
  }
  // Observation time of the quota in use, so hosts can see how old a no-wait answer is.
  const observedAt = Number.isFinite(routing?.generatedAt) ? routing.generatedAt : fresh(cached?.savedAt) ? cached.savedAt : null;
  const result = { ok: true, generatedAt: new Date(now).toISOString(),
    quotaObservedAt: observedAt === null ? null : new Date(observedAt).toISOString(), stale: observedAt !== null && now - observedAt > MAX_AGE,
    ...buildPacingSnapshot(capacities, samples, await (deps.readLedger ?? readLedger)(home, root), now) };
  const unknown = Object.entries(result.providers).filter(([, p]) => !p.windows.length).map(([name]) => name);
  const text = [...Object.entries(result.providers).filter(([, p]) => p.windows.length).map(([name, p]) =>
    `${name}: ${p.windows.map(w => `${windowLabel(w.name)} ${w.remainingPercent}% (resets ${localReset(w.resetsAt, now)})`).join(', ')} - ${p.expectedDeadTimeMs > 0 ? `would sit unused about ${formatDuration(p.expectedDeadTimeMs)}` : 'no expected idle time'}${result.nextWriter ? `; use ${result.nextWriter === 'team-builder-codex' ? 'codex' : 'claude'}` : ''}`),
    ...(unknown.length ? [`No quota data: ${unknown.join(', ')}`] : [])].join('\n');
  (deps.log ?? console.log)(options.json ? JSON.stringify(result) : text);
  return result;
}
