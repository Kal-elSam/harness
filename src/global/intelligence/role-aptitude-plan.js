import { withQuotaCosts } from "./model-cost.js";
import { nearEquivalenceBandFor, TEAM_PROVIDERS } from "./role-demand.js";
import { measuredRoleCosts } from "./role-telemetry.js";

// Conservative fixture-run allowance including context/tool turns, not a spending grant.
export const DEFAULT_APTITUDE_TOKENS_PER_CALL = 200_000;
const keyOf = model => `${model.adapterId}::${model.modelId}`;
const nonnegative = value => typeof value === "number" && Number.isFinite(value) && value >= 0;

function estimateModel(model, calls, measured) {
  const hasMeasured = nonnegative(measured?.medianTokens);
  const tokens = calls * (hasMeasured ? measured.medianTokens : DEFAULT_APTITUDE_TOKENS_PER_CALL);
  // S47 currently retains total tokens, not the input/output split. Never infer
  // a split from independent medians of cost and tokens.
  const input = measured?.medianInputTokens;
  const output = measured?.medianOutputTokens;
  const hasSplit = hasMeasured && nonnegative(input) && nonnegative(output) && input + output > 0;
  const inputFraction = hasSplit ? input / (input + output) : 0;
  const outputPrice = model.priceOutputPerMTok;
  const inputPrice = model.priceInputPerMTok;
  const rate = nonnegative(outputPrice) && (!hasSplit || nonnegative(inputPrice))
    ? (hasSplit ? inputFraction * inputPrice + (1 - inputFraction) * outputPrice : outputPrice)
    : null;
  return {
    calls, tokens, usd: rate == null ? null : tokens * rate / 1e6,
    tokenSource: hasMeasured ? "measured" : "default",
    priceAssumption: hasSplit ? "measured input/output token ratio; AA prices per MTok"
      : "unknown input/output ratio: all tokens at AA output price (upper bound assuming output price >= input price)"
  };
}

/** Pure dry-run plan. Totals include conditional stage 2, never an authorization. */
export function buildAptitudePlan({ probes = [], candidates = [], teamProviders = TEAM_PROVIDERS, providerCapacity = {}, roleTelemetry = null, capabilityByRole = {} } = {}) {
  const eligible = candidates.filter(model => teamProviders.includes(model.adapterId));
  const byRole = new Map();
  for (const probe of probes) {
    if (!byRole.has(probe.role)) byRole.set(probe.role, new Set());
    byRole.get(probe.role).add(probe.probeId);
  }
  const totals = { calls: 0, tokens: 0, usd: 0 };
  const roles = [...byRole].map(([role, ids]) => {
    const unique = [...new Map(eligible.map(model => [keyOf(model), model])).values()];
    const ordered = withQuotaCosts(unique.map(model => ({ model })), providerCapacity,
      undefined, measuredRoleCosts(roleTelemetry, role))
      .sort((a, b) => a.quotaCostWeight - b.quotaCostWeight || keyOf(a.model).localeCompare(keyOf(b.model)))
      .map(entry => entry.model);
    const seenProviders = new Set();
    const stage1 = ordered.filter(model => {
      if (seenProviders.has(model.adapterId)) return false;
      seenProviders.add(model.adapterId);
      return true;
    });
    const capability = model => capabilityByRole[role]?.get(keyOf(model));
    const known = model => nonnegative(capability(model));
    const firstScores = stage1.filter(known).map(capability);
    const bestFirst = firstScores.length ? Math.max(...firstScores) : null;
    const strongest = ordered.filter(known).reduce((best, model) =>
      !best || capability(model) > capability(best) ? model : best, null);
    const stage1Keys = new Set(stage1.map(keyOf));
    const stage2 = ordered.filter(model => !stage1Keys.has(keyOf(model))).flatMap(model => {
      const value = capability(model);
      if (known(model) && bestFirst != null && Math.abs(value - bestFirst) / (Math.abs(bestFirst) || 1) <= nearEquivalenceBandFor(role)) {
        return [{ model, reason: "within-near-equivalence-band" }];
      }
      return model === strongest ? [{ model, reason: "fallback-if-stage1-fails" }] : [];
    });
    const estimate = Object.fromEntries([...stage1, ...stage2.map(entry => entry.model)].map(model => {
      const value = estimateModel(model, ids.size, roleTelemetry?.roles?.[role]?.get(keyOf(model)));
      totals.calls += value.calls;
      totals.tokens += value.tokens;
      totals.usd = totals.usd == null || value.usd == null ? null : totals.usd + value.usd;
      return [keyOf(model), value];
    }));
    return { role, probes: [...ids], candidates: ordered, stage1, stage2, estimate };
  });
  const headroom = Object.entries(providerCapacity ?? {}).flatMap(([provider, capacity]) => {
    const remaining = capacity?.quotaRemainingPercent;
    const pace = capacity?.quotaPaceFactor ?? 1;
    return nonnegative(remaining) && remaining <= 100 && nonnegative(pace) && pace <= 4
      ? [{ provider, value: remaining * pace }] : [];
  }).sort((a, b) => b.value - a.value || a.provider.localeCompare(b.provider));
  return {
    readOnly: true, roles, totals, headroomProvider: headroom[0]?.provider ?? null,
    defaults: { tokensPerCall: DEFAULT_APTITUDE_TOKENS_PER_CALL },
    stage2Policy: "Stage 2 runs only after stage 1 deterministic validator results and only with a new authorization; fallback runs only if no stage-1 model passes.",
    totalsAssumption: "Upper planning envelope including conditional stage 2; not committed spend. USD uses Artificial Analysis prices, null when unavailable."
  };
}
