import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { availabilityNotices, computeSideBySideWidths, renderKairoWorkspaceWidget } from "../src/global/host/workspace-widget.js";

const IDENTITY_THEME = { fg: (_role, text) => text, bold: (text) => text };

function markerTheme() {
  return { fg: (role, text) => `<${role}>${text}</${role}>`, bold: (text) => `<b>${text}</b>` };
}

const SEVEN_ROLES = [
  { role: "Project Analyst", model: "GPT-6-Astra", via: "codex", accessMode: "automatic", availability: { state: "available", warning: null } },
  { role: "Orchestrator", model: "Kimi K3", via: "opencode-go", accessMode: "automatic", availability: { state: "available", warning: null } },
  { role: "Builder", model: "GPT-6 Terra", via: "codex", accessMode: "automatic", availability: { state: "available", warning: null } },
  { role: "Reviewer", model: "GPT-5.6-Terra", via: "codex", accessMode: "automatic", availability: { state: "available", warning: null } },
  { role: "Tester", model: "Claude Haiku", via: "claude", accessMode: "automatic", availability: { state: "available", warning: null } },
  { role: "Researcher", model: "MiniMax-M3", via: "opencode-go", accessMode: "automatic", availability: { state: "blocked", warning: "Unavailable — Cursor Models quota exhausted" } },
  { role: "Documenter", model: "Gemini Flash", via: "opencode-go", accessMode: "automatic", availability: { state: "checking", warning: null } }
];

function fixtureSnapshot(overrides = {}) {
  return {
    project: { label: "agentic-harness" },
    session: { state: "bound", id: "11111111-2222", title: "Ship widget", mode: "agent" },
    team: { state: "active", assignments: [], rows: SEVEN_ROLES },
    subscriptions: {
      state: "ready",
      segments: ["Codex 5h 58% / W 86%", "Claude S 34% / W 65%", "Go 100% / 100% / 96%"],
      usageModel: [
        { name: "Codex", windows: [{ label: "5h", remainingPercent: 80, level: "normal" }, { label: "W", remainingPercent: 83, level: "normal" }], fallbackStatus: "usage unknown" },
        { name: "Claude", windows: [{ label: "S", remainingPercent: 57, level: "low" }], fallbackStatus: "usage unknown" },
        { name: "Go", windows: [{ label: null, remainingPercent: 100, level: "normal" }, { label: null, remainingPercent: 60, level: "normal" }, { label: null, remainingPercent: 26, level: "limited" }], fallbackStatus: "usage unknown" }
      ]
    },
    ...overrides
  };
}

