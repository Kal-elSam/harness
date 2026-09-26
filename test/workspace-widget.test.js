import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  agentRowHitboxes,
  availabilityNotices,
  computeSideBySideWidths,
  createCompactShellSummaryWidget,
  createShellBottomStripWidget,
  createShellSidebarWidget,
  renderCompactShellSummaryLines,
  renderKairoWorkspaceWidget,
  renderShellBottomStripLines,
  renderShellSidebarLines,
  SHELL_SIDEBAR_MIN_COLUMNS
} from "../src/global/host/workspace-widget.js";

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
    agents: [
      { id: "project-analyst", label: "Project Analyst", role: "Project Analyst", provider: "codex", model: "GPT-6-Astra", state: "idle", stateReason: null },
      { id: "orchestrator", label: "Orchestrator", role: "Orchestrator", provider: "opencode-go", model: "Kimi K3", state: "idle", stateReason: null },
      { id: "builder", label: "Builder", role: "Builder", provider: "codex", model: "GPT-6 Terra", state: "idle", stateReason: null },
      { id: "reviewer", label: "Reviewer", role: "Reviewer", provider: "codex", model: "GPT-5.6-Terra", state: "idle", stateReason: null },
      { id: "tester", label: "Tester", role: "Tester", provider: "claude", model: "Claude Haiku", state: "idle", stateReason: null },
      { id: "researcher", label: "Researcher", role: "Researcher", provider: "opencode-go", model: "MiniMax-M3", state: "blocked", stateReason: "Unavailable — Cursor Models quota exhausted" },
      { id: "documenter", label: "Documenter", role: "Documenter", provider: "opencode-go", model: "Gemini Flash", state: "unknown", stateReason: null }
    ],
    spaces: [
      { kind: "project", label: "agentic-harness", root: "/work/agentic-harness" },
      { kind: "session", id: "11111111", mode: "agent", state: "bound" }
    ],
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

test("renderKairoWorkspaceWidget stacks HERD above USAGE when the width is narrow, and places them side by side otherwise", () => {
  const narrow = renderKairoWorkspaceWidget(fixtureSnapshot(), 60, IDENTITY_THEME);
  const herdIndex = narrow.findIndex((line) => line.includes("HERD"));
  const usageIndex = narrow.findIndex((line) => line.includes("USAGE"));
  assert.ok(herdIndex >= 0 && usageIndex >= 0 && herdIndex < usageIndex, "HERD panel should render fully before USAGE when stacked");

  const wide = renderKairoWorkspaceWidget(fixtureSnapshot(), 120, IDENTITY_THEME);
  const wideLineWithBoth = wide.find((line) => line.includes("USAGE") && line.includes("HERD"));
  assert.ok(wideLineWithBoth, "USAGE and HERD titles should share a line when side by side");
});

test("renderKairoWorkspaceWidget shows no per-row 'available' marker, but colors a blocked row with BLOCKED", () => {
  const theme = markerTheme();
  // Stacked (at a width too narrow for both panels to fit side by side)
  // gives each row the FULL given width instead — see the same markerTheme
  // note the old TEAM test carried: the test double's own "<role>" wraps
  // would truncate inside a tightly content-sized side-by-side panel.
  const shortSnapshot = fixtureSnapshot({
    agents: [
      { id: "a", label: "A", role: "A", provider: "codex", model: "M", state: "idle", stateReason: null },
      { id: "b", label: "B", role: "B", provider: "codex", model: "N", state: "blocked", stateReason: "Blocked." }
    ]
  });
  const lines = renderKairoWorkspaceWidget(shortSnapshot, 50, theme);
  const joined = lines.join("\n");
  assert.ok(!joined.includes("available"), "no row should print the word 'available'");
  assert.ok(!joined.includes("idle"), "no row should print its idle state as a word");
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
    // combined HERD+USAGE line should NOT consume the entire given width
    // just because it's available — it should stop at what the content
    // (plus frame/gap) actually needs.
    if (width === 160) {
      const combined = lines.find((line) => line.includes("USAGE") && line.includes("HERD"));
      assert.ok(combined, "expected a combined USAGE+HERD line at width 160");
      assert.ok(
        visibleWidth(combined) < width,
        `combined USAGE+TEAM line should stop short of the full width at ${width}, got ${visibleWidth(combined)}`
      );
    }
  });
}

