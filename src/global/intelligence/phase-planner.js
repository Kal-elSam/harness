import { quotaBurnRate } from './quota-pacing.js';
import { capacityUntil, weeklyCostPerBurst } from './window-capacity.js';

const HOUR = 3600000;
const iso = time => new Date(time).toISOString();

/** Pure constant-burn forecast through the latest currently known reset.
 * Unknown burn remains unknown; unknown capacity is not invented. Each request
 * spends both windows. A 5h refill never refills the weekly window.
 * selectTeam retains the original scoring cohort and enforces role floors/caps.
 */
export function buildPhasePlan({ idealTeam, providerCapacity = {}, samples = {}, now, selectTeam }) {
  const windows = Object.entries(providerCapacity ?? {}).flatMap(([provider, capacity]) =>
    (capacity.quotaWindows ?? []).map(window => {
      const reset = Date.parse(window.resetsAtIso);
      const duration = window.timeLeftFraction > 0 ? window.resetsInMs / window.timeLeftFraction
        : /week/i.test(window.kind) ? 168 * HOUR : /5h|session/i.test(window.kind) ? 5 * HOUR : null;
      return { provider, window, reset, duration,
        rate: quotaBurnRate(window, { samples: (samples[provider] ?? []).map(sample => ({
          ...sample, ts: sample.ts ?? sample.timestamp,
          window: /week/i.test(window.kind) && sample.window === 'weekly' || /5h|session/i.test(window.kind) && sample.window === '5h'
            ? window.kind : sample.window
        })), now }) };
    }).filter(w => Number.isFinite(w.reset) && w.reset > now && w.duration > 0));
  const horizon = Math.max(now, ...windows.map(w => w.reset));
  const boundaries = new Map([[now, []]]);
  const add = (time, event) => {
    time = Math.ceil(time);
    if (time <= now || time > horizon) return;
    boundaries.set(time, [...(boundaries.get(time) ?? []), event]);
  };
  for (const w of windows) {
    const event = type => ({ type, provider: w.provider, window: w.window.kind });
    if (w.rate > 0 && w.window.remainingPercent > 0) {
      const exhaustion = now + w.window.remainingPercent / w.rate;
      if (exhaustion <= w.reset) add(exhaustion, event('exhaustion'));
    }
    for (let reset = w.reset; reset <= horizon; reset += w.duration) {
      add(reset, event('reset'));
      if (w.rate > 0 && 100 / w.rate < w.duration) add(reset + 100 / w.rate, event('exhaustion'));
    }
  }
  const starts = [...boundaries.keys()].sort((a, b) => a - b);
  const phases = starts.map((start, index) => {
    const capacity = {};
    const budgets = {};
    for (const [provider, original] of Object.entries(providerCapacity ?? {})) {
      const quotaWindows = (original.quotaWindows ?? []).map(window => {
        const w = windows.find(w => w.provider === provider && w.window === window);
        if (!w) return { ...window };
        const resetCount = start >= w.reset ? Math.floor((start - w.reset) / w.duration) + 1 : 0;
        const periodStart = resetCount ? w.reset + (resetCount - 1) * w.duration : now;
        const reset = w.reset + resetCount * w.duration;
        const remainingPercent = Math.max(0, (resetCount ? 100 : window.remainingPercent) - (w.rate ?? 0) * (start - periodStart));
        const left = (reset - start) / w.duration;
        return { ...window, remainingPercent: remainingPercent < 1e-9 ? 0 : remainingPercent,
          resetsAtIso: iso(reset), resetsInMs: reset - start, timeLeftFraction: left,
          paceFactor: remainingPercent === 0 ? 0 : Math.max(.01, Math.min(4, remainingPercent / 100 / left)) };
      });
      const percentages = quotaWindows.map(w => w.remainingPercent).filter(Number.isFinite);
      const remainingPercent = percentages.length ? Math.min(...percentages) : original.quotaRemainingPercent ?? null;
      const paces = quotaWindows.map(w => w.paceFactor).filter(Number.isFinite);
      const quotaPaceFactor = paces.length ? Math.min(...paces) : original.quotaPaceFactor ?? null;
      capacity[provider] = { ...original, quotaWindows, quotaRemainingPercent: remainingPercent, quotaPaceFactor };
      const conversion = weeklyCostPerBurst(samples[provider] ?? []);
      budgets[provider] = { remainingPercent, quotaWindows,
        ...capacityUntil({ fiveHour: quotaWindows.find(w => /5h|session/i.test(w.kind)),
          weekly: quotaWindows.find(w => /week/i.test(w.kind)), conversion, now: start,
          horizon: starts[index + 1] ?? start }) };
    }
    const available = Object.keys(capacity).filter(provider => budgets[provider].remainingPercent !== 0);
    // Providers without quota observations retain existing eligibility, not a fabricated quota.
    for (const entry of idealTeam) {
      for (const model of [entry.model, entry.fallback]) {
        if (model && !capacity[model.adapterId] && !available.includes(model.adapterId)) available.push(model.adapterId);
      }
    }
    const selected = selectTeam(capacity, available);
    return { startsAt: iso(start), endsAt: starts[index + 1] ? iso(starts[index + 1]) : null,
      events: boundaries.get(start), budgets, team: selected };
  });
  for (let i = 0; i < phases.length; i++) {
    phases[i].team = phases[i].team.map(entry => {
      if (entry.model) return entry;
      const next = phases.slice(i + 1).find(phase => phase.team.some(candidate => candidate.role === entry.role && candidate.model));
      const waitUntil = next?.startsAt ?? null;
      return { ...entry, assignmentState: 'waiting', waitUntil,
        reason: waitUntil ? `Waiting for the next usable reset at ${waitUntil}; no qualified model has budget in this phase.`
          : 'No qualified budgeted assignment; next usable reset is unknown within this forecast.' };
    });
  }
  return { generatedAt: iso(now), horizon: iso(horizon), idealTeam, phases };
}
