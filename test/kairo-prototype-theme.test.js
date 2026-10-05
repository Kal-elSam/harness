import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  KAIRO_PROTOTYPE_BG,
  KAIRO_PROTOTYPE_FG,
  STRIP_BAND_BG,
  SELECTION_BG,
  SIDEBAR_BAND_BG,
  applyPrototypeSidebarSkin,
  applyPrototypeStripSkin,
  buildKairoPrototypeTheme,
  isPrototypeThemeEnabled,
  stripAnsi,
  visibleWidth,
} from "../src/global/host/extension/kairo-prototype-theme.js";

// Theme double with REAL SGR sequences (roles encoded as 256-color
// indexes) so the module's ANSI-aware width math is exercised exactly.
const FG_IDX = { accent: 10, muted: 11, text: 12, borderMuted: 13 };
const BG_IDX = { toolPendingBg: 20, selectedBg: 21, customMessageBg: 22 };
function fakeTheme() {
  return {
    fg: (role, text) => `\x1b[38;5;${FG_IDX[role] ?? 7}m${text}\x1b[39m`,
    bg: (role, text) => `\x1b[48;5;${BG_IDX[role] ?? 0}m${text}\x1b[49m`,
    bold: (text) => `\x1b[1m${text}\x1b[22m`,
    getColorMode: () => "truecolor",
  };
}
const bandCode = (role) => `\x1b[48;5;${BG_IDX[role]}m`;

function snapshotWithAgents() {
  return {
    project: { label: "agentic-harness" },
    agents: [
      { id: "a1", label: "Builder", state: "available", provider: "Cursor" },
      { id: "a2", label: "Researcher", state: "blocked", stateReason: "Unavailable — quota exhausted" },
    ],
  };
}