test("renderKairoWorkspaceWidget's HERD title names the blocked count when anything needs attention", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), 160, IDENTITY_THEME);
  assert.ok(lines.some((line) => line.includes("HERD") && line.includes("1 blocked")), "one blocked agent should read as 'HERD · 1 blocked'");
});

test("renderKairoWorkspaceWidget's HERD title falls back to the team state when nothing is blocked", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot({
    agents: [{ id: "a", label: "A", role: "A", provider: "codex", model: "M", state: "idle", stateReason: null }]
  }), 160, IDENTITY_THEME);
  assert.ok(lines.some((line) => line.includes("HERD · active")));
  assert.ok(!lines.some((line) => line.includes("blocked")), "no blocked count without a blocked agent");
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

test("renderKairoWorkspaceWidget renders a cached herd value dim with its age in the HERD title, instead of fresh", () => {
  const cachedTeam = { state: "active", rows: [SEVEN_ROLES[0]], cached: true, cacheAgeMs: 120_000 };
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot({ team: cachedTeam }), 160, IDENTITY_THEME);
  const joined = lines.join("\n");
  assert.ok(joined.includes("2m ago"), "the herd cache age is shown");
  assert.ok(joined.includes("Project Analyst"), "the cached agent itself still renders");
});

test("renderKairoWorkspaceWidget appends one dim availability-check-failure line when given extraLines", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), 160, IDENTITY_THEME, ["Live availability check failed — team and usage status shown as unknown."]);
  assert.ok(lines.some((line) => line.includes("availability check failed")));
});

test("renderKairoWorkspaceWidget's HERD panel footer lists whole /kairo-* commands, starting with the detail view", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), 160, IDENTITY_THEME);
  assert.ok(lines.some((line) => line.includes("/kairo-team")), "the narrow herd panel always fits at least the /kairo-team detail entry");
});

test("renderKairoWorkspaceWidget's spaces section shows the project label and the short bound session id", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), 160, IDENTITY_THEME);
  const joined = lines.join("\n");
  assert.ok(joined.includes("agentic-harness"), "the current project label is visible");
  assert.ok(joined.includes("session: 11111111 · agent"), "the bound session shows as short id + mode");
});

test("renderKairoWorkspaceWidget's spaces section shows an explicit unbound state, never a default ask mode", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot({
    session: { state: "unbound" },
    spaces: [
      { kind: "project", label: "agentic-harness", root: "/work/agentic-harness" },
      { kind: "session", state: "unbound" }
    ]
  }), 160, IDENTITY_THEME);
  assert.ok(lines.some((line) => line.includes("session: unbound")));
  assert.ok(!lines.some((line) => line.includes("· ask")), "unbound must never imply a default mode");
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
  const herdBody = ["◈ agentic-harness", "○ Builder · codex"];
  const usageBody = ["Codex   5h ━━━━━━━━━━ 80%"]; // 26 visible columns

  const { leftWidth, rightWidth, sideBySide, gap } = computeSideBySideWidths(160, herdBody, usageBody);
  assert.equal(sideBySide, true);
  assert.ok(leftWidth < 80, `left panel should be sized to its short content, not half of 160, got ${leftWidth}`);
  assert.ok(rightWidth < 80, `right panel should be sized to its short content, not half of 160, got ${rightWidth}`);
  assert.ok(gap >= 1, "a real gap separates the two panels");
});

