/**
 * Selection-only AA input + output USD per million tokens, adjusted by quota.
 * This is a comparison weight, not predicted task spend. Catalog rates and
 * observed USD/task are not substitutes for AA prices; missing AA stays unknown.
 */
export function resolveModelCost(model, providerCapacity = null) {
  const valid = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const input = model.priceInputPerMTok;
  const output = model.priceOutputPerMTok;
  const baseCost = valid(input) && valid(output) ? input + output : null;
  const source = baseCost == null ? "unknown" : "aa-price";
  const remaining = providerCapacity?.[model.adapterId]?.quotaRemainingPercent;
  const quotaRemainingPercent = valid(remaining) && remaining <= 100 ? remaining : null;
  const pace = providerCapacity?.[model.adapterId]?.quotaPaceFactor;
  const quotaPaceFactor = valid(pace) && pace <= 4 ? pace : null;
  // Missing quota is neutral; zero remaining quota is never cheap, even at $0.
  const weight = baseCost == null || (quotaRemainingPercent === 0 || quotaPaceFactor === 0)
    ? Infinity
    : baseCost / (quotaPaceFactor ?? (quotaRemainingPercent == null ? 1 : quotaRemainingPercent / 100));
  return { baseCost, weight, source, quotaRemainingPercent, quotaPaceFactor };
}

/** Known readable headroom must also be healthy when a timed pace exists. */
export function hasKnownHealthyQuota(capacity) {
  const remaining = capacity?.quotaRemainingPercent;
  const pace = capacity?.quotaPaceFactor;
  return typeof remaining === "number" && Number.isFinite(remaining) && remaining > 0 && remaining <= 100
    && (pace == null || (Number.isFinite(pace) && pace >= .5 && pace <= 4));
}

/** Add internal numeric weights without mutating models or serialized snapshots. */
export function withQuotaCosts(entries, providerCapacity, resolvePrice = (model, key) => model[key]) {
  return entries.map(entry => {
    const model = {
      ...entry.model,
      priceInputPerMTok: resolvePrice(entry.model, "priceInputPerMTok"),
      priceOutputPerMTok: resolvePrice(entry.model, "priceOutputPerMTok")
    };
    const cost = resolveModelCost(model, providerCapacity);
    return { ...entry, quotaCostWeight: cost.weight, knownHealthyQuota: hasKnownHealthyQuota(providerCapacity?.[model.adapterId]), quotaExhausted: cost.quotaRemainingPercent === 0 || cost.quotaPaceFactor === 0 };
  });
}

/** Cost is primary; callers retain their existing order for genuine ties. */
export function lowestCostCandidates(entries) {
  const usable = entries.filter(entry => !entry.quotaExhausted);
  const available = usable.length ? usable : entries;
  const known = available.filter(entry => entry.knownHealthyQuota);
  const pool = known.length ? known : available;
  const minimum = Math.min(...pool.map(entry => entry.quotaCostWeight));
  return pool.filter(entry => entry.quotaCostWeight === minimum);
}

export const TRADEOFF_TIE_BAND = .002;
export const CAPABILITY_REFERENCE_SPAN = .10;
/**
 * Role-weighted choice (S19): same availability filters as lowestCostCandidates
 * (exhausted quota out, known-healthy quota first), then max utility =
 * scaledCapability * capabilityWeight - cost/scale * costWeight. Scale is the pool's
 * largest pre-balance finite cost, so a provider-balance surcharge stays a
 * penalty larger than the whole price range. Unknown cost ranks last; entries
 * within TRADEOFF_TIE_BAND of the best are ties and keep the caller's order.
 */
export function bestTradeoffCandidates(entries, { capability: capabilityWeight, cost: costWeight }) {
  const usable = entries.filter(entry => !entry.quotaExhausted);
  const available = usable.length ? usable : entries;
  const known = available.filter(entry => entry.knownHealthyQuota);
  const pool = known.length ? known : available;
  const finite = pool.map(entry => entry.quotaCostBase ?? entry.quotaCostWeight).filter(Number.isFinite);
  const scale = Math.max(0, ...finite) || 1;
  // Capability is put on the same 0..1 scale as cost: distance above the pool's
  // weakest candidate over the pool spread, with a floor on the span so a pool of
  // near-equals is not stretched into a full 0..1 difference. Raw gap values differ
  // by ~0.05 while normalized cost spans ~0.2-1, so unscaled they could never matter.
  const capabilityOf = entry => entry.ownedEvidence?.verdict === "pass" ? 1 : (entry.gapValue ?? 0);
  const capabilities = pool.map(capabilityOf);
  const weakest = Math.min(...capabilities);
  const span = Math.max(CAPABILITY_REFERENCE_SPAN, Math.max(...capabilities) - weakest);
  const utility = entry => {
    if (!Number.isFinite(entry.quotaCostWeight)) return -Infinity;
    return (capabilityOf(entry) - weakest) / span * capabilityWeight - entry.quotaCostWeight / scale * costWeight;
  };
  const scored = pool.map(entry => ({ entry, value: utility(entry) }));
  const best = Math.max(...scored.map(item => item.value));
  if (best === -Infinity) return pool;
  return scored.filter(item => item.value >= best - TRADEOFF_TIE_BAND).map(item => item.entry);
}
