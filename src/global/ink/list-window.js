/**
 * Truncate a list for a fixed viewport with an overflow indicator.
 *
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {{ moreLabel?: string }} [options]
 * @returns {{ items: T[], hiddenCount: number, hasMore: boolean, moreLine: string | null }}
 */
export function windowList(items = [], limit = 8, { moreLabel = "… more" } = {}) {
  const safeLimit = Math.max(0, Number(limit) || 0);
  if (safeLimit === 0) {
    return {
      items: [],
      hiddenCount: items.length,
      hasMore: items.length > 0,
      moreLine: items.length > 0 ? `${moreLabel} (${items.length})` : null
    };
  }

  if (items.length <= safeLimit) {
    return {
      items: [...items],
      hiddenCount: 0,
      hasMore: false,
      moreLine: null
    };
  }

  const visible = items.slice(0, safeLimit);
  const hiddenCount = items.length - safeLimit;
  return {
    items: visible,
    hiddenCount,
    hasMore: true,
    moreLine: `${moreLabel} (${hiddenCount})`
  };
}