for (const width of [60, 100, 160]) {
  test(`renderKairoWorkspaceWidget at width ${width}: no line exceeds the given width, all 7 roles present`, () => {
    const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), width, IDENTITY_THEME);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: "${line}" (${visibleWidth(line)})`);
    }
    const joined = lines.join("\n");
    for (const row of SEVEN_ROLES) {
      assert.ok(joined.includes(row.role), `missing role "${row.role}" at width ${width}`);
    }
  });
}

test("renderKairoWorkspaceWidget stacks USAGE above TEAM when the width is narrow, and places them side by side otherwise", () => {
  const narrow = renderKairoWorkspaceWidget(fixtureSnapshot(), 60, IDENTITY_THEME);
  const usageIndex = narrow.findIndex((line) => line.includes("USAGE"));
  const teamIndex = narrow.findIndex((line) => line.includes("TEAM"));
  assert.ok(usageIndex >= 0 && teamIndex >= 0 && usageIndex < teamIndex, "USAGE panel should render fully before TEAM when stacked");

  const wide = renderKairoWorkspaceWidget(fixtureSnapshot(), 120, IDENTITY_THEME);
  const wideLineWithBoth = wide.find((line) => line.includes("USAGE") && line.includes("TEAM"));
  assert.ok(wideLineWithBoth, "USAGE and TEAM titles should share a line when side by side");
});

test("renderKairoWorkspaceWidget shows no per-row 'available' marker, but colors a blocked row with BLOCKED", () => {
  const theme = markerTheme();
  // A short-content fixture stacked (full width, not content-sized): a
  // content-sized panel (P01.2) allocates a row EXACTLY its own desired
  // width, and markerTheme wraps every themed segment in literal
  // "<role>...</role>" text — unlike a real ANSI theme, whose escape
  // codes are zero-width to visibleWidth — so a side-by-side panel sized
  // that tightly would truncate under this test double's own overhead.
  // Stacking (at a width too narrow for both panels to fit side by side)
  // gives the row the FULL given width instead, which is what's under
  // test here anyway (per-row marker/tone behavior, not width fitting).
  const shortSnapshot = fixtureSnapshot({
    team: {
      state: "active",
      rows: [
        { role: "A", model: "M", via: "codex", availability: { state: "available", warning: null } },
        { role: "B", model: "N", via: "codex", availability: { state: "blocked", warning: "Blocked." } }
      ]
    }
  });
  const lines = renderKairoWorkspaceWidget(shortSnapshot, 50, theme);
  const joined = lines.join("\n");
  assert.ok(!joined.includes("available"), "no row should print the word 'available'");
  assert.ok(joined.includes("BLOCKED"), "the blocked role should be marked BLOCKED");
  assert.ok(joined.includes("<error>") && joined.includes("BLOCKED"), "the blocked row should use the error tone");
});

// --- P01.2 T3: thin one-line bars, labeled windows, content-sized panels
// (real TTY review 2026-09-23: 10-cell solid bars merged into a blob, Go
// windows had no labels, half-width panels left most of the row empty).

test("renderKairoWorkspaceWidget renders thin one-line bars (━ remaining in the level color, ─ muted for used), never the old solid block bar", () => {
  const theme = markerTheme();
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), 160, theme);
  const joined = lines.join("\n");
  assert.ok(joined.includes("━"), "remaining is rendered with the thin heavy bar character");
  assert.ok(!joined.includes("█") && !joined.includes("░"), "the old solid block bar characters are gone");
  assert.match(joined, /<success>━+<\/success>/, "a normal-level window's remaining segment uses the success tone");
});

test("renderKairoWorkspaceWidget labels every usage window, including Go's roll/W/M", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot({
    subscriptions: {
      state: "ready",
      segments: [],
      usageModel: [
        { name: "Codex", windows: [{ label: "5h", remainingPercent: 58, level: "normal" }, { label: "W", remainingPercent: 86, level: "normal" }], fallbackStatus: "usage unknown" },
        { name: "Claude", windows: [{ label: "S", remainingPercent: 34, level: "low" }], fallbackStatus: "usage unknown" },
        {
          name: "Go",
          windows: [
            { label: "roll", remainingPercent: 100, level: "normal" },
            { label: "W", remainingPercent: 60, level: "normal" },
            { label: "M", remainingPercent: 26, level: "limited" }
          ],
          fallbackStatus: "usage unknown"
        }
      ]
    }
  }), 160, IDENTITY_THEME);
  const joined = lines.join("\n");
  for (const label of ["5h", "W", "S", "roll", "M"]) {
    assert.ok(joined.includes(label), `expected the "${label}" window label to be visible`);
  }
});

for (const width of [60, 100, 160]) {
  test(`renderKairoWorkspaceWidget at width ${width}: panels are sized to their own content, never stretched to half the terminal`, () => {
    const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), width, IDENTITY_THEME);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: "${line}"`);
    }
    // The whole point of content-sizing: at a wide-enough width, the
    // combined USAGE+TEAM line should NOT consume the entire given width
    // just because it's available — it should stop at what the content
    // (plus frame/gap) actually needs.
    if (width === 160) {
      const combined = lines.find((line) => line.includes("USAGE") && line.includes("TEAM"));
      assert.ok(combined, "expected a combined USAGE+TEAM line at width 160");
      assert.ok(
        visibleWidth(combined) < width,
        `combined USAGE+TEAM line should stop short of the full width at ${width}, got ${visibleWidth(combined)}`
      );
    }
  });
}

test("renderKairoWorkspaceWidget dims the TEAM title with 'checking…' while any row is still resolving live availability", () => {
  const theme = markerTheme();
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), 160, theme);
  assert.ok(lines.some((line) => line.includes("checking")), "TEAM title should show checking while a row is unresolved");
});

test("renderKairoWorkspaceWidget renders every team row even though a string-array widget would truncate past 10 lines", () => {
  // Stacked (narrow) layout renders both full panels one after another —
  // USAGE's frame + TEAM's frame for 7 real roles comfortably exceeds
  // Pi's MAX_WIDGET_LINES=10 string-array cap, and every line still needs
  // to reach the caller untruncated (see createKairoWorkspaceWidget's own
  // doc: this only holds for the component factory path, never a plain
  // string array).
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), 60, IDENTITY_THEME);
  assert.ok(lines.length > 10, "the component path must not be capped at MAX_WIDGET_LINES like a string array would be");
});

