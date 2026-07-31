/**
 * Static ASCII wordmark for Kairo Overview — no figlet dependency.
 * Hero art appears only on Overview (wide / compact); minimal stays textual.
 */

import { LAYOUT_MODES } from "../layout.js";

const WORDMARK_WIDE = [
  "╦╔═╔═╗╦╦═╗╔═╗",
  "╠╩╗╠═╣║╠╦╝║ ║",
  "╩ ╩╩ ╩╩╩╚═╚═╝"
];

const WORDMARK_COMPACT = [
  "╦╔═╔═╗╦╦═╗╔═╗",
  "╩ ╩╩ ╩╩╩╚═╚═╝"
];

const WORDMARK_WIDE_ASCII = [
  "K A I R O",
  "========="
];

const WORDMARK_COMPACT_ASCII = [
  "KAIRO"
];

export function shouldShowWordmark(layoutMode) {
  return layoutMode === LAYOUT_MODES.WIDE || layoutMode === LAYOUT_MODES.COMPACT;
}

/**
 * @param {"wide"|"compact"|"minimal"|string} layoutMode
 * @param {{ unicode?: boolean }} [opts]
 * @returns {string[]}
 */
export function wordmarkLines(layoutMode, { unicode = true } = {}) {
  if (layoutMode === LAYOUT_MODES.WIDE) {
    return unicode ? WORDMARK_WIDE.slice() : WORDMARK_WIDE_ASCII.slice();
  }
  if (layoutMode === LAYOUT_MODES.COMPACT) {
    return unicode ? WORDMARK_COMPACT.slice() : WORDMARK_COMPACT_ASCII.slice();
  }
  return [];
}

export function overviewBrandTitle(layoutMode) {
  if (shouldShowWordmark(layoutMode)) return null;
  return "KAIRO · Overview";
}
