import test from "node:test";
import assert from "node:assert/strict";
import { SelectList } from "@earendil-works/pi-tui";
import { PALETTE, theme, editorTheme } from "../src/global/cockpit/theme.js";

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

test("REGRESSION: 'selection' (the picker's highlighted-row background) is visibly distinct from a plain black terminal background — the old [35,42,64] measured ~1.48:1, why a real screenshot of the analyst/model picker showed the selected row as indistinguishable from the unselected background", () => {
  const ratio = contrastRatio(PALETTE.selection, BLACK);
  assert.ok(ratio >= 2, `selection's real contrast against black is ${ratio.toFixed(2)}:1, below the 2:1 floor for a visibly distinct background`);
});

test("'text' on top of the real 'selection' background still meets the 4.5:1 floor — a more visible selection bar must never come at the cost of illegible selected-row text", () => {
  const ratio = contrastRatio(PALETTE.text, PALETTE.selection);
  assert.ok(ratio >= 4.5, `text-on-selection real contrast is ${ratio.toFixed(2)}:1, below the 4.5:1 floor`);
});

test("theme.bgFg combines bold+fg+bg in a single escape with one trailing reset — never a nested inner reset that would cut the outer styling short", () => {
  const styled = theme.bgFg("selection", "text", "hello");
  const resetCount = (styled.match(/\x1b\[0m/g) ?? []).length;
  assert.equal(resetCount, 1, "exactly one reset — a naive bold(bg(text)) composition would produce two, with the inner one cutting the background short");
  assert.match(styled, /\x1b\[1m/, "must include bold");
  assert.match(styled, /\x1b\[38;2;/, "must include an explicit foreground color");
  assert.match(styled, /\x1b\[48;2;/, "must include an explicit background color");
});

test("REGRESSION: theme.bgFg strips ANSI ALREADY embedded in the incoming text (a real pre-colored SelectList label) before re-wrapping — a plain-text-only test of bgFg missed this real bug", () => {
  // Exactly what project-overlay.js actually hands selectedText: a label
  // pre-wrapped in theme.fg("text", ...) for legibility on unselected
  // rows (see the earlier round's own fix), which embeds its own reset.
  const preStyledLabel = theme.fg("text", "Claude Fable 5.1    claude");
  const styled = theme.bgFg("selection", "text", preStyledLabel);
  const resetCount = (styled.match(/\x1b\[0m/g) ?? []).length;
  assert.equal(resetCount, 1, "a pre-styled label's own inner reset must be stripped, never left to cut the outer background short");
  assert.doesNotMatch(styled, /\x1b\[0m.*\x1b\[0m/s, "only one reset in the whole string");
});

test("REGRESSION: a real SelectList's selected row renders ONE continuous background — the description ('Quality fit') is never left unhighlighted by a premature inner reset", () => {
  // The exact real shape project-overlay.js builds: label pre-colored
  // with theme.fg("text", ...) (item 2 of the contrast fix), description
  // left plain (SelectList applies editorTheme.selectList.description to
  // it separately for UNSELECTED rows only — for the selected row, the
  // whole concatenated string, including the raw description, goes
  // through selectedText as one piece).
  const items = [
    { value: "a", label: theme.fg("text", "Claude Fable 5.1    claude"), description: "Quality fit" },
    { value: "b", label: theme.fg("text", "Claude Opus 5    claude"), description: "" }
  ];
  const list = new SelectList(items, 8, editorTheme.selectList);
  const lines = list.render(76);
  const selectedLine = lines.find((line) => line.includes("Quality fit"));
  assert.ok(selectedLine, "the selected row's real rendered line must contain its own description");
  const resetCount = (selectedLine.match(/\x1b\[0m/g) ?? []).length;
  assert.equal(resetCount, 1, "the real rendered selected row must carry exactly one reset — a second, premature one means the background was cut short before the description");
  const firstBg = selectedLine.indexOf("\x1b[48;2;");
  const firstReset = selectedLine.indexOf("\x1b[0m");
  const qualityFitIndex = selectedLine.indexOf("Quality fit");
  assert.ok(firstBg >= 0 && firstBg < qualityFitIndex, "the background escape must open before the description text");
  assert.ok(firstReset > qualityFitIndex, "the single reset must come AFTER the description — the background must still be active when 'Quality fit' renders, not already cut off");
});
