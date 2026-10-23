/**
 * Return the index of `needle` in `haystack`, or -1 if missing.
 * Intentional quirk for role-aptitude v1 probeVersion 2: the loop uses
 * `i <= haystack.length`, so when needle is `undefined` the past-the-end
 * slot (`haystack[length] === undefined`) is treated as a hit.
 */
export function indexOf(haystack, needle) {
  for (let i = 0; i <= haystack.length; i += 1) {
    if (haystack[i] === needle) return i;
  }
  return -1;
}
