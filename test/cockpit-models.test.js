import test from "node:test";
import assert from "node:assert/strict";
import {
  COCKPIT_NAV,
  COCKPIT_REGIONS,
  buildFooterModel,
  buildHomeMissionModel,
  buildNavModel,
  buildSystemStripModel,
  buildTopBarModel,
  formatHomeRecentRun,
  navIndexForView,
  regionsForLayout,
  resolveProjectName,
  windowLinesForLayout
} from "../src/global/ink/cockpit-models.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { READINESS_KINDS } from "../src/global/dashboard-guidance.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";

test("regionsForLayout matches breakpoints", () => {
  assert.deepEqual(regionsForLayout(LAYOUT_MODES.WIDE), [
    COCKPIT_REGIONS.NAV,
    COCKPIT_REGIONS.CONTENT,
    COCKPIT_REGIONS.SYSTEM
  ]);
  assert.deepEqual(regionsForLayout(LAYOUT_MODES.COMPACT), [
    COCKPIT_REGIONS.NAV,
    COCKPIT_REGIONS.CONTENT
  ]);
  assert.deepEqual(regionsForLayout(LAYOUT_MODES.MINIMAL), [COCKPIT_REGIONS.CONTENT]);
});

test("nav labels rename to Home / Running now / History / Agents / New run / System health", () => {
  const labels = COCKPIT_NAV.map((item) => item.label);
  assert.deepEqual(labels, [
    "Home",
    "Running now",
    "History",
    "Agents",
    "New run",
    "System health"
  ]);
  assert.ok(COCKPIT_NAV.every((item) => item.description));
});

test("top bar and nav models expose selected vs current plus explanation", () => {
  const top = buildTopBarModel({ projectName: "agentic-harness", unicode: true });
  assert.equal(top.brand, "KAIRO");
  assert.equal(top.status, "ONLINE");
  assert.match(top.projectLabel, /agentic-harness/);

  const nav = buildNavModel({
    navIndex: 4,
    currentView: ORCHESTRATOR_VIEWS.DIAGNOSTICS,
    focused: true,
    dashboard: { activeRuns: [], recentRuns: [], providers: [{ launchable: true }] },
    diagnostics: { diagnostics: { detected: 1, errors: 0 }, capabilities: [{}] }
  });
  assert.equal(nav.title, "NAVIGATION");
  assert.equal(nav.items[4].selected, true);
  assert.equal(nav.items[4].label, "New run");
  assert.equal(nav.items[5].current, true);
  assert.equal(nav.items[5].selected, false);
  assert.match(nav.explanation, /Delegate|agent/i);
  assert.ok(nav.items[0].statusSummary);
  assert.equal(navIndexForView(ORCHESTRATOR_VIEWS.LAUNCH), 4);
});

test("home model derives readiness, last run CTA destination, and explore guidance", () => {
  const setup = buildHomeMissionModel({
    projectName: "agentic-harness",
    hasGlobalState: false,
    diagnostics: { diagnostics: { detected: 0 } },
    dashboard: { providers: [], recentRuns: [] },
    layoutMode: LAYOUT_MODES.WIDE
  });
  assert.match(setup.title, /^HOME — agentic-harness$/);
  assert.match(setup.purpose, /coordina/i);
  assert.equal(setup.readiness.kind, READINESS_KINDS.NEEDS_SETUP);
  assert.equal(setup.next.targetView, "diagnostics");
  assert.ok(setup.recent.emptyHint);

  const limited = buildHomeMissionModel({
    projectName: "agentic-harness",
    hasGlobalState: true,
    diagnostics: {
      diagnostics: { detected: 4, available: 3, unknown: 0, errors: 0 },
      capabilities: [{}, {}, {}, {}],
      intelligence: { summary: { localAvailable: false, cloudAuthenticated: false } },
      recommendations: []
    },
    dashboard: {
      activeRuns: [],
      providers: [
        { launchable: true },
        { launchable: true },
        { launchable: true },
        { launchable: false }
      ],
      recentRuns: [{ runId: "r1", agentId: "codex", state: "failed" }]
    },
    layoutMode: LAYOUT_MODES.COMPACT
  });
  assert.equal(limited.readiness.kind, READINESS_KINDS.LIMITED);
  assert.equal(limited.includeEmbeddedStatus, true);
  assert.equal(limited.next.kind, "launch");
  assert.equal(limited.next.targetAction, "launch");
  assert.match(limited.next.actionTitle, /new run/i);
  assert.match(limited.recent.headline, /Codex · Failed/);
  assert.ok(limited.explore.lines.length >= 1);

  const system = buildSystemStripModel({
    dashboard: {
      activeRuns: [],
      providers: [
        { launchable: true },
        { launchable: true },
        { launchable: true },
        { launchable: false }
      ]
    },
    diagnostics: {
      diagnostics: { detected: 4 },
      capabilities: [{}, {}, {}, {}],
      intelligence: { summary: { localAvailable: false } }
    },
    readiness: limited.readiness
  });
  assert.match(system.rows.find((row) => row.key === "Health").value, /Limited/i);
});

test("formatHomeRecentRun keeps agent and result readable without leading technical ids", () => {
  const recent = formatHomeRecentRun({ runId: "abc123", agentId: "cursor", state: "succeeded" });
  assert.match(recent.headline, /Cursor · Succeeded/);
  assert.doesNotMatch(recent.headline, /abc123/);
});

test("windowLinesForLayout truncates long agent and diagnostic lists", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
  const windowed = windowLinesForLayout(lines, LAYOUT_MODES.MINIMAL);
  assert.ok(windowed.items.length < lines.length);
  assert.ok(windowed.moreLine);
});

test("footer and project name helpers", () => {
  const footer = buildFooterModel({ view: "home", unicode: false });
  assert.match(footer.text, /Navigate/);
  assert.match(footer.text, /Help/);
  assert.doesNotMatch(footer.text, /Tab/);
  const retry = buildFooterModel({ hasError: true, unicode: false });
  assert.match(retry.text, /Retry/);
  assert.equal(resolveProjectName("/tmp/agentic-harness"), "agentic-harness");
});
