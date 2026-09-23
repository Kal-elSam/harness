import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { blockedRoleNotifications, renderKairoWorkspaceWidget } from "../src/global/host/workspace-widget.js";

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
  const lines = renderKairoWorkspaceWidget(fixtureSnapshot(), 160, theme);
  const joined = lines.join("\n");
  assert.ok(!joined.includes("available"), "no row should print the word 'available'");
  assert.ok(joined.includes("BLOCKED"), "the blocked role should be marked BLOCKED");
  assert.ok(joined.includes("<error>") && joined.includes("BLOCKED"), "the blocked row should use the error tone");
});

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

test("blockedRoleNotifications returns exactly one entry per blocked role, carrying role, model, and Kairo's own warning", () => {
  const notifications = blockedRoleNotifications({ rows: SEVEN_ROLES });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].role, "Researcher");
  assert.equal(notifications[0].model, "MiniMax-M3");
  assert.equal(notifications[0].warning, "Unavailable — Cursor Models quota exhausted");
  assert.match(notifications[0].message, /Researcher/);
  assert.match(notifications[0].message, /MiniMax-M3/);
  assert.match(notifications[0].message, /Cursor Models quota exhausted/);
  assert.match(notifications[0].message, /project analyze/);
});

test("blockedRoleNotifications returns nothing when no role is blocked", () => {
  assert.deepEqual(blockedRoleNotifications({ rows: [SEVEN_ROLES[0]] }), []);
  assert.deepEqual(blockedRoleNotifications(undefined), []);
});
