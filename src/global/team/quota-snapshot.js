// Shared access to routing-input cache quota windows (the only production quota writer).
import { ROUTING_INPUT_CACHE_SCHEMA } from './routing-input-cache.js';

// Quota is account-wide; a snapshot this recent is still trusted.
export const QUOTA_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

/** True when the routing-input cache carries capacity data recent enough to trust. */
export function isRoutingQuotaUsable(routing, now) {
  const at = routing?.generatedAt;
  return routing?.schema === ROUTING_INPUT_CACHE_SCHEMA && Boolean(routing.providerCapacity)
    && Number.isFinite(at) && at <= now && now - at <= QUOTA_CACHE_MAX_AGE_MS;
}

/** Quota windows for one provider from a usable routing-input cache, else null. */
export function routingQuotaWindows(routing, provider, now) {
  if (!isRoutingQuotaUsable(routing, now)) return null;
  const all = routing.providerCapacity[provider]?.quotaWindows;
  if (!Array.isArray(all)) return null;
  // A window whose reset already passed no longer describes the account.
  const windows = all.filter(w => {
    const reset = w?.resetsAtIso ? Date.parse(w.resetsAtIso) : Number.isFinite(w?.resetsInMs) ? routing.generatedAt + w.resetsInMs : NaN;
    return !(reset <= now);
  });
  return windows.length ? windows : null;
}
