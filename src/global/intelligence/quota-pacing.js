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
export function quotaPressure(capacity) {
  const valid = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const windows = (capacity?.quotaWindows ?? []).filter(w => valid(w.paceFactor));
  const tightest = windows.reduce((a, b) => !a || b.paceFactor < a.paceFactor ? b : a, null);
  const percent = tightest?.remainingPercent ?? capacity?.quotaRemainingPercent;
  const remaining = valid(percent) ? percent / 100 : null;
  const known = remaining != null && valid(remaining) && remaining <= 1;
  const suppliedPace = tightest?.paceFactor ?? capacity?.quotaPaceFactor;
  const pace = valid(suppliedPace) && suppliedPace <= 4 ? suppliedPace : known ? remaining : null;
  const timeLeft = tightest?.timeLeftFraction;
  // Constant observed burn projection: remaining - used/elapsed * timeLeft.
  // Without timing, only an observed low remaining share activates reserve;
  // do not invent a reset or promise that this heuristic prevents exhaustion.
  const projected = known && timeLeft > 0 && timeLeft < 1
    ? (remaining - timeLeft) / (1 - timeLeft) : null;
  const reserve = known && (projected != null ? projected <= QUOTA_RESERVE_FRACTION
    : remaining <= QUOTA_RESERVE_FRACTION || (valid(suppliedPace) && suppliedPace < 1));
  // Already inside the reserve: any window at or below 10% whose reset is not imminent.
  // The paced projection above can hide this (a different window may be the tightest by pace).
  const depleted = (capacity?.quotaWindows ?? []).some(w => valid(w.remainingPercent)
    && w.remainingPercent / 100 <= QUOTA_RESERVE_FRACTION
    && !(valid(w.resetsInMs) && w.resetsInMs <= QUOTA_IMMINENT_RESET_MS));
  const belowReserve = known && (depleted || (!windows.length && remaining <= QUOTA_RESERVE_FRACTION));
  return { pressure: pace == null ? 0 : Math.max(0, Math.min(1, 1 - pace)), reserve, belowReserve,
    reserveFraction: QUOTA_RESERVE_FRACTION, projectedRemaining: projected };
}
