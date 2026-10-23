/** Clamp n into [min, max]. Production is correct; tests are incomplete. */
export function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
