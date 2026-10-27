// Pace is remaining quota / remaining window time. Clamp to [0.01, 4]
// (zero stays zero) to bound cost discounts and pressure amplification.
const HOUR = 3600000;
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

function localParts(timestamp, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hourCycle: "h23"
  }).formatToParts(timestamp).filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}

function resetTime(value, now, duration) {
  if (typeof value === "number" && Number.isFinite(value)) return value * 1000;
  if (typeof value !== "string") return null;
  const match = value.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}) at (\d{1,2})(?::(\d{2}))?(am|pm) \(([^)]+)\)$/i);
  if (!match) {
    // Only accept explicit ISO offsets, never the host's implicit timezone.
    return /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : null;
  }
  const [, monthText, dayText, hourText, minuteText, period, zone] = match;
  const month = MONTHS.findIndex(m => m.toLowerCase() === monthText.toLowerCase()) + 1;
  const day = Number(dayText), hour12 = Number(hourText), minute = Number(minuteText ?? 0);
  if (hour12 < 1 || hour12 > 12 || minute > 59 || day < 1 || day > 31) return null;
  const hour = hour12 % 12 + (period.toLowerCase() === "pm" ? 12 : 0);
  try {
    const currentYear = localParts(now, zone).year;
    for (const year of [currentYear, currentYear + 1]) {
      const target = Date.UTC(year, month - 1, day, hour, minute);
      let timestamp = target;
      for (let i = 0; i < 4; i++) {
        const p = localParts(timestamp, zone);
        timestamp += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
      }
      const p = localParts(timestamp, zone);
      if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute
          && timestamp > now && timestamp - now <= duration) return timestamp;
    }
  } catch { /* Invalid IANA zone is unknown, never host-local time. */ }
  return null;
}

export function paceQuotaWindows(usage, now = Date.now()) {
  const windows = usage?.windows?.length ? usage.windows : [usage?.primary, usage?.secondary].filter(Boolean);
  return windows.filter(w => !/week\s*\((?!all models\))/i.test(w.name ?? w.label ?? "")
    && typeof w.remainingPercent === "number" && Number.isFinite(w.remainingPercent)
    && w.remainingPercent >= 0 && w.remainingPercent <= 100).map(w => {
    const kind = w.name ?? w.label ?? "";
    const duration = typeof w.windowDurationMins === "number" && Number.isFinite(w.windowDurationMins) && w.windowDurationMins > 0
      ? w.windowDurationMins * 60000
      : /week/i.test(kind) ? 7 * 24 * HOUR : /5h|session/i.test(kind) ? 5 * HOUR : null;
    const timestamp = duration ? resetTime(w.resetsAt ?? w.resetsAtIso, now, duration) : null;
    const timed = Number.isFinite(timestamp) && timestamp > now && timestamp - now <= duration;
    const remaining = w.remainingPercent / 100;
    const timeLeftFraction = timed ? (timestamp - now) / duration : null;
    const paceFactor = remaining === 0 ? 0 : timed ? Math.max(.01, Math.min(4, remaining / timeLeftFraction)) : remaining;
    return { kind, remainingPercent: w.remainingPercent, resetsAt: w.resetsAt ?? null,
      resetsAtIso: timed ? new Date(timestamp).toISOString() : null, resetsInMs: timed ? timestamp - now : null, timeLeftFraction, paceFactor };
  });
}

// S23 assumption: preserve 10% of a quota window until measured burn is available.
export const QUOTA_RESERVE_FRACTION = .10;
// A window that resets within this span is not treated as depleted: its low remainder refills imminently.
export const QUOTA_IMMINENT_RESET_MS = 15 * 60000;
// S23 (Sam, 2026-10-19): a window's burn projection counts only after this share of it has elapsed;
// right after a reset a few percent used extrapolates to a false exhaustion.
export const QUOTA_PROJECTION_MIN_ELAPSED = .25;