// Visible width ignoring the fake <...> markers above.
function visibleOf(line) {
  return line.replace(/<\/?(fg:[^>]+|bg:[^>]+|b)>/g, "").length;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("kairo prototype theme gate", () => {
  it("is enabled only with KAIRO_PROTOTYPE_THEME=1", () => {
    assert.equal(isPrototypeThemeEnabled({}), false);
    assert.equal(isPrototypeThemeEnabled({ KAIRO_PROTOTYPE_THEME: "0" }), false);
    assert.equal(isPrototypeThemeEnabled({ KAIRO_PROTOTYPE_THEME: "1" }), true);
  });
});

describe("kairo prototype palette", () => {
  it("covers every mandatory Theme fg/bg key (fork rejects gaps)", () => {
    const requiredFg = ["accent", "border", "borderAccent", "borderMuted", "success", "error", "warning",
      "muted", "dim", "text", "thinkingText", "userMessageText", "customMessageText", "customMessageLabel",
      "toolTitle", "toolOutput", "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
      "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet", "toolDiffAdded",
      "toolDiffRemoved", "toolDiffContext", "syntaxComment", "syntaxKeyword", "syntaxFunction",
      "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
      "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "bashMode"];
    const requiredBg = ["selectedBg", "searchMatchBg", "userMessageBg", "customMessageBg",
      "toolPendingBg", "toolSuccessBg", "toolErrorBg"];
    for (const key of requiredFg) assert.match(KAIRO_PROTOTYPE_FG[key] ?? "", /^#[0-9a-f]{6}$/, `fg ${key}`);
    for (const key of requiredBg) assert.match(KAIRO_PROTOTYPE_BG[key] ?? "", /^#[0-9a-f]{6}$/, `bg ${key}`);
  });

  it("reserves error/warning semantics from dark (never repurposed)", () => {
    assert.equal(KAIRO_PROTOTYPE_FG.error, "#cc6666");
    assert.equal(KAIRO_PROTOTYPE_FG.warning, "#ffff00");
    assert.equal(KAIRO_PROTOTYPE_BG.toolErrorBg, "#3c2828");
  });

  it("keeps text readable on all three bands (contrast >= 4.5)", () => {
    for (const band of [SIDEBAR_BAND_BG, SELECTION_BG, STRIP_BAND_BG]) {
      const bg = KAIRO_PROTOTYPE_BG[band];
      assert.ok(contrast(KAIRO_PROTOTYPE_FG.text, bg) >= 4.5, `text on ${band}: ${bg}`);
      assert.ok(contrast(KAIRO_PROTOTYPE_FG.muted, bg) >= 4.5, `muted on ${band}: ${bg}`);
    }
  });

  it("uses three distinct bands (attention / work / usage separate at a glance)", () => {
    const bands = new Set([KAIRO_PROTOTYPE_BG[SIDEBAR_BAND_BG], KAIRO_PROTOTYPE_BG[SELECTION_BG], KAIRO_PROTOTYPE_BG[STRIP_BAND_BG]]);
    assert.equal(bands.size, 3);
  });

  it("builds a real fork Theme instance (session-scoped, named)", () => {
    class FakeThemeClass {
      constructor(fg, bg, mode, options) {
        this.fgColors = fg;
        this.bgColors = bg;
        this.mode = mode;
        this.name = options?.name;
      }
    }
    const theme = buildKairoPrototypeTheme(FakeThemeClass, fakeTheme());
    assert.equal(theme.name, "kairo-prototype");
    assert.equal(theme.mode, "truecolor");
    assert.equal(theme.fgColors.accent, KAIRO_PROTOTYPE_FG.accent);
  });
});

describe("kairo prototype sidebar skin", () => {
  it("fills every row to 28 columns on the sidebar band", () => {
    const theme = fakeTheme();
    const lines = applyPrototypeSidebarSkin(["◈ agentic-harness", "AGENTS", "○ Builder"], snapshotWithAgents(), theme, {});
    assert.equal(lines.length, 3);
    for (const line of lines) {
      assert.equal(visibleWidth(line), 28);
      assert.ok(line.includes(bandCode(SIDEBAR_BAND_BG)), line);
    }
  });

  it("paints the selected agent rows with the selection band", () => {
    const theme = fakeTheme();
    // agentRowHitboxes sorts blocked-first: a2 (blocked) name row y=3,
    // status y=4; a1 (available) follows at y=5.
    const lines = applyPrototypeSidebarSkin(
      ["◈ agentic-harness", "sep", "AGENTS", " ○ Researcher", "  quota exhausted", "▎○ Builder", "  Cursor"],
      snapshotWithAgents(), theme, { selectedAgentId: "a2" }
    );
    assert.ok(lines[3].includes(bandCode(SELECTION_BG)), lines[3]);
    assert.ok(lines[4].includes(bandCode(SELECTION_BG)), lines[4]);
    assert.ok(lines[5].includes(bandCode(SIDEBAR_BAND_BG)), lines[5]);
  });

  it("leaves empty content empty (narrow terminals keep the chat width)", () => {
    assert.deepEqual(applyPrototypeSidebarSkin([], snapshotWithAgents(), fakeTheme(), {}), []);
  });

  it("pads the band to exactly the live row count, never more (over-tall clips the header)", () => {
    const theme = fakeTheme();
    const lines = applyPrototypeSidebarSkin(["◈ agentic-harness", "AGENTS"], snapshotWithAgents(), theme, { rows: 30 });
    assert.equal(lines.length, 30);
    assert.ok(lines[0].includes("agentic-harness"));
    for (const line of lines) {
      assert.equal(visibleWidth(line), 28);
      assert.ok(line.includes(bandCode(SIDEBAR_BAND_BG)), line);
    }
  });

  it("clips to the row count instead of overshooting", () => {
    const theme = fakeTheme();
    const many = Array.from({ length: 40 }, (_, i) => `row${i}`);
    const lines = applyPrototypeSidebarSkin(many, snapshotWithAgents(), theme, { rows: 30 });
    assert.equal(lines.length, 30);
  });

  it("strips real ANSI when measuring (bg wraps never widen rows)", () => {
    assert.equal(visibleWidth(`\x1b[38;5;10mhi\x1b[39m`), 2);
    assert.equal(stripAnsi("\x1b[1mAB\x1b[22m"), "AB");
  });
});

describe("kairo prototype strip skin", () => {
  it("fills the usage line to the live width on the strip band", () => {
    const lines = applyPrototypeStripSkin(["USAGE Codex 5h 88%"], fakeTheme(), { width: 100 });
    assert.equal(lines.length, 1);
    assert.equal(visibleWidth(lines[0]), 100);
    assert.ok(lines[0].includes(bandCode(STRIP_BAND_BG)));
  });
});
