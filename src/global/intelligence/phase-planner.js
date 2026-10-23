import { quotaBurnRate } from './quota-pacing.js';
import { capacityUntil, weeklyCostPerBurst } from './window-capacity.js';

const HOUR = 3600000;
const iso = time => new Date(time).toISOString();

/** Pure workload-scaled burn forecast through the latest currently known reset.
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
      return { provider, window, reset, duration, remaining: window.remainingPercent,
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
    for (let reset = w.reset; reset <= horizon; reset += w.duration) {
      add(reset, { type: 'reset', provider: w.provider, window: w.window.kind });
    }
  }
  const baselineLoad = new Map();
  for (const entry of idealTeam) {
    if (!entry.model || entry.assignmentState === 'blocked') continue;
    const provider = entry.model.adapterId;
    baselineLoad.set(provider, (baselineLoad.get(provider) ?? 0) + 1);
  }
  const phases = [];
  let start = now;
  while (start <= horizon) {
    const events = boundaries.get(start) ?? [];
    const capacity = {};
    for (const [provider, original] of Object.entries(providerCapacity ?? {})) {
      const quotaWindows = (original.quotaWindows ?? []).map(window => {
        const w = windows.find(w => w.provider === provider && w.window === window);
        if (!w) return { ...window };
        if (events.some(event => event.type === 'reset' && event.provider === provider && event.window === window.kind)) {
          w.remaining = 100;
        }
        const resetCount = start >= w.reset ? Math.floor((start - w.reset) / w.duration) + 1 : 0;
        const reset = w.reset + resetCount * w.duration;
        const remainingPercent = Number.isFinite(w.remaining) && w.remaining < 1e-9 ? 0 : w.remaining;
        const left = (reset - start) / w.duration;
        return { ...window, remainingPercent,
          resetsAtIso: iso(reset), resetsInMs: reset - start, timeLeftFraction: left,
          paceFactor: !Number.isFinite(remainingPercent) ? window.paceFactor ?? null
            : remainingPercent === 0 ? 0 : Math.max(.01, Math.min(4, remainingPercent / 100 / left)) };
      });
      const percentages = quotaWindows.map(w => w.remainingPercent).filter(Number.isFinite);
      const remainingPercent = percentages.length ? Math.min(...percentages) : original.quotaRemainingPercent ?? null;
      const paces = quotaWindows.map(w => w.paceFactor).filter(Number.isFinite);
      const quotaPaceFactor = paces.length ? Math.min(...paces) : original.quotaPaceFactor ?? null;
      capacity[provider] = { ...original, quotaWindows, quotaRemainingPercent: remainingPercent, quotaPaceFactor };
    }
    const available = Object.keys(capacity).filter(provider => capacity[provider].quotaRemainingPercent !== 0);
    // Providers without quota observations retain existing eligibility, not a fabricated quota.
    for (const entry of idealTeam) {
      for (const model of [entry.model, entry.fallback]) {
        if (model && !capacity[model.adapterId] && !available.includes(model.adapterId)) available.push(model.adapterId);
      }
    }
    const idealProviders = new Map(idealTeam.map(entry => [entry.role, entry.model?.adapterId]));
    const denied = new Set();
    const allowed = (role, provider) => !denied.has(`${role}::${provider}`);
    const deadTime = (provider, count) => Math.max(0, ...(capacity[provider]?.quotaWindows ?? []).map(window => {
      const observed = windows.find(w => w.provider === provider && w.window.kind === window.kind);
      if (!observed || !Number.isFinite(window.resetsInMs) || !Number.isFinite(window.remainingPercent)) return 0;
      const rate = (observed?.rate ?? 0) * count / (baselineLoad.get(provider) || 1);
      const exhaustsIn = window.remainingPercent === 0 ? 0
        : rate > 0 && Number.isFinite(window.remainingPercent) ? window.remainingPercent / rate : Infinity;
      return Math.max(0, window.resetsInMs - exhaustsIn);
    }));
    let selected = selectTeam(capacity, available, allowed);
    // Admit transfers against the receiving provider's native workload. Each
    // accepted transfer contributes its burn to subsequent admission decisions.
    // Re-coordinate after a denial so waiting roles do not inflate phase caps.
    while (true) {
      const nativeLoad = new Map();
      for (const entry of selected) {
        if (entry.model && entry.model.adapterId === idealProviders.get(entry.role)) {
          nativeLoad.set(entry.model.adapterId, (nativeLoad.get(entry.model.adapterId) ?? 0) + 1);
        }
      }
      const admittedLoad = new Map(nativeLoad);
      const before = denied.size;
      for (const entry of selected) {
        const provider = entry.model?.adapterId;
        if (!provider || !idealProviders.get(entry.role) || provider === idealProviders.get(entry.role)) continue;
        const load = admittedLoad.get(provider) ?? 0;
        if (deadTime(provider, load + 1) > deadTime(provider, nativeLoad.get(provider) ?? 0) + 1e-6) {
          denied.add(`${entry.role}::${provider}`);
        } else {
          admittedLoad.set(provider, load + 1);
        }
      }
      if (denied.size === before) break;
      selected = selectTeam(capacity, available, allowed).map(entry => {
        if (!entry.model || allowed(entry.role, entry.model.adapterId)) return entry;
        return { ...entry, model: null, fallback: null, assignmentState: 'waiting' };
      });
    }
    selected = selected.map(entry => {
      if (entry.model || ![...denied].some(key => key.startsWith(`${entry.role}::`))) return entry;
      const provider = idealProviders.get(entry.role);
      const providerWindows = capacity[provider]?.quotaWindows ?? [];
      const depleted = providerWindows.filter(window => window.remainingPercent === 0);
      const resets = (depleted.length ? depleted : providerWindows)
        .map(window => Date.parse(window.resetsAtIso)).filter(Number.isFinite);
      const waitUntil = resets.length ? iso(depleted.length ? Math.max(...resets) : Math.min(...resets)) : null;
      return { ...entry, assignmentState: 'waiting', waitUntil,
        reason: `Waiting for ideal provider ${provider} reset${waitUntil ? ` at ${waitUntil}` : ' (reset time unknown)'}; moving this role would lengthen another provider's expected dead time.` };
    });
    const load = new Map();
    for (const entry of selected) {
      if (!entry.model || entry.assignmentState === 'blocked' || entry.assignmentState === 'waiting') continue;
      const provider = entry.model.adapterId;
      load.set(provider, (load.get(provider) ?? 0) + 1);
    }
    // Observed burn belongs to the existing team load. Recompute each interval
    // after selection: idle providers spend nothing, and moving more roles to a
    // provider increases its burn rather than keeping an unconditional clock.
    const rateFor = w => (w.rate ?? 0) * (load.get(w.provider) ?? 0) / (baselineLoad.get(w.provider) || 1);
    for (const w of windows) {
      const rate = rateFor(w);
      if (rate > 0 && w.remaining > 1e-9) {
        add(start + w.remaining / rate, { type: 'exhaustion', provider: w.provider, window: w.window.kind });
      }
    }
    const next = Math.min(...[...boundaries.keys()].filter(time => time > start));
    const budgets = {};
    for (const [provider, projected] of Object.entries(capacity)) {
      const quotaWindows = projected.quotaWindows;
      const conversion = weeklyCostPerBurst(samples[provider] ?? []);
      budgets[provider] = { remainingPercent: projected.quotaRemainingPercent, quotaWindows,
        ...capacityUntil({ fiveHour: quotaWindows.find(w => /5h|session/i.test(w.kind)),
          weekly: quotaWindows.find(w => /week/i.test(w.kind)), conversion, now: start,
          horizon: Number.isFinite(next) ? next : start }) };
    }
    phases.push({ startsAt: iso(start), endsAt: Number.isFinite(next) ? iso(next) : null,
      events, budgets, team: selected });
    if (!Number.isFinite(next)) break;
    // Exhaustions are predictions for this interval only. A reset or another
    // provider's event may change the team, invalidating later predictions.
    for (const [time, pending] of boundaries) {
      if (time > next) {
        const resets = pending.filter(event => event.type === 'reset');
        if (resets.length) boundaries.set(time, resets);
        else boundaries.delete(time);
      }
    }
    for (const w of windows) {
      if (Number.isFinite(w.remaining)) w.remaining = Math.max(0, w.remaining - rateFor(w) * (next - start));
    }
    start = next;
  }
  for (let i = 0; i < phases.length; i++) {
    phases[i].team = phases[i].team.map(entry => {
      if (entry.model || /expected dead time/.test(entry.reason ?? '')) return entry;
      const next = phases.slice(i + 1).find(phase => phase.team.some(candidate => candidate.role === entry.role && candidate.model));
      const waitUntil = next?.startsAt ?? null;
      return { ...entry, assignmentState: 'waiting', waitUntil,
        reason: waitUntil ? `Waiting for the next usable reset at ${waitUntil}; no qualified model has budget in this phase.`
          : 'No qualified budgeted assignment; next usable reset is unknown within this forecast.' };
    });
  }
  return { generatedAt: iso(now), horizon: iso(horizon), idealTeam, phases };
}