test("computeSideBySideWidths stacks (never exceeding the given width) when combined content doesn't fit", () => {
  const herdBody = ["◈ agentic-harness", "○ Project Analyst · opencode-go · A Very Long Provider Name Indeed"];
  const usageBody = ["Codex   5h ━━━━━━━━━━ 80%"];

  const { leftWidth, rightWidth, sideBySide } = computeSideBySideWidths(40, herdBody, usageBody);
  assert.equal(sideBySide, false);
  assert.equal(leftWidth, 40);
  assert.equal(rightWidth, 40);
});

// --- H2 herd layout: the dense role/model/via table leaves the overview
// (detail lives in /kairo-team) — agents render blocked-first as a Herdr
// glyph list, so one glance answers who needs attention.

function herdAgentLine(lines, label) {
  return lines.find((line) => line.includes(label));
}

test("renderKairoWorkspaceWidget orders herd agents blocked first, then working, idle, done, unknown last", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot({
    agents: [
      { id: "u", label: "Uma", role: "Uma", provider: "codex", model: "M", state: "unknown", stateReason: null },
      { id: "i", label: "Ida", role: "Ida", provider: "codex", model: "M", state: "idle", stateReason: null },
      { id: "d", label: "Dora", role: "Dora", provider: "codex", model: "M", state: "done", stateReason: null },
      { id: "b", label: "Bea", role: "Bea", provider: "codex", model: "M", state: "blocked", stateReason: "Blocked." },
      { id: "w", label: "Wally", role: "Wally", provider: "codex", model: "M", state: "working", stateReason: null }
    ]
  }), 60, IDENTITY_THEME);

  const order = ["Bea", "Wally", "Ida", "Dora", "Uma"]
    .map((label) => lines.findIndex((line) => line.includes(label)));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), `herd order should be blocked, working, idle, done, unknown, got indexes ${order.join(",")}`);
});

test("renderKairoWorkspaceWidget gives every herd state its own glyph and never a false done", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot({
    agents: [
      { id: "b", label: "Bea", role: "Bea", provider: "codex", model: "M", state: "blocked", stateReason: "Blocked." },
      { id: "w", label: "Wally", role: "Wally", provider: "codex", model: "M", state: "working", stateReason: null },
      { id: "i", label: "Ida", role: "Ida", provider: "codex", model: "M", state: "idle", stateReason: null },
      { id: "d", label: "Dora", role: "Dora", provider: "codex", model: "M", state: "done", stateReason: null },
      { id: "u", label: "Uma", role: "Uma", provider: "codex", model: "M", state: "unknown", stateReason: null }
    ]
  }), 60, IDENTITY_THEME);
  const joined = lines.join("\n");
  for (const [label, glyph] of [["Bea", "✖"], ["Wally", "◉"], ["Ida", "○"], ["Dora", "✔"], ["Uma", "?"]]) {
    assert.ok(herdAgentLine(lines, label)?.includes(glyph), `agent "${label}" should carry the "${glyph}" glyph`);
  }
  assert.ok(!joined.includes("DONE"), "done is glyph-only, never a DONE word");

  const noDone = renderKairoWorkspaceWidget(fixtureSnapshot({
    agents: [{ id: "i", label: "Ida", role: "Ida", provider: "codex", model: "M", state: "idle", stateReason: null }]
  }), 60, IDENTITY_THEME).join("\n");
  assert.ok(!noDone.includes("✔"), "no done glyph without a real finished signal");
});

test("renderKairoWorkspaceWidget truncates a long herd provider but never the agent label", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot({
    agents: [{ id: "b", label: "Builder", role: "Builder", provider: "a-very-long-provider-name-indeed", model: "M", state: "idle", stateReason: null }]
  }), 40, IDENTITY_THEME);
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 40, `line exceeds width 40: "${line}"`);
  }
  const agentLine = herdAgentLine(lines, "Builder");
  assert.ok(agentLine, "the agent label survives truncation");
  assert.ok(!agentLine.includes("a-very-long-provider-name-indeed"), "the overflowing provider is truncated, not the label");
});

