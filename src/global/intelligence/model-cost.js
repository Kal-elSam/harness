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