function recentQuotaRate(window, samples, now) {
  const reset = Date.parse(window.resetsAtIso);
  if (!Number.isFinite(reset)) return null;
  const own = samples.filter(sample => sample?.window === window.kind && sample.resetsAt === reset
    && Number.isFinite(sample.ts) && sample.ts >= now - 3 * HOUR && sample.ts <= now
    && typeof sample.remainingPercent === "number" && Number.isFinite(sample.remainingPercent)
    && sample.remainingPercent >= 0 && sample.remainingPercent <= 100)
    .sort((a, b) => a.ts - b.ts);
  const first = own[0], last = own[own.length - 1];
  if (own.length < 2 || last.ts - first.ts < 15 * 60000) return null;
  return Math.max(0, first.remainingPercent - last.remainingPercent) / (last.ts - first.ts);
}

/** Percentage points per millisecond, blending observed recent and mature-window burn. */
export function quotaBurnRate(window, { samples = [], now = Date.now(), idle = false } = {}) {
  const { timeLeftFraction: left, resetsInMs: time, remainingPercent: remaining } = window;
  if (!(left > 0 && left <= 1) || !(time > 0) || !Number.isFinite(time)
      || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
  const elapsed = 1 - left;
  const average = elapsed >= QUOTA_PROJECTION_MIN_ELAPSED
    ? (100 - remaining) / (elapsed * time / left) : null;
  // An idle window cannot burn (its provider is blocked by an exhausted window), so recent burn is zero.
  const recent = idle ? 0 : recentQuotaRate(window, samples, now);
  return recent !== null && average !== null ? (recent + average) / 2 : recent ?? average;
}

function quotaTier(windows, samples, now) {
  const severity = { HEALTHY: 0, WATCH: 1, CONSERVE: 2, CRITICAL: 3 };
  const epsilon = 1e-12;
  return windows.reduce((worst, window) => {
    const { timeLeftFraction: left, resetsInMs: time, remainingPercent: remaining } = window;
    if (!(left > 0 && left < 1) || !Number.isFinite(time) || time <= 0
        || time <= QUOTA_IMMINENT_RESET_MS || typeof remaining !== "number"
        || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) return worst;
    const rate = quotaBurnRate(window, { samples, now });
    if (rate === null) return worst;
    const projected = (remaining - rate * time) / 100;
    const exhaustion = rate > 0 ? remaining / rate : Infinity;
    // CRITICAL within 5h of exhaustion, capped at a quarter of the window (75 min for 5h).
    const tier = projected <= epsilon ? (exhaustion < Math.min(5 * HOUR, time / left / 4) ? "CRITICAL" : "CONSERVE")
      : projected < .1 - epsilon ? "CONSERVE" : projected < .25 - epsilon ? "WATCH" : "HEALTHY";
    return severity[tier] > severity[worst] ? tier : worst;
  }, "HEALTHY");
}

/**
 * Optional samples belong to this capacity's provider and have the shape
 * `{ window: kind, resetsAt: epochMilliseconds, ts: epochMilliseconds, remainingPercent }`.
 * Only the additive tier uses blended burn; all legacy policy fields stay unchanged.
 * Pass `now` alongside recorded samples for deterministic recent-window evaluation.
 */
export function quotaPressure(capacity, { samples = [], now = Date.now() } = {}) {
  const valid = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const windows = (capacity?.quotaWindows ?? []).filter(w => valid(w.paceFactor));
  const tightest = windows.reduce((a, b) => !a || b.paceFactor < a.paceFactor ? b : a, null);
  const percent = tightest?.remainingPercent ?? capacity?.quotaRemainingPercent;
  const remaining = valid(percent) ? percent / 100 : null;
  const known = remaining != null && valid(remaining) && remaining <= 1;
  const suppliedPace = tightest?.paceFactor ?? capacity?.quotaPaceFactor;
  const pace = valid(suppliedPace) && suppliedPace <= 4 ? suppliedPace : known ? remaining : null;
  // Constant observed burn projection: remaining - used/elapsed * timeLeft, from the
  // tightest window that is far enough into its period. Early timed windows only
  // activate reserve on an observed low remaining share; without timing, the
  // raw share or pace does. Never invent a reset or promise this prevents exhaustion.
  const timed = windows.filter(w => w.timeLeftFraction > 0 && w.timeLeftFraction < 1);
  const mature = timed.filter(w => 1 - w.timeLeftFraction >= QUOTA_PROJECTION_MIN_ELAPSED);
  const projecting = mature.reduce((a, b) => !a || b.paceFactor < a.paceFactor ? b : a, null);
  const projected = known && projecting
    ? (projecting.remainingPercent / 100 - projecting.timeLeftFraction) / (1 - projecting.timeLeftFraction) : null;
  const reserve = known && (projected != null ? projected <= QUOTA_RESERVE_FRACTION
    : remaining <= QUOTA_RESERVE_FRACTION || (!timed.length && valid(suppliedPace) && suppliedPace < 1));
  // Already inside the reserve: any window at or below 10% whose reset is not imminent.
  // The paced projection above can hide this (a different window may be the tightest by pace).
  const depleted = (capacity?.quotaWindows ?? []).some(w => valid(w.remainingPercent)
    && w.remainingPercent / 100 <= QUOTA_RESERVE_FRACTION
    && !(valid(w.resetsInMs) && w.resetsInMs <= QUOTA_IMMINENT_RESET_MS));
  const belowReserve = known && (depleted || (!windows.length && remaining <= QUOTA_RESERVE_FRACTION));
  return { pressure: pace == null ? 0 : Math.max(0, Math.min(1, 1 - pace)), reserve, belowReserve,
    reserveFraction: QUOTA_RESERVE_FRACTION, projectedRemaining: projected,
    tier: quotaTier(windows, samples, now) };
}

/**
 * Per-window pacing projection for one provider: burn-based exhaustion and the
 * expected dead time (how long the provider sits blocked after exhaustion before reset). Samples use
 * `{ window, resetsAt, ts, remainingPercent }`. Shared by the pacing CLI and routing.
 */
export function providerPacingWindows(capacity, samples = [], now = Date.now()) {
  const quotaWindows = (capacity?.quotaWindows ?? []).map(w => ({ ...w,
    resetsInMs: w.resetsAtIso ? Math.max(0, Date.parse(w.resetsAtIso) - now) : w.resetsInMs }));
  // Work cannot burn a longer window while an exhausted window blocks the provider.
  const blockedUntil = Math.max(0, ...quotaWindows.filter(w => w.remainingPercent <= 0 && w.resetsInMs > 0).map(w => w.resetsInMs));
  return quotaWindows.map(w => {
    const idle = blockedUntil > 0 && w.remainingPercent > 0 && w.resetsInMs > blockedUntil;
    const rate = quotaBurnRate(w, { samples, now, idle });
    const exhaustion = rate > 0 ? w.remainingPercent / rate : null;
    return { name: w.kind, remainingPercent: w.remainingPercent, resetsAt: w.resetsAtIso,
      resetsInMs: w.resetsInMs, projectedRemaining: rate === null ? null : (w.remainingPercent - rate * w.resetsInMs) / 100,
      exhaustionInMs: exhaustion,
      tier: quotaPressure({ quotaWindows: [w] }, { samples, now }).tier,
      expectedDeadTimeMs: exhaustion !== null && w.resetsInMs !== null ? Math.max(0, w.resetsInMs - exhaustion) : 0 };
  });
}

/**
 * Recorded samples name windows '5h' or 'weekly'; capacity windows keep their
 * provider labels. Re-key each sample to the capacity window of the same kind
 * (weekly vs not) and add `ts`, so recent burn counts.
 */
export function alignSamplesToWindows(rows, windows) {
  return rows.map(row => ({ ...row,
    window: windows.find(w => /week/i.test(w.kind) === /week/i.test(row.window))?.kind ?? row.window, ts: row.timestamp }));
}

/**
 * Providers whose pacing projects quota left over at reset (the HEALTHY floor,
 * 25%, on every measurable window). Unknown pacing and exhausted providers are absent.
 */
export function providersWithUnusedQuota(capacities, samples = [], now = Date.now()) {
  return new Set(Object.entries(capacities ?? {}).filter(([provider, capacity]) => {
    if (capacity?.exhaustion) return false;
    const own = alignSamplesToWindows(samples.filter(row => row.provider === provider && row.window), capacity?.quotaWindows ?? []);
    const known = providerPacingWindows(capacity, own, now).filter(w => w.projectedRemaining !== null);
    return known.length > 0 && known.every(w => w.projectedRemaining >= .25);
  }).map(([provider]) => provider));
}