test("renderKairoWorkspaceWidget shows the analyze hint when the herd is empty", () => {
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot({ agents: [] }), 60, IDENTITY_THEME);
  assert.ok(lines.some((line) => line.includes("Run /project analyze to build this project's team.")));
});

for (const width of [60, 100, 160]) {
  test(`renderKairoWorkspaceWidget's HERD footer at width ${width} never cuts a /kairo-* command mid-name`, () => {
    const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), width, IDENTITY_THEME);
    const footerLine = lines.find((line) => line.includes("/kairo-"));
    assert.ok(footerLine, `expected a HERD footer line with /kairo-* commands at width ${width}`);

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

// --- H7/H8 shell surface helpers: SPACES/AGENTS sidebar (never HERD),
// USAGE bottom strip, compact narrow summary. Same snapshot facts as the
// regular-mode overview widget; never invent working/done.

test("SHELL_SIDEBAR_MIN_COLUMNS is 90", () => {
  assert.equal(SHELL_SIDEBAR_MIN_COLUMNS, 90);
});

test("renderShellSidebarLines heads with the project name and AGENTS, never SPACES/HERD, never a session line", () => {
  const lines = renderShellSidebarLines(fixtureSnapshot(), IDENTITY_THEME);
  const joined = lines.join("\n");
  assert.ok(!joined.includes("SPACES"), "multiproject SPACES nav is gone");
  assert.ok(lines.some((line) => line.includes("AGENTS")));
  assert.ok(!joined.includes("HERD"), "shell sidebar must never reuse the HERD overview title");
  assert.ok(joined.includes("agentic-harness"));
  assert.ok(!joined.includes("session:"), "session identity belongs to the status bar only in fullscreen — never duplicated in the sidebar");
});

test("renderShellSidebarLines truncates an overflowing line with an ellipsis, never a silent cut", () => {
  const lines = renderShellSidebarLines(fixtureSnapshot({ agents: [] }), IDENTITY_THEME);
  const hint = lines.find((line) => line.includes("Run /project analyze"));
  assert.ok(hint, "expected the no-team hint line");
  assert.ok(stripTerminalSequences(hint).endsWith("…"), `overflowing sidebar line must end in an ellipsis, got: "${hint}"`);
  assert.ok(visibleWidth(hint) <= 28, `sidebar content must fit its real 28-column budget, got ${visibleWidth(hint)}: "${hint}"`);
});

test("renderShellSidebarLines folds an unavailable route notice into the sidebar instead of a separate widget", () => {
  const available = renderShellSidebarLines(fixtureSnapshot(), IDENTITY_THEME);
  assert.ok(!available.join("\n").includes("ROUTES unavailable"), "no route notice when routes are fine");

  const unavailable = renderShellSidebarLines(fixtureSnapshot(), IDENTITY_THEME, { routeUnavailable: true });
  const joined = unavailable.join("\n");
  assert.ok(joined.includes("ROUTES unavailable"));
  assert.ok(/project analyze/.test(joined));
});

test("renderShellSidebarLines orders agents blocked-first and keeps unknown when that is the evidence", () => {
  const lines = renderShellSidebarLines(fixtureSnapshot({
    agents: [
      { id: "u", label: "Uma", role: "Uma", provider: "codex", model: "M", state: "unknown", stateReason: null },
      { id: "i", label: "Ida", role: "Ida", provider: "codex", model: "M", state: "idle", stateReason: null },
      { id: "b", label: "Bea", role: "Bea", provider: "codex", model: "M", state: "blocked", stateReason: "Blocked." }
    ]
  }), IDENTITY_THEME);
  const order = ["Bea", "Ida", "Uma"].map((label) => lines.findIndex((line) => line.includes(label)));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(herdAgentLine(lines, "Bea")?.includes("✖"));
  assert.ok(herdAgentLine(lines, "Uma")?.includes("?"));
  assert.ok(!lines.join("\n").includes("◉"), "no working glyph without a working agent");
  assert.ok(!lines.join("\n").includes("✔"), "no done glyph without a done agent");
});

test("renderShellBottomStripLines carries USAGE gauges but never the session line the status bar already shows", () => {
  const lines = renderShellBottomStripLines(fixtureSnapshot(), IDENTITY_THEME);
  const joined = lines.join("\n");
  assert.ok(lines.some((line) => line.includes("USAGE")));
  assert.equal(lines.filter((line) => line.includes("USAGE")).length, 1, "USAGE header must appear exactly once");
  assert.ok(joined.includes("58%") || joined.includes("80%"), "usage percentages from the model must appear");
  assert.ok(!joined.includes("session:"), "session identity belongs to the status bar only in fullscreen — never duplicated in the strip");
});

test("renderCompactShellSummaryLines is a short attention+usage summary for narrow terminals, with no session line", () => {
  const lines = renderCompactShellSummaryLines(fixtureSnapshot(), IDENTITY_THEME);
  assert.ok(lines.length >= 1 && lines.length <= 6, `compact summary should stay short, got ${lines.length} lines`);
  const joined = lines.join("\n");
  assert.ok(joined.includes("blocked") || joined.includes("✖") || joined.includes("Researcher"), "attention signal must remain visible");
  assert.ok(joined.includes("USAGE") || joined.includes("%") || joined.includes("usage"), "usage signal must remain visible");
  assert.ok(!joined.includes("HERD"));
  assert.ok(!joined.includes("session:"), "session identity belongs to the status bar only in fullscreen");
});

test("renderCompactShellSummaryLines folds an unavailable route notice in, without duplicating the old widget's full text", () => {
  const lines = renderCompactShellSummaryLines(fixtureSnapshot(), IDENTITY_THEME, { routeUnavailable: true });
  assert.ok(lines.length <= 6, `compact summary with a route notice should stay short, got ${lines.length} lines`);
  const joined = lines.join("\n");
  assert.ok(joined.includes("ROUTES unavailable"));
  assert.ok(!joined.includes("KAIRO ROUTES"), "the compact summary is not the old detail widget re-labeled");
  assert.ok(!joined.includes("KAIRO TEAM"), "the compact summary never repeats the old widget's team detail line");
});

// --- H8b native review fixes (2026-09-25): real 28-col truncation budget
// (not the bordered-panel 24), no duplicate "Run /project analyze", every
// USAGE provider that fits (not just the first), extraLines surfaced in
// fullscreen, and live width-reactive slot components (no stale decision
// captured once per refresh).

test("renderShellSidebarLines truncates every line to the real 28-column budget, not a bordered-panel 24", () => {
  const lines = renderShellSidebarLines(fixtureSnapshot({
    project: { label: "a-genuinely-very-long-project-name-that-overflows" }
  }), IDENTITY_THEME, { routeUnavailable: true });
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 28, `sidebar line exceeds the real 28-column budget: "${line}" (${visibleWidth(line)})`);
  }
  const projectLine = lines.find((line) => line.includes("a-genuinely"));
  assert.equal(visibleWidth(projectLine), 28, `an overflowing line must use the full 28-column budget, not stop at 24: "${projectLine}" (${visibleWidth(projectLine)})`);
});

