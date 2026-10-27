import { providerTargetShares } from "./provider-balance.js";

// Per-task model distribution (decision A): spread work equally across every
// provider with a qualified, executable model (S1: equitable delegation).
// Quota is a brake, not a weight: an exhausted provider gets no share and a
// pressured one is excluded upstream.
// Pure: no IO, no clock reads; `now` is an input. Entitlement, executability
// and the role quality floor are resolved upstream and never relaxed here.

export const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const COUNTED_STATUSES = new Set(["completed", "pending", "starting", "running", "in-flight", "in_flight"]);

const keyOf = candidate => `${candidate.adapterId}/${candidate.modelId}`;

function hasKnownCapacity(capacity) {
  const remaining = capacity?.quotaRemainingPercent;
  return Number.isFinite(remaining) && remaining >= 0 && remaining <= 100;
}

// Own evidence for the role: a passed aptitude probe or a measured success
// rate. Public benchmarks never count (S18).
function hasOwnEvidence(candidate) {
  return candidate?.ownedEvidence?.verdict === "pass"
    || (Number.isFinite(candidate?.measuredQuality?.successRate) && candidate.measuredQuality.successRate > 0);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Adapter-level shares: equal for every provider with usable quota. A known
// provider with no usable headroom gets none. Unknown adapters share equally,
// reported as unknown, unless every known provider is exhausted.
function adapterShares(adapterIds, capacity) {
  const known = adapterIds.filter(id => hasKnownCapacity(capacity?.[id]));
  const unknown = adapterIds.filter(id => !known.includes(id));
  const knownShares = new Map([...providerTargetShares(known, capacity)].map(([id, share]) => [id, share > 0 ? 1 : 0]));
  const positive = [...knownShares.values()].filter(v => v > 0);
  const unknownWeight = positive.length || !known.length ? 1 : 0;
  const weights = new Map([...knownShares, ...unknown.map(id => [id, unknownWeight])]);
  const total = [...weights.values()].reduce((sum, w) => sum + w, 0);
  const shares = new Map(adapterIds.map(id => [id, total ? weights.get(id) / total : 0]));
  return { shares, unknown };
}

export function selectDistributedModel({ role, candidates = [], capacity = {}, ledger = [], now, windowMs = DEFAULT_WINDOW_MS, preferred = null } = {}) {
  if (!candidates.length) {
    return { pick: null, targets: {}, actuals: {}, deficits: {}, explanation: `No qualified candidates for role ${role ?? "unknown"}.` };
  }
  const adapterIds = [...new Set(candidates.map(c => c.adapterId))];
  const { shares, unknown } = adapterShares(adapterIds, capacity);
  const exhaustedAll = [...shares.values()].every(s => s === 0);
  const perAdapter = new Map(adapterIds.map(id => [id, candidates.filter(c => c.adapterId === id).length]));

  const funded = exhaustedAll ? candidates : candidates.filter(c => (shares.get(c.adapterId) ?? 0) > 0);
  // Unknown capacity AND no own evidence: never fill a deficit with it while a
  // verified candidate exists; keep it only as a last resort.
  const verified = funded.filter(c => hasKnownCapacity(capacity?.[c.adapterId]) || hasOwnEvidence(c));
  const lastResort = verified.length === 0 && funded.length > 0;
  const pool = verified.length ? verified : funded;
  // Targets cover only selectable providers, so an excluded one never shows a share it cannot get.
  const excluded = [...new Set(funded.filter(c => !pool.includes(c)).map(c => c.adapterId))];
  const selectable = new Set(pool.map(c => c.adapterId));
  const targets = {};
  for (const c of candidates) {
    const share = excluded.length ? (selectable.has(c.adapterId) ? 1 / selectable.size : 0) : shares.get(c.adapterId) ?? 0;
    targets[keyOf(c)] = share / perAdapter.get(c.adapterId);
  }

  const keys = new Set(candidates.map(keyOf));
  const counts = Object.fromEntries([...keys].map(k => [k, 0]));
  let total = 0;
  for (const run of ledger) {
    const k = `${run?.adapterId}/${run?.modelId}`;
    if (!keys.has(k) || !COUNTED_STATUSES.has(run.status)) continue;
    if (Number.isFinite(now) && Number.isFinite(run.at) && (run.at > now || now - run.at > windowMs)) continue;
    counts[k] += 1;
    total += 1;
  }
  const actuals = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, total ? n / total : 0]));
  const deficits = Object.fromEntries(Object.keys(targets).map(k => [k, targets[k] - actuals[k]]));

  let pick = null;
  let pickIndex = -1;
  pool.forEach(c => {
    const index = candidates.indexOf(c);
    if (!pick) { pick = c; pickIndex = index; return; }
    const d = deficits[keyOf(c)] - deficits[keyOf(pick)];
    // A deficit tie (for example an empty ledger) goes to the role's approved
    // model before utility or pool order; the deficit itself is never overridden.
    const favored = preferred && (keyOf(c) === keyOf(preferred)) !== (keyOf(pick) === keyOf(preferred));
    const better = Math.abs(d) > 1e-12 ? d > 0
      : favored ? keyOf(c) === keyOf(preferred)
      : (c.utility ?? 0) !== (pick.utility ?? 0) ? (c.utility ?? 0) > (pick.utility ?? 0)
        : index < pickIndex;
    if (better) { pick = c; pickIndex = index; }
  });

  const notes = [];
  const sharedUnknown = unknown.filter(id => !excluded.includes(id));
  if (sharedUnknown.length) notes.push(`${sharedUnknown.join(", ")} capacity: "unknown" (equal share)`);
  if (excluded.length) notes.push(`${excluded.join(", ")} excluded: unknown quota and no own evidence`);
  if (exhaustedAll) notes.push("all providers exhausted: picked least-used candidate (flagged exhausted)");
  if (lastResort) notes.push("last resort: no candidate with known capacity or own evidence (probe or measured success) exists");
  const explanation = `Role ${role ?? "unknown"}: picked ${keyOf(pick)} with deficit ${deficits[keyOf(pick)].toFixed(3)} `
    + `(target ${targets[keyOf(pick)].toFixed(3)}, actual ${actuals[keyOf(pick)].toFixed(3)}, ${total} runs in window).`
    + (notes.length ? ` ${notes.join("; ")}.` : "");
  return { pick, targets, actuals, deficits, explanation };
}