test("renderKairoWorkspaceWidget shows a dim 'usage checking'/'usage unknown' line instead of bars before live data or on failure", () => {
  const checkingLines = renderKairoWorkspaceWidget(fixtureSnapshot({ subscriptions: { state: "checking", segments: [], usageModel: [] } }), 160, IDENTITY_THEME);
  assert.ok(checkingLines.some((line) => line.includes("usage checking")));

  const unknownLines = renderKairoWorkspaceWidget(fixtureSnapshot({ subscriptions: { state: "unknown", segments: [], usageModel: [] } }), 160, IDENTITY_THEME);
  assert.ok(unknownLines.some((line) => line.includes("usage unknown")));
});

test("renderKairoWorkspaceWidget renders a cached usage value dim with its age, instead of checking, while the live usage probe is still pending", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot({
    subscriptions: {
      state: "cached",
      cacheAgeMs: 300_000,
      segments: [],
      usageModel: [
        { name: "Codex", windows: [{ label: "5h", remainingPercent: 58, level: "normal" }], fallbackStatus: "usage unknown" }
      ]
    }
  }), 160, IDENTITY_THEME);
  const joined = lines.join("\n");
  assert.ok(joined.includes("58%"), "the cached value itself still renders");
  assert.ok(joined.includes("5m ago"), "the cache age is shown");
  assert.ok(!joined.includes("usage checking"), "cached data is never shown as plain checking");
});

test("renderKairoWorkspaceWidget renders a cached team value dim with its age in the TEAM title, instead of checking", () => {
  const cachedTeam = { state: "active", rows: [SEVEN_ROLES[0]], cached: true, cacheAgeMs: 120_000 };
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot({ team: cachedTeam }), 160, IDENTITY_THEME);
  const joined = lines.join("\n");
  assert.ok(joined.includes("2m ago"), "the team cache age is shown");
  assert.ok(joined.includes(SEVEN_ROLES[0].role), "the cached row itself still renders");
});

test("renderKairoWorkspaceWidget appends one dim availability-check-failure line when given extraLines", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), 160, IDENTITY_THEME, ["Live availability check failed — team and usage status shown as unknown."]);
  assert.ok(lines.some((line) => line.includes("availability check failed")));
});

test("renderKairoWorkspaceWidget's TEAM panel footer lists the /kairo-* commands", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), 160, IDENTITY_THEME);
  assert.ok(lines.some((line) => line.includes("/kairo-team") && line.includes("/kairo-route") && line.includes("/kairo-usage")));
});

test("renderKairoWorkspaceWidget's USAGE panel footer shows the session and mode", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), 160, IDENTITY_THEME);
  assert.ok(lines.some((line) => line.includes("11111111") && line.includes("agent")));
});

test("availabilityNotices groups blocked roles into one notice per provider and window, never one per role", () => {
  const goLimit = { provider: "opencode-go", window: "monthly", remainingPercent: 0, resetsAt: null };
  const rows = [
    { role: "Builder", model: "GLM-5.3", via: "opencode-go", availability: { state: "blocked", warning: "Unavailable — OpenCode Go monthly window is rate-limited", limit: goLimit } },
    { role: "Reviewer", model: "Kimi K3", via: "opencode-go", availability: { state: "blocked", warning: "Unavailable — OpenCode Go monthly window is rate-limited", limit: goLimit } },
    { role: "Tester", model: "Fable", via: "cursor", availability: { state: "blocked", warning: "Unavailable — Cursor Other Models limit reached" } },
    { role: "Explorer", model: "GPT-6 Astra", via: "codex", availability: { state: "available", warning: null } }
  ];
  const notices = availabilityNotices({ rows });
  assert.equal(notices.length, 2);

  const go = notices.find((notice) => notice.key === "opencode-go|window:monthly");
  assert.match(go.message, /OpenCode Go monthly window is rate-limited/);
  assert.match(go.message, /Builder \(GLM-5\.3\), Reviewer \(Kimi K3\)/);
  assert.match(go.message, /recover the team automatically/, "a window limit is what automatic recovery handles");

  const cursor = notices.find((notice) => notice.key.startsWith("cursor|"));
  assert.match(cursor.message, /Tester \(Fable\)/);
  assert.match(cursor.message, /project analyze/, "a non-window block still points at the manual next step");
  assert.doesNotMatch(cursor.message, /recover the team automatically/);
});

test("availabilityNotices returns nothing when no role is blocked", () => {
  assert.deepEqual(availabilityNotices({ rows: [SEVEN_ROLES[0]] }), []);
  assert.deepEqual(availabilityNotices(undefined), []);
});

// --- Defects reported against the user-approved design in the real
// render (2026-09-23): TEAM columns must align role/model/via to fixed
// widths (never a literal fixed double-space), and a footer must only
// ever show whole commands that fit — never cut one mid-name.