test("renderShellSidebarLines shows the 'run /project analyze' hint exactly once when routes are unavailable and there is no team yet", () => {
  const lines = renderShellSidebarLines(fixtureSnapshot({ agents: [] }), IDENTITY_THEME, { routeUnavailable: true });
  const joined = lines.join("\n");
  const hintCount = (joined.match(/project analyze/gi) ?? []).length;
  assert.equal(hintCount, 1, `expected exactly one "project analyze" hint, found ${hintCount} in: ${JSON.stringify(lines)}`);
});

test("renderCompactShellSummaryLines shows the 'run /project analyze' hint exactly once when routes are unavailable and there is no team yet", () => {
  const lines = renderCompactShellSummaryLines(fixtureSnapshot({ agents: [] }), IDENTITY_THEME, { routeUnavailable: true });
  const joined = lines.join("\n");
  const hintCount = (joined.match(/project analyze/gi) ?? []).length;
  assert.equal(hintCount, 1, `expected exactly one "project analyze" hint, found ${hintCount} in: ${JSON.stringify(lines)}`);
});

test("renderShellSidebarLines and renderShellBottomStripLines surface extraLines (e.g. a team-recovery notice)", () => {
  const sidebar = renderShellSidebarLines(fixtureSnapshot(), IDENTITY_THEME, { extraLines: ["Team recovered."] });
  assert.ok(sidebar.some((line) => line.includes("Team recovered.")), `sidebar should carry the extra line, got: ${JSON.stringify(sidebar)}`);

  const strip = renderShellBottomStripLines(fixtureSnapshot(), IDENTITY_THEME, { extraLines: ["Kairo recovered the project team."] });
  assert.ok(strip.some((line) => line.includes("Kairo recovered the project team.")), `strip is not width-constrained, so it should carry the full extra line, got: ${JSON.stringify(strip)}`);
});

