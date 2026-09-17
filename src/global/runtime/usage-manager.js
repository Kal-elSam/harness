import { classifyUsageTier, createProviderUsageRecord, isProviderExhausted } from "./usage-types.js";
import { readProviderUsage, writeProviderUsage } from "./usage-store.js";

/**
 * Records one real run's own usage onto a provider's real, cumulative
 * total — called exactly once per real run, at the moment it reaches a
 * terminal state (run-supervisor.js), never on intermediate streamed
 * usage events (which would double-count as they arrive). A run with no
 * real usage data at all (tokens null — the adapter never reported any,
 * or the process never really started) records nothing: there is no
 * real consumption to attribute, and bumping runCount for it would be
 * noise, not evidence.
 * @param {string} homeDir
 * @param {string} provider - a real execution-adapters/index.js id
 * @param {{input?: number|null, output?: number|null, total?: number|null, cost?: number|null}} usage
 */
export async function recordProviderUsage(homeDir, provider, usage = {}) {
  const total = Number.isFinite(usage.total) ? usage.total : null;
  if (total == null) return null;

  const current = (await readProviderUsage(homeDir, provider)) ?? createProviderUsageRecord(provider);
  const input = Number.isFinite(usage.input) ? usage.input : 0;
  const output = Number.isFinite(usage.output) ? usage.output : 0;
  const cost = Number.isFinite(usage.cost) ? usage.cost : 0;

  const next = {
    ...current,
    totalInputTokens: current.totalInputTokens + input,
    totalOutputTokens: current.totalOutputTokens + output,
    totalTokens: current.totalTokens + total,
    totalCost: current.totalCost + cost,
    runCount: current.runCount + 1,
    updatedAt: new Date().toISOString()
  };

  await writeProviderUsage(homeDir, provider, next);
  return next;
}

function resolveProviderBudget(profile, provider) {
  const perProvider = profile?.providerTokenBudgets;
  if (perProvider && typeof perProvider === "object" && Number.isFinite(perProvider[provider])) {
    return perProvider[provider];
  }
  return null;
}

/**
 * The real, current classification for one provider — real cumulative
 * consumption (readProviderUsage) against the real configured budget for
 * that provider (profile.providerTokenBudgets), never a single run's own
 * usage. No configured budget for this provider means no real consumption
 * record is even required to answer HEALTHY.
 * @param {object} args
 * @param {string} args.homeDir
 * @param {string} args.provider
 * @param {object} [args.profile] - a resolved profile object (profile.js's own `profile` field)
 */
export async function getProviderUsageState({ homeDir, provider, profile = null }) {
  const budgetTokens = resolveProviderBudget(profile, provider);
  const record = (await readProviderUsage(homeDir, provider)) ?? createProviderUsageRecord(provider);
  const tier = classifyUsageTier(record.totalTokens, budgetTokens);

  return {
    provider,
    budgetTokens,
    consumedTokens: record.totalTokens,
    consumedCost: record.totalCost,
    runCount: record.runCount,
    tier
  };
}

/**
 * The real, single enforcement point this increment adds — called from
 * run-manager.js's prepareRun, right after adapter.preflight and before a
 * new run is ever created. Refuses only a provider whose real cumulative
 * consumption has reached its own configured budget; every other tier
 * (HEALTHY through CRITICAL) is informational only in this increment —
 * there is no automatic model-chaining yet for a softer tier to throttle.
 * @param {object} args
 * @param {string} args.homeDir
 * @param {string} args.provider
 * @param {object} [args.profile]
 */
export async function assertProviderNotExhausted({ homeDir, provider, profile = null }) {
  const state = await getProviderUsageState({ homeDir, provider, profile });
  if (isProviderExhausted(state.tier)) {
    throw new Error(
      `Provider "${provider}" has exhausted its configured token budget `
      + `(${state.consumedTokens}/${state.budgetTokens} tokens). Raise providerTokenBudgets.${provider} `
      + "in the profile, or wait for the budget to be reset, before starting a new run."
    );
  }
  return state;
}
