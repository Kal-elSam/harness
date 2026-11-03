// Reasoning effort per delegation (S16): the cheapest level that still meets the role's need.
// Role class (catalog tier) sets the base, high-risk demand raises it, tight quota lowers it
// before any model downgrade. Only levels the chosen provider can execute are ever returned.

/** Levels each executable provider accepts, cheapest first. Providers absent here get no effort. */
export const PROVIDER_EFFORT_LEVELS = Object.freeze({
  codex: Object.freeze(['low', 'medium', 'high']),
  claude: Object.freeze(['low', 'medium', 'high'])
});

const BASE_BY_TIER = Object.freeze({ light: 'low', standard: 'medium', demanding: 'high' });
/** Remaining-quota percent at or below which effort drops one level. */
export const TIGHT_QUOTA_PERCENT = 25;

/**
 * @param {{role: string, tier?: string, provider?: string, quotaRemainingPercent?: number, risk?: string}} input
 * @returns {{effort: string, reason: string}|null} null when the provider or role class is unknown.
 */
export function chooseEffort({ role, tier, provider, quotaRemainingPercent, risk } = {}) {
  const levels = PROVIDER_EFFORT_LEVELS[provider];
  const base = BASE_BY_TIER[tier];
  if (!levels || !base) return null;
  let index = levels.indexOf(base);
  const notes = [`${tier} role`];
  if (risk === 'high') { index += 1; notes.push('high-risk demand raises it'); }
  if (Number.isFinite(quotaRemainingPercent) && quotaRemainingPercent <= TIGHT_QUOTA_PERCENT) {
    index -= 1; notes.push(`${provider} quota ${quotaRemainingPercent}% left lowers it`);
  }
  const effort = levels[Math.max(0, Math.min(levels.length - 1, index))];
  return { effort, reason: `${role} effort ${effort}: ${notes.join(', ')}.` };
}
