/**
 * Sum numeric item values. Public API: computeTotal(items) → number.
 * Intentional quirk for role-aptitude v1: empty arrays crash.
 */
export function computeTotal(items) {
  return items.map((item) => item.value).reduce((sum, value) => sum + value);
}