test("renderCompactShellSummaryLines surfaces extraLines too, within its short line budget", () => {
  const lines = renderCompactShellSummaryLines(fixtureSnapshot(), IDENTITY_THEME, { extraLines: ["Kairo recovered the project team."] });
  assert.ok(lines.some((line) => line.includes("Kairo recovered the project team.")));
});

test("the compact USAGE line includes every provider that fits the given width, ellipsis when one is dropped", () => {
  const wide = renderCompactShellSummaryLines(fixtureSnapshot(), IDENTITY_THEME, { width: 100 });
  const wideUsage = wide.find((line) => line.includes("USAGE"));
  assert.ok(wideUsage.includes("Codex") && wideUsage.includes("Claude") && wideUsage.includes("Go"), `expected every provider at width 100, got: "${wideUsage}"`);
  assert.ok(!wideUsage.includes("…"), "no ellipsis needed when everything fits");

  const narrow = renderCompactShellSummaryLines(fixtureSnapshot(), IDENTITY_THEME, { width: 30 });
  const narrowUsage = narrow.find((line) => line.includes("USAGE"));
  assert.ok(visibleWidth(narrowUsage) <= 30, `usage line must fit width 30, got ${visibleWidth(narrowUsage)}: "${narrowUsage}"`);
  assert.ok(narrowUsage.includes("Codex"), "at least the first provider must still show");
  assert.ok(!narrowUsage.includes("Go"), "a provider that does not fit must be dropped, not truncated mid-name");
  assert.ok(narrowUsage.endsWith("…"), `dropping a provider must end the line in an ellipsis, got: "${narrowUsage}"`);
});

test("createShellSidebarWidget/createShellBottomStripWidget/createCompactShellSummaryWidget decide live from getColumns() on every render, with no re-creation in between", () => {
  let columns = 100;
  const getColumns = () => columns;
  const sidebarFactory = createShellSidebarWidget(fixtureSnapshot(), { getColumns });
  const stripFactory = createShellBottomStripWidget(fixtureSnapshot(), { getColumns });
  const compactFactory = createCompactShellSummaryWidget(fixtureSnapshot(), { getColumns });
  const sidebarComponent = sidebarFactory(undefined, IDENTITY_THEME);
  const stripComponent = stripFactory(undefined, IDENTITY_THEME);
  const compactComponent = compactFactory(undefined, IDENTITY_THEME);

  // 100 cols: sidebar/strip show real content, compact summary stays empty
  // (the sidebar/strip already cover it) — all from the SAME component
  // instances, no factory re-invocation.
  assert.ok(sidebarComponent.render(28).some((line) => line.includes("agentic-harness")), "sidebar shows content at 100 cols");
  assert.ok(stripComponent.render(80).some((line) => line.includes("USAGE")), "strip shows content at 100 cols");
  assert.deepEqual(compactComponent.render(100), [], "compact summary stays empty while the sidebar/strip are shown");

  // Cross below 90 with NO intervening refresh (no new factory calls) —
  // just flip what getColumns() returns, as a live resize would.
  columns = 60;
  assert.deepEqual(sidebarComponent.render(28), [], "sidebar goes empty once columns drop below 90, same instance, no refresh");
  assert.deepEqual(stripComponent.render(80), [], "strip goes empty once columns drop below 90, same instance, no refresh");
  assert.ok(compactComponent.render(60).length > 0, "compact summary takes over once columns drop below 90, same instance, no refresh");

  // And back again, still the same instances.
  columns = 100;
  assert.ok(sidebarComponent.render(28).some((line) => line.includes("agentic-harness")), "sidebar shows content again once columns return to 100");
  assert.ok(stripComponent.render(80).some((line) => line.includes("USAGE")), "strip shows content again once columns return to 100");
  assert.deepEqual(compactComponent.render(100), [], "compact summary empties again once columns return to 100");
});

