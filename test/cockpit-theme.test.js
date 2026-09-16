import test from "node:test";
import assert from "node:assert/strict";
import { PALETTE, theme } from "../src/global/cockpit/theme.js";

// Real WCAG 2.x relative-luminance contrast ratio — the same formula a
// real accessibility audit uses, not an approximation. Verifies the
// actual RGB values in use, never a guessed "looks fine" judgment.
function relativeLuminance([r, g, b]) {
  const channel = (c) => {
    const srgb = c / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(rgbA, rgbB) {
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

const BLACK = [0, 0, 0];

test("REGRESSION: real WCAG contrast for 'muted' against black meets the 4.5:1 floor for normal text — the old [92,97,112] measured ~3.40:1, why provider names/tags/hints read as illegible in a real screenshot", () => {
  const ratio = contrastRatio(PALETTE.muted, BLACK);
  assert.ok(ratio >= 4.5, `muted's real contrast is ${ratio.toFixed(2)}:1, below the 4.5:1 WCAG floor for normal text`);
});

test("every real palette color used as text meets at least the 4.5:1 real contrast floor against black", () => {
  for (const [role, rgb] of Object.entries(PALETTE)) {
    if (role === "border" || role === "selection") continue; // real structural/background colors, never used as text
    const ratio = contrastRatio(rgb, BLACK);
    assert.ok(ratio >= 4.5, `${role}'s real contrast is ${ratio.toFixed(2)}:1, below the 4.5:1 floor`);
  }
});

test("theme.bgFg combines bold+fg+bg in a single escape with one trailing reset — never a nested inner reset that would cut the outer styling short", () => {
  const styled = theme.bgFg("selection", "text", "hello");
  const resetCount = (styled.match(/\x1b\[0m/g) ?? []).length;
  assert.equal(resetCount, 1, "exactly one reset — a naive bold(bg(text)) composition would produce two, with the inner one cutting the background short");
  assert.match(styled, /\x1b\[1m/, "must include bold");
  assert.match(styled, /\x1b\[38;2;/, "must include an explicit foreground color");
  assert.match(styled, /\x1b\[48;2;/, "must include an explicit background color");
});
