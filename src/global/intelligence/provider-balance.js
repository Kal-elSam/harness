// Selection-only workload budget. Capacity already contains the bottleneck
// remaining share and reset pace from quota-pacing.js / buildProviderCapacity.
// Weight = remaining fraction * pace (neutral pace when reset is unknown).
// Unknown/exhausted providers receive no invented share; qualification and
// unknown-quota last-resort policy are resolved before this soft surcharge.
export function providerTargetShares(providerIds, providerCapacity) {
  const weights = [...new Set(providerIds)].map(id => {
    const capacity = providerCapacity?.[id];
    const remaining = capacity?.quotaRemainingPercent;
    const pace = capacity?.quotaPaceFactor ?? 1;
    const valid = Number.isFinite(remaining) && remaining > 0 && remaining <= 100
      && Number.isFinite(pace) && pace > 0 && pace <= 4;
    return [id, valid ? remaining / 100 * pace : 0];
  });
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  return new Map(weights.map(([id, weight]) => [id, total ? weight / total : 0]));
}

// Add a bounded, price-scaled surcharge for the projected excess role count:
// cost' = cost + maxKnownCost * (N + 1) * max(0, used + 1 - N * share).
// A full-role excess outweighs the entire known price range, including free
// models. It is never a ban; sole qualified candidates remain selectable.
export function balanceRoleCosts(entries, shares, usage, totalRoles) {
  const scale = Math.max(1, ...entries.map(entry => Number.isFinite(entry.quotaCostWeight) ? entry.quotaCostWeight : 0));
  return entries.map(entry => {
    const share = shares.get(entry.model.adapterId) ?? 0;
    const excess = share > 0 ? Math.max(0, (usage.get(entry.model.adapterId) ?? 0) + 1 - totalRoles * share) : 0;
    return { ...entry, quotaCostWeight: entry.quotaCostWeight + scale * (totalRoles + 1) * excess };
  });
}

export function providerBalanceReason(previous, chosen, shares, usage, totalRoles) {
  if (!previous || previous.model.adapterId === chosen.model.adapterId) return null;
  const id = previous.model.adapterId;
  const share = shares.get(id) ?? 0;
  if (!share) return null;
  return `Quota balancing: ${id} already holds ${usage.get(id) ?? 0}/${totalRoles} roles; another would exceed its ${Math.round(share * 100)}% quota share. Selected ${chosen.model.adapterId} instead.`;
}