test("computeSideBySideWidths sizes each panel to its own content (P01.2), never a naive half-width split", () => {
  const usageBody = ["Codex   5h ━━━━━━━━━━ 80%"]; // 26 visible columns
  const teamRows = [{ role: "Builder", model: "GPT-6 Terra", via: "codex", availability: { state: "available" } }];

  const { leftWidth, rightWidth, sideBySide, gap } = computeSideBySideWidths(160, usageBody, teamRows);
  assert.equal(sideBySide, true);
  assert.ok(leftWidth < 80, `left panel should be sized to its short content, not half of 160, got ${leftWidth}`);
  assert.ok(rightWidth < 80, `right panel should be sized to its short content, not half of 160, got ${rightWidth}`);
  assert.ok(gap >= 1, "a real gap separates the two panels");
});

test("computeSideBySideWidths stacks (never exceeding the given width) when combined content doesn't fit", () => {
  const usageBody = ["Codex   5h ━━━━━━━━━━ 80%"];
  const teamRows = [{ role: "Project Analyst", model: "A Very Long Model Name Indeed", via: "opencode-go", availability: { state: "available" } }];

  const { leftWidth, rightWidth, sideBySide } = computeSideBySideWidths(40, usageBody, teamRows);
  assert.equal(sideBySide, false);
  assert.equal(leftWidth, 40);
  assert.equal(rightWidth, 40);
});

for (const width of [100, 160]) {
  test(`renderKairoWorkspaceWidget aligns TEAM role/model/via into fixed columns at width ${width}, padded to the longest visible width per column`, () => {
    const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), width, IDENTITY_THEME);
    // Locate the TEAM panel's own start column from the real rendered top
    // border (its second "╭") — content-sized panels (P01.2) no longer
    // split the width in half, so this never re-derives that arithmetic.
    const topLine = lines[0];
    const teamStart = topLine.indexOf("╭", topLine.indexOf("╭") + 1);
    assert.ok(teamStart > 0, `expected a second panel top border on the first line at width ${width}: "${topLine}"`);
    const teamLines = lines
      .map((line) => line.slice(teamStart))
      .filter((line) => SEVEN_ROLES.some((row) => line.includes(row.role)));

    assert.equal(teamLines.length, SEVEN_ROLES.length, `expected exactly one TEAM content line per role at width ${width}`);

    const modelStarts = [];
    const viaStarts = [];
    for (const row of SEVEN_ROLES) {
      const line = teamLines.find((candidate) => candidate.includes(row.role));
      assert.ok(line, `missing TEAM line for role "${row.role}"`);
      const modelStart = line.indexOf(row.model);
      assert.ok(modelStart > 0, `model "${row.model}" not found after the role column on "${line}"`);
      const viaStart = line.indexOf(row.via, modelStart + row.model.length);
      assert.ok(viaStart > modelStart, `via "${row.via}" not found after the model column on "${line}"`);
      modelStarts.push(modelStart);
      viaStarts.push(viaStart);
    }

    // The whole point: with roles of very different lengths ("Project
    // Analyst" vs. "Builder"), a naive fixed "  " gap (the reported
    // defect) puts the model column at a DIFFERENT visible column on
    // every row. A real column layout puts it at the SAME column on
    // every row, padded to the longest role's visible width.
    assert.equal(new Set(modelStarts).size, 1, `model column should start at the same visible column on every row, got starts: ${modelStarts.join(",")}`);
    assert.equal(new Set(viaStarts).size, 1, `via column should start at the same visible column on every row, got starts: ${viaStarts.join(",")}`);
  });
}

for (const width of [60, 100, 160]) {
  test(`renderKairoWorkspaceWidget's TEAM footer at width ${width} never cuts a /kairo-* command mid-name`, () => {
    const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), width, IDENTITY_THEME);
    const footerLine = lines.find((line) => line.includes("/kairo-"));
    assert.ok(footerLine, `expected a TEAM footer line with /kairo-* commands at width ${width}`);

    const KNOWN_COMMANDS = ["/kairo-team", "/kairo-route", "/kairo-usage", "/kairo-memory"];
    const found = footerLine.match(/\/kairo-[a-z]*/g) ?? [];
    assert.ok(found.length > 0, `expected at least one /kairo-* command in the footer at width ${width}`);
    for (const command of found) {
      assert.ok(KNOWN_COMMANDS.includes(command), `footer contains a partial/unknown command "${command}" at width ${width} (line: "${footerLine}")`);
    }
    // No stray control-sequence artifact from a mid-string truncation
    // (the visible symptom of the reported defect in the real render).
    assert.ok(!footerLine.includes("[0m"), `footer should never show a raw escape artifact at width ${width}: "${footerLine}"`);
  });
}
