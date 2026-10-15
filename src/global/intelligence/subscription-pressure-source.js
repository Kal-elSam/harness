import { paceQuotaWindows } from "./quota-pacing.js";

// Real subscription quota pressure — how much headroom is actually left
// on each provider's account right now (from the same usage probes
// service.js already fetches for /usage). This is a PROVIDER-level
// signal, not a per-model efficiency measurement: quota is account-wide,
// so it is modeled here as its own ProviderCapacity map, keyed by
// adapterId — never copied into the per-model capability registry as if
// it were evidence about an individual model. Two models from the same
// provider share the exact same real capacity entry; there is no way to
// represent "this model is more quota-efficient than that one" here,
// because that isn't a real, measurable thing — only the provider's
// account has quota.
//
// Team selection (model-cost.js) divides each model's AA price by the
// provider's reset-paced quota fraction (raw remaining fraction when unknown), so pressure makes
// all of its models effectively more expensive. Missing quota is neutral;
// zero remaining quota is never cheap.

/**
 * @typedef {object} ProviderCapacity
 * @property {string} adapterId
 * @property {number} [quotaRemainingPercent]
 */

/**
 * Builds a real ProviderCapacity map from the same remaining-percent
 * figures already computed for /usage — one entry per adapter that
 * reported a real number, never a fabricated one for an adapter with no
 * data.
 * @param {Record<string, number|null|undefined>} remainingPercentByAdapter
 * @param {Record<string, object>} [usageByAdapter] - Reader windows, including real reset times.
 * @param {number} [now] - Epoch milliseconds, injectable for deterministic pacing.
 * @returns {Record<string, ProviderCapacity>}
 */
export function buildProviderCapacity(remainingPercentByAdapter, usageByAdapter = {}, now = Date.now()) {
  const capacity = {};
  for (const [adapterId, remainingPercent] of Object.entries(remainingPercentByAdapter ?? {})) {
    if (remainingPercent == null) continue;
    const quotaWindows = paceQuotaWindows(usageByAdapter[adapterId], now);
    capacity[adapterId] = { adapterId, quotaRemainingPercent: remainingPercent,
      ...(quotaWindows.length ? { quotaWindows, quotaPaceFactor: Math.min(...quotaWindows.map(w => w.paceFactor)) } : {}) };
  }
  return capacity;
}
