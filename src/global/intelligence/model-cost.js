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
  // Missing quota is neutral; zero remaining quota is never cheap, even at $0.
  const weight = baseCost == null || quotaRemainingPercent === 0
    ? Infinity
    : baseCost / (quotaRemainingPercent == null ? 1 : quotaRemainingPercent / 100);
  return { baseCost, weight, source, quotaRemainingPercent };
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
    return { ...entry, quotaCostWeight: cost.weight };
  });
}

/** Cost is primary; callers retain their existing order for genuine ties. */
export function lowestCostCandidates(entries) {
  const minimum = Math.min(...entries.map(entry => entry.quotaCostWeight));
  return entries.filter(entry => entry.quotaCostWeight === minimum);
}
