import { providerTargetShares } from "./provider-balance.js";

// Per-task model distribution (decision A): spread work across every
// qualified, executable model in proportion to provider quota headroom.
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

// Adapter-level shares. Known adapters use the shared headroom notion
// (remaining fraction x pace). Unknown adapters get the median positive known
// share, never invented headroom, and are reported as unknown.
function adapterShares(adapterIds, capacity) {
  const known = adapterIds.filter(id => hasKnownCapacity(capacity?.[id]));
  const unknown = adapterIds.filter(id => !known.includes(id));
  const knownShares = providerTargetShares(known, capacity);
  const positive = [...knownShares.values()].filter(v => v > 0);
  const unknownWeight = positive.length ? median(positive) : (known.length ? 0 : 1);
  const weights = new Map([...knownShares, ...unknown.map(id => [id, unknownWeight])]);
  const total = [...weights.values()].reduce((sum, w) => sum + w, 0);
  const shares = new Map(adapterIds.map(id => [id, total ? weights.get(id) / total : 0]));
  return { shares, unknown };
}

export function selectDistributedModel({ role, candidates = [], capacity = {}, ledger = [], now, windowMs = DEFAULT_WINDOW_MS } = {}) {
  if (!candidates.length) {
    return { pick: null, targets: {}, actuals: {}, deficits: {}, explanation: `No qualified candidates for role ${role ?? "unknown"}.` };
  }
  const adapterIds = [...new Set(candidates.map(c => c.adapterId))];
  const { shares, unknown } = adapterShares(adapterIds, capacity);
  const exhaustedAll = [...shares.values()].every(s => s === 0);
  const perAdapter = new Map(adapterIds.map(id => [id, candidates.filter(c => c.adapterId === id).length]));

  const targets = {};
  for (const c of candidates) targets[keyOf(c)] = (shares.get(c.adapterId) ?? 0) / perAdapter.get(c.adapterId);

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

  const funded = exhaustedAll ? candidates : candidates.filter(c => (shares.get(c.adapterId) ?? 0) > 0);
  // Unknown capacity AND no own evidence: never fill a deficit with it while a
  // verified candidate exists; keep it only as a last resort.
  const verified = funded.filter(c => hasKnownCapacity(capacity?.[c.adapterId]) || hasOwnEvidence(c));
  const lastResort = verified.length === 0 && funded.length > 0;
  const pool = verified.length ? verified : funded;
  let pick = null;
  let pickIndex = -1;
  pool.forEach(c => {
    const index = candidates.indexOf(c);
    if (!pick) { pick = c; pickIndex = index; return; }
    const d = deficits[keyOf(c)] - deficits[keyOf(pick)];
    const better = Math.abs(d) > 1e-12 ? d > 0
      : (c.utility ?? 0) !== (pick.utility ?? 0) ? (c.utility ?? 0) > (pick.utility ?? 0)
        : index < pickIndex;
    if (better) { pick = c; pickIndex = index; }
  });

  const notes = [];
  if (unknown.length) notes.push(`${unknown.join(", ")} capacity: "unknown" (median known share used)`);
  if (exhaustedAll) notes.push("all providers exhausted: picked least-used candidate (flagged exhausted)");
  if (lastResort) notes.push("last resort: no candidate with known capacity or own evidence (probe or measured success) exists");
  const explanation = `Role ${role ?? "unknown"}: picked ${keyOf(pick)} with deficit ${deficits[keyOf(pick)].toFixed(3)} `
    + `(target ${targets[keyOf(pick)].toFixed(3)}, actual ${actuals[keyOf(pick)].toFixed(3)}, ${total} runs in window).`
    + (notes.length ? ` ${notes.join("; ")}.` : "");
  return { pick, targets, actuals, deficits, explanation };
}
