// Pure task affordability: quota observations are account-wide, never model prices.
import { currentRegistry } from './role-registry.js';
import { capacityUntil, weeklyCostPerBurst } from './window-capacity.js';

const BURST = 5 * 3600000;
const time = value => typeof value === 'number' ? value : Date.parse(value);
const percent = value => Number.isFinite(value) && value >= 0 && value <= 100;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};

/** Estimate one role's five-hour percentage points per provider. Three isolated
 * observations are required. Launch-only rows use their enclosing adjacent
 * sample pair; completed runs use samples bracketing their start and end.
 * Concurrent/ambiguous work and reset crossings never establish cheap history.
 */
export function estimateTaskCost({ role, ledger = [], samples = [] }) {
  const tier = currentRegistry()[role]?.tier;
  const defaultCost = { fiveHourPercent: ({ light: 10, standard: 30, demanding: 40 })[tier] ?? 40,
    withoutHistory: true, observations: 0, weeklyPercentPerBurst: null };
  const byProvider = {};
  const providers = new Set([...ledger.map(row => row.adapterId), ...samples.map(row => row.provider)].filter(Boolean));
  for (const provider of providers) {
    const providerSamples = samples.filter(row => row.provider === provider);
    const rows = providerSamples.filter(row => row.window === '5h' && percent(row.remainingPercent)
      && Number.isFinite(time(row.timestamp)) && time(row.resetsAt) > time(row.timestamp))
      .sort((a, b) => time(a.timestamp) - time(b.timestamp));
    // Collapse duplicate records (same launch observed in both stores).
    const runs = [...new Map(ledger.filter(row => row.adapterId === provider)
      .map(row => [`${row.modelId ?? ''}:${row.role}:${time(row.at)}`, row])).values()];
    const costs = [];
    const usedPairs = new Set();
    for (const run of runs) {
      if (run.role !== role || !['completed', 'succeeded'].includes(run.status)) continue;
      const start = time(run.at), end = time(run.endAt);
      const before = rows.findLast(row => time(row.timestamp) <= start);
      const after = rows.find(row => time(row.timestamp) >= (Number.isFinite(end) ? end : start)
        && time(row.timestamp) > time(before?.timestamp));
      if (!before || !after || time(before.resetsAt) !== time(after.resetsAt)) continue;
      const a = time(before.timestamp), b = time(after.timestamp);
      if (b >= time(before.resetsAt) || b - a > BURST || (Number.isFinite(end) && end < start)) continue;
      const overlaps = runs.filter(other => {
        const s = time(other.at), e = time(other.endAt);
        return Number.isFinite(s) && s <= b && (Number.isFinite(e) ? e >= a : s >= a);
      });
      const key = `${a}:${b}`;
      const spent = before.remainingPercent - after.remainingPercent;
      if (overlaps.length !== 1 || usedPairs.has(key) || !(spent > 0)) continue;
      // Conflicting snapshots cannot be resolved by input order.
      if (rows.some(row => [a, b].includes(time(row.timestamp))
        && (row.remainingPercent !== (time(row.timestamp) === a ? before : after).remainingPercent
          || time(row.resetsAt) !== time(before.resetsAt)))) continue;
      costs.push(spent);
      usedPairs.add(key);
    }
    byProvider[provider] = { ...defaultCost,
      ...(costs.length >= 3 ? { fiveHourPercent: median(costs), withoutHistory: false } : {}),
      observations: costs.length, weeklyPercentPerBurst: weeklyCostPerBurst(providerSamples) };
  }
  return { defaultCost, byProvider };
}

/** A known, current pair of quota windows must fund the task. Unknown weekly
 * conversion conservatively charges the same percentage points as the burst.
 * Future resets are opportunities, not promises: callers must route again.
 */
export function admit({ candidate, cost, capacity, now }) {
  const windows = capacity?.quotaWindows ?? [];
  const fiveHour = windows.find(w => /5h|session/i.test(w.kind ?? w.window));
  const weekly = windows.find(w => /week/i.test(w.kind ?? w.window));
  const reset = w => time(w?.resetsAtIso ?? w?.resetsAt);
  const fiveReset = reset(fiveHour), weekReset = reset(weekly);
  const points = cost?.fiveHourPercent;
  const base = { provider: candidate.adapterId, cost, admitted: false, waitUntil: null };
  if (!percent(points) || points === 0 || !percent(fiveHour?.remainingPercent) || !percent(weekly?.remainingPercent)
    || !Number.isFinite(now) || !(fiveReset > now) || fiveReset - now > BURST || !(weekReset > now)) {
    return { ...base, reason: 'Rejected: current 5h/weekly capacity or task cost is unknown; refresh quota inputs.' };
  }
  const conversion = cost.weeklyPercentPerBurst > 0 ? cost.weeklyPercentPerBurst : 100;
  const weeklyCost = points / 100 * conversion;
  const available = capacityUntil({ fiveHour, weekly, conversion, now, horizon: Math.min(fiveReset, weekReset) });
  if (weekly.remainingPercent < weeklyCost) {
    return { ...base, waitUntil: weeklyCost <= 100 ? Math.max(weekReset, fiveHour.remainingPercent < points ? fiveReset : now) : null,
      reason: `Rejected: weekly ${weekly.remainingPercent}% left cannot cover ${weeklyCost}% task cost; 5h reset alone cannot help.` };
  }
  if (fiveHour.remainingPercent < points || available.spendAvailable < points / 100) {
    return { ...base, waitUntil: fiveReset,
      reason: `Rejected: 5h ${fiveHour.remainingPercent}% left cannot cover ${points}% task cost; wait until ${new Date(fiveReset).toISOString()}.` };
  }
  return { ...base, admitted: true, reason: `Admitted: 5h ${fiveHour.remainingPercent}% covers ${points}%; weekly ${weekly.remainingPercent}% covers ${weeklyCost}%.` };
}
