export const USAGE_SCHEMA = "kairo.provider-usage/v1";

// HEALTHY: well under budget. MODERATE/CONSERVE: real, rising signal — no
// enforcement yet. CRITICAL: the last tier before the gate. EXHAUSTED: the
// real, enforced stop — assertProviderNotExhausted (usage-manager.js)
// refuses to start a new run for a provider in this tier.
export const USAGE_TIERS = Object.freeze({
  HEALTHY: "healthy",
  MODERATE: "moderate",
  CONSERVE: "conserve",
  CRITICAL: "critical",
  EXHAUSTED: "exhausted"
});

// Fractions of the configured budget. Ratios strictly below MODERATE stay
// HEALTHY; at/above 1.0 (100% of budget) is always EXHAUSTED, regardless
// of where CRITICAL is set.
export const USAGE_TIER_THRESHOLDS = Object.freeze({
  MODERATE: 0.5,
  CONSERVE: 0.75,
  CRITICAL: 0.9
});

/**
 * Classifies real, cumulative consumption against a real, configured
 * budget — never against a single run's own usage. No budget configured
 * (null) means no gate exists for this provider yet: always HEALTHY,
 * exactly mirroring how a null profile.tokenBudget already means "no
 * per-request gate" elsewhere in this codebase (see router.js).
 */
export function classifyUsageTier(consumedTokens, budgetTokens) {
  if (budgetTokens == null || !Number.isFinite(budgetTokens) || budgetTokens <= 0) {
    return USAGE_TIERS.HEALTHY;
  }
  const consumed = Number.isFinite(consumedTokens) ? Math.max(0, consumedTokens) : 0;
  const ratio = consumed / budgetTokens;

  if (ratio >= 1) return USAGE_TIERS.EXHAUSTED;
  if (ratio >= USAGE_TIER_THRESHOLDS.CRITICAL) return USAGE_TIERS.CRITICAL;
  if (ratio >= USAGE_TIER_THRESHOLDS.CONSERVE) return USAGE_TIERS.CONSERVE;
  if (ratio >= USAGE_TIER_THRESHOLDS.MODERATE) return USAGE_TIERS.MODERATE;
  return USAGE_TIERS.HEALTHY;
}

export function isProviderExhausted(tier) {
  return tier === USAGE_TIERS.EXHAUSTED;
}

export function createProviderUsageRecord(provider) {
  const now = new Date().toISOString();
  return {
    schema: USAGE_SCHEMA,
    provider,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    runCount: 0,
    createdAt: now,
    updatedAt: now
  };
}
