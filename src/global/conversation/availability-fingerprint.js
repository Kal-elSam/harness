// The provider-availability fingerprint: what automatic team recovery keys
// on to decide whether availability really CHANGED since it last acted.
//
// It deliberately keeps only the coarse state per provider — ok, limited on
// a named window, or unavailable — and drops remaining percent and reset
// time. Those move on every refresh; keeping them would make every refresh
// look like a change and trigger a re-analysis each time.

/**
 * @param {Record<string, {ok: boolean, reason: string|null, limit?: {window: string|null}}>} [eligibility] -
 *   the snapshot eligibility built from checkCandidate (service.js).
 * @returns {{key: string, providers: Record<string, string>}}
 */
export function availabilityFingerprint(eligibility = {}) {
  const providers = {};
  for (const adapterId of Object.keys(eligibility ?? {}).sort()) {
    providers[adapterId] = providerState(eligibility[adapterId]);
  }
  const key = Object.entries(providers).map(([adapterId, state]) => `${adapterId}=${state}`).join("|");
  return { key, providers };
}

function providerState(entry) {
  if (entry?.ok === true) return "ok";
  if (entry?.limit) return `limited:${entry.limit.window ?? "usage"}`;
  return "unavailable";
}
