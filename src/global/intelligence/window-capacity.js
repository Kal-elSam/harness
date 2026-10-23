// Pure account-quota arithmetic. Percentages are points (0..100); all times
// here are epoch milliseconds or explicit ISO timestamps, not epoch seconds.
const HOUR = 3600000;
const BURST = 5 * HOUR;
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const time = value => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;

/** Weekly percentage points consumed by one full five-hour window.
 * Only adjacent, simultaneous two-window readings count as independent
 * intervals. Never bridge resets, providers, rising counters or zero burns.
 */
export function weeklyCostPerBurst(samples = []) {
  const snapshots = new Map();
  const providers = new Set();
  for (const row of samples) {
    if (!row || !['5h', 'weekly'].includes(row.window) || !percent(row.remainingPercent)) continue;
    const timestamp = time(row.timestamp);
    const reset = time(row.resetsAt);
    if (!Number.isFinite(timestamp) || !Number.isFinite(reset) || reset <= timestamp) continue;
    providers.add(row.provider);
    const key = `${row.provider ?? ''}:${timestamp}`;
    const snapshot = snapshots.get(key) ?? { timestamp };
    const previous = snapshot[row.window];
    if (previous && (previous.remainingPercent !== row.remainingPercent || previous.reset !== reset)) snapshot.conflict = true;
    snapshot[row.window] = { remainingPercent: row.remainingPercent, reset };
    snapshots.set(key, snapshot);
  }
  // Conversion belongs to one account, never a blend of provider quotas.
  if (providers.size > 1) return null;
  const readings = [...snapshots.values()].sort((a, b) => a.timestamp - b.timestamp);
  const ratios = [];
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1], b = readings[i];
    if (a.conflict || b.conflict || !a['5h'] || !b['5h'] || !a.weekly || !b.weekly) continue;
    if (a['5h'].reset !== b['5h'].reset || a.weekly.reset !== b.weekly.reset) continue;
    const burstSpent = a['5h'].remainingPercent - b['5h'].remainingPercent;
    const weeklySpent = a.weekly.remainingPercent - b.weekly.remainingPercent;
    if (burstSpent > 0 && weeklySpent > 0) ratios.push(100 * weeklySpent / burstSpent);
  }
  if (ratios.length < 3) return null;
  ratios.sort((a, b) => a - b);
  const middle = Math.floor(ratios.length / 2);
  return ratios.length % 2 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2;
}

/** Available spend before horizon, bounded by the current weekly instance.
 * A refill at the horizon itself cannot be spent before that horizon.
 * Future five-hour windows assume immediate use after each refill (an upper
 * capacity bound, not a prediction of future usage or a guarantee of throughput).
 * Unknown conversion uses weekly-percent units, NEVER guessed burst units.
 */
export function capacityUntil({ fiveHour, weekly, conversion, now, horizon }) {
  const weeklyReset = time(weekly?.resetsAtIso ?? weekly?.resetsAt);
  const burstReset = time(fiveHour?.resetsAtIso ?? fiveHour?.resetsAt);
  const end = Math.min(time(horizon), weeklyReset);
  const weeklyKnown = percent(weekly?.remainingPercent) && Number.isFinite(now)
    && Number.isFinite(end) && weeklyReset > now;
  const weeklyHours = weeklyKnown ? (weeklyReset - now) / HOUR : null;
  const knownConversion = typeof conversion === 'number' && Number.isFinite(conversion) && conversion > 0;
  const burstKnown = percent(fiveHour?.remainingPercent) && burstReset > now && burstReset - now <= BURST;
  if (!weeklyKnown || !knownConversion || !burstKnown) {
    return { fallback: 'weekly-only', unit: 'weekly-percent',
      spendAvailable: weeklyKnown ? (end > now ? weekly.remainingPercent : 0) : null,
      fiveHourUnits: null, weeklyCapUnits: null, currentFiveHourUnits: null, refills: null,
      sustainableFiveHourUnitsPerHour: null,
      weeklyPercentPerHour: weeklyKnown ? weekly.remainingPercent / weeklyHours : null,
      horizon: weeklyKnown ? Math.max(now, end) : null };
  }
  const currentFiveHourUnits = fiveHour.remainingPercent / 100;
  const refills = end > burstReset ? Math.ceil((end - burstReset) / BURST) : 0;
  const weeklyCapUnits = weekly.remainingPercent / conversion;
  const fiveHourUnits = end > now ? Math.min(currentFiveHourUnits + refills, weeklyCapUnits) : 0;
  return { fallback: null, unit: 'five-hour-window', spendAvailable: fiveHourUnits,
    fiveHourUnits, currentFiveHourUnits, refills, weeklyCapUnits,
    sustainableFiveHourUnitsPerHour: Math.min(weeklyCapUnits, currentFiveHourUnits
      + (weeklyReset > burstReset ? Math.ceil((weeklyReset - burstReset) / BURST) : 0)) / weeklyHours,
    weeklyPercentPerHour: weekly.remainingPercent / weeklyHours, horizon: Math.max(now, end) };
}