// --- S2: project header instead of SPACES, proven blocked cause instead of generic BLOCKED
test("S2 renderShellSidebarLines heads the sidebar with the current project name, never SPACES, never a session line", () => {
  const lines = renderShellSidebarLines(fixtureSnapshot(), IDENTITY_THEME);
  assert.ok(!lines.some((line) => line.includes("SPACES")), "no SPACES header");
  assert.ok(!lines.some((line) => line.includes("session:")), "no session line in the sidebar");
  assert.ok(lines.some((line) => line.includes("agentic-harness")), "project name heads the sidebar");
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 28, `sidebar line exceeds 28: "${line}"`);
  }
});

test("S2 sidebar blocked row shows the proven short cause, not generic BLOCKED", () => {
  const short = renderShellSidebarLines(fixtureSnapshot({
    agents: [
      { id: "qa", label: "QA", role: "QA", provider: "cursor", model: "M", state: "blocked", stateReason: "Unavailable — Cursor limit hit" }
    ]
  }), IDENTITY_THEME);
  const shortJoined = short.join("\n");
  assert.ok(shortJoined.includes("Cursor limit hit"), "proven cause on the blocked row");
  assert.ok(!shortJoined.includes("BLOCKED"), "no generic BLOCKED word when the cause is known");
  const long = renderShellSidebarLines(fixtureSnapshot(), IDENTITY_THEME);
  const longJoined = long.join("\n");
  assert.ok(!longJoined.includes("BLOCKED"), "a long cause truncates with an ellipsis, never falls back to BLOCKED");
  assert.ok(longJoined.includes("…"), "overflowing cause ends in an ellipsis");
});

test("S2 sidebar blocked row without a captured reason says access is unavailable, never BLOCKED", () => {
  const short = renderShellSidebarLines(fixtureSnapshot({
    agents: [
      { id: "qa", label: "QA", role: "QA", provider: "codex", model: "M", state: "blocked", stateReason: null }
    ]
  }), IDENTITY_THEME);
  const shortJoined = short.join("\n");
  assert.ok(!shortJoined.includes("BLOCKED"), "no generic BLOCKED word without a proven cause");
  assert.ok(shortJoined.includes("Unavailable"), "honest fallback without inventing a cause");
  const long = renderShellSidebarLines(fixtureSnapshot({
    agents: [
      { id: "b", label: "Builder", role: "Builder", provider: "codex", model: "M", state: "blocked", stateReason: null }
    ]
  }), IDENTITY_THEME);
  const longJoined = long.join("\n");
  assert.ok(!longJoined.includes("BLOCKED"), "a long fallback truncates with an ellipsis, never BLOCKED");
});

test("S2 compact summary names the proven cause for one blocked agent", () => {
  const lines = renderCompactShellSummaryLines(fixtureSnapshot(), IDENTITY_THEME, { width: 60 });
  const joined = lines.join("\n");
  assert.ok(joined.includes("Cursor Models quota exhausted"), "compact summary carries the proven cause");
});

