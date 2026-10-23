import { quotaPressure } from "./quota-pacing.js";

/**
 * Selection-only AA cost per task, falling back to input + output token price.
 * This is a comparison weight, not predicted task spend. Catalog rates and
 * observed USD/task are not substitutes for AA prices; missing AA stays unknown.
 */
export function resolveModelCost(model, providerCapacity = null, priceToTaskRatio = 1) {
  const valid = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const input = model.priceInputPerMTok;
  const output = model.priceOutputPerMTok;
  const taskCost = valid(model.costPerTask) ? model.costPerTask : null;
  const price = valid(input) && valid(output) ? (input + output) * (valid(priceToTaskRatio) && priceToTaskRatio > 0 ? priceToTaskRatio : 1) : null;
  const baseCost = taskCost ?? price;
  const source = taskCost != null ? "aa-cost-per-task" : baseCost == null ? "unknown" : "aa-price";
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

/** Median AA cost-per-task / price ratio that calibrates price-only models. */
function calibrateCosts(models) {
  const costs = models.map(model => resolveModelCost(model));
  const ratios = models.flatMap((model, i) => {
    const price = resolveModelCost({ ...model, costPerTask: null }).baseCost;
    return costs[i].source === "aa-cost-per-task" && costs[i].baseCost > 0 && price > 0
      ? [costs[i].baseCost / price] : [];
  }).sort((a, b) => a - b);
  const midpoint = Math.floor(ratios.length / 2);
  const ratio = ratios.length ? (ratios[midpoint] + ratios[Math.floor((ratios.length - 1) / 2)]) / 2 : 1;
  return { costs, ratios, ratio };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor(sorted.length / 2)] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
}

/**
 * S47 measured role cost: replace the AA task cost of models with a measured
 * median USD/run, and scale the rest by the median measured/AA ratio of models
 * that have both. With no overlap the measured data is ignored entirely.
 */
function applyMeasuredCosts(models, measured) {
  if (!(measured instanceof Map) || !measured.size) return { models, measuredKeys: new Set() };
  const keyOf = model => `${model.adapterId}::${model.modelId}`;
  const valid = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const { ratio } = calibrateCosts(models);
  const baselines = models.map(model => resolveModelCost(model, null, ratio).baseCost);
  const pairs = models.flatMap((model, i) => valid(measured.get(keyOf(model))) && measured.get(keyOf(model)) > 0 && baselines[i] > 0
    ? [measured.get(keyOf(model)) / baselines[i]] : []);
  if (!pairs.length) return { models, measuredKeys: new Set() };
  const scale = median(pairs);
  const measuredKeys = new Set();
  const adjusted = models.map((model, i) => {
    const value = measured.get(keyOf(model));
    if (valid(value)) {
      measuredKeys.add(keyOf(model));
      return { ...model, costPerTask: value };
    }
    return baselines[i] == null ? model : { ...model, costPerTask: baselines[i] * scale };
  });
  return { models: adjusted, measuredKeys };
}

/** Add internal numeric weights without mutating models or serialized snapshots. */
export function withQuotaCosts(entries, providerCapacity, resolvePrice = (model, key) => model[key], measured = null) {
  const priced = entries.map(entry => ({
    ...entry.model,
    costPerTask: resolvePrice(entry.model, "costPerTask"),
    priceInputPerMTok: resolvePrice(entry.model, "priceInputPerMTok"),
    priceOutputPerMTok: resolvePrice(entry.model, "priceOutputPerMTok")
  }));
  const { models, measuredKeys } = applyMeasuredCosts(priced, measured);
  const { costs, ratios, ratio } = calibrateCosts(models);
  const taskPresent = costs.some(cost => cost.source === "aa-cost-per-task");
  const unanchoredMixed = taskPresent && !ratios.length && costs.some(cost => cost.source === "aa-price");
  // An observed median USD/task / USD/MTok ratio calibrates price-only models.
  // With no paired positive observation, units cannot be converted honestly:
  // use within-source relative ranks (singleton = 1), not an invented ratio.
  // Entirely price-only pools retain their exact historical weights.
  return entries.map((entry, i) => {
    const cost = resolveModelCost(models[i], providerCapacity, ratio);
    if (unanchoredMixed && cost.baseCost != null && Number.isFinite(cost.weight)) {
      const values = [...new Set(costs.filter(c => c.source === cost.source).map(c => c.baseCost))].sort((a, b) => a - b);
      const rank = cost.baseCost === 0 ? 0 : (values.indexOf(cost.baseCost) + 1) / values.length;
      const factor = cost.quotaPaceFactor ?? (cost.quotaRemainingPercent == null ? 1 : cost.quotaRemainingPercent / 100);
      cost.weight = rank / factor;
    }
    const isMeasured = measuredKeys.has(`${entry.model.adapterId}::${entry.model.modelId}`);
    return { ...entry, quotaPolicy: quotaPressure(providerCapacity?.[entry.model.adapterId]), quotaCostWeight: cost.weight,
      costSource: isMeasured ? "measured-role-cost" : cost.source, costScale: unanchoredMixed ? "relative-rank" : taskPresent ? "task-equivalent" : "price",
      knownHealthyQuota: hasKnownHealthyQuota(providerCapacity?.[entry.model.adapterId]),
      quotaExhausted: cost.quotaRemainingPercent === 0 || cost.quotaPaceFactor === 0 };
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
    const weights = entry.tradeoffWeights ?? { capability: capabilityWeight, cost: costWeight };
    return (capabilityOf(entry) - weakest) / span * weights.capability - entry.quotaCostWeight / scale * weights.cost;
  };
  const scored = pool.map(entry => ({ entry, value: utility(entry) }));
  const best = Math.max(...scored.map(item => item.value));
  if (best === -Infinity) return pool;
  return scored.filter(item => item.value >= best - TRADEOFF_TIE_BAND).map(item => item.entry);
}