test("S2 compact summary without a captured reason says access is unavailable, never blocked", () => {
  const lines = renderCompactShellSummaryLines(fixtureSnapshot({
    agents: [
      { id: "b", label: "Builder", role: "Builder", provider: "codex", model: "M", state: "blocked", stateReason: null }
    ]
  }), IDENTITY_THEME, { width: 60 });
  const joined = lines.join("\n");
  assert.ok(!joined.toLowerCase().includes("blocked"), "no generic blocked word without a proven cause");
  assert.ok(joined.includes("Unavailable"), "honest fallback without inventing a cause");
});

// --- S2-1b: click opens detail, keyboard (/kairo-team) offers the same access
test("S2-1b agentRowHitboxes maps click rows to agent ids, shifting with route lines", () => {
  const snap = fixtureSnapshot();
  const plain = agentRowHitboxes(snap, {});
  assert.ok(plain.length === snap.agents.length, "one hitbox per agent row");
  assert.deepEqual(plain.map((h) => h.y), [2, 3, 4, 5, 6, 7, 8], "rows follow the project header + AGENTS header");
  const routed = agentRowHitboxes(snap, { routeUnavailable: true });
  assert.deepEqual(routed.map((h) => h.y), [4, 5, 6, 7, 8, 9, 10], "route notice lines shift every hitbox down");
  assert.deepEqual(routed.map((h) => h.agentId), plain.map((h) => h.agentId), "same agents, shifted rows");
});

test("S2-1b sidebar shows the selected agent detail block with model, cause and next step", () => {
  const lines = renderShellSidebarLines(fixtureSnapshot(), IDENTITY_THEME, { selectedAgentId: "researcher" });
  const joined = lines.join("\n");
  assert.ok(joined.includes("MiniMax-M3"), "detail names the model");
  assert.ok(joined.replace(/\n/g, " ").includes("Cursor Models quota exhausted"), "detail carries the full cause (wrapped, never cut)");
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 28, `detail line exceeds 28: "${line}"`);
  }
  const noCause = renderShellSidebarLines(fixtureSnapshot({
    agents: [
      { id: "b", label: "Builder", role: "Builder", provider: "codex", model: "M", state: "blocked", stateReason: null }
    ]
  }), IDENTITY_THEME, { selectedAgentId: "b" });
  assert.ok(noCause.join("\n").includes("Next step"), "detail without a cause offers the next step");
});

test("S2-1b sidebar answers one full press-then-click gesture with a single select", () => {
  const snap = fixtureSnapshot();
  const seen = [];
  const component = createShellSidebarWidget(snap, { getColumns: () => 100, onSelectAgent: (id) => seen.push(id) })(undefined, IDENTITY_THEME);
  const [first] = agentRowHitboxes(snap, {});
  const at = (type) => ({ type, button: "left", x: 2, y: first.y, screenX: 2, screenY: first.y, width: 28, height: 30, shift: false, alt: false, ctrl: false });
  component.handleMouse(at("press"));
  component.handleMouse(at("click"));
  assert.deepEqual(seen, [first.agentId], "one gesture selects exactly once — press must not toggle");
});

test("S2-1b sidebar handleMouse calls onSelectAgent for agent rows and ignores headers", () => {
  const snap = fixtureSnapshot();
  const seen = [];
  const component = createShellSidebarWidget(snap, { getColumns: () => 100, onSelectAgent: (id) => seen.push(id) })(undefined, IDENTITY_THEME);
  assert.equal(typeof component.handleMouse, "function", "sidebar handles mouse");
  const [first] = agentRowHitboxes(snap, {});
  component.handleMouse({ type: "click", button: "left", x: 2, y: first.y, screenX: 2, screenY: first.y, width: 28, height: 30, shift: false, alt: false, ctrl: false });
  assert.deepEqual(seen, [first.agentId], "click on an agent row selects it");
  component.handleMouse({ type: "click", button: "left", x: 2, y: 0, screenX: 2, screenY: 0, width: 28, height: 30, shift: false, alt: false, ctrl: false });
  assert.deepEqual(seen, [first.agentId], "click on the header selects nothing");
});
