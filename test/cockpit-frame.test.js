import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFooterModel,
  buildHomeMissionModel,
  buildNavModel,
  buildTopBarModel
} from "../src/global/ink/cockpit-models.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";
import { regionsForLayout, COCKPIT_REGIONS } from "../src/global/ink/cockpit-models.js";

/**
 * Semantic frame capture without Ink paint timing.
 * Joins presentational models the single-panel shell renders so CI stays deterministic.
 */
function composeCockpitFrame({ layoutMode = LAYOUT_MODES.WIDE, columns = 80 } = {}) {
  const topBar = buildTopBarModel({ projectName: "agentic-harness" });
  const nav = buildNavModel({
    navIndex: 0,
    currentView: ORCHESTRATOR_VIEWS.HOME,
    focused: true
  });
  const mission = buildHomeMissionModel({
    projectName: "agentic-harness",
    hasGlobalState: true,
    diagnostics: {
      diagnostics: { detected: 4, errors: 0 },
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
    layoutMode
  });
  const footer = buildFooterModel({ view: "home", columns });
  const stripLabels = nav.items.map((item) => {
    const compact = layoutMode !== LAYOUT_MODES.WIDE;
    const label = compact
      ? item.label.split(/[&·]/)[0].trim().split(/\s+/)[0]
      : item.label;
    return `${item.marker}${label}`;
  });

  const lines = [
    `${topBar.brand} ${topBar.status} ${topBar.projectLabel}`,
    `NAVSTRIP ${stripLabels.join(" · ")}`,
    nav.explanation,
    mission.title,
    mission.purpose,
    mission.readiness.headline,
    mission.readiness.summaryLine,
    ...(mission.readiness.capabilityLines ?? []),
    mission.next.title,
    mission.next.actionTitle,
    mission.next.actionDetail,
    mission.next.enterHint,
    mission.recent.title,
    mission.recent.headline ?? mission.recent.emptyHint,
    mission.explore.title,
    ...mission.explore.lines,
    footer.text,
    `FOOTER_COLS ${footer.columns}`
  ].filter(Boolean);

  return lines.join("\n");
}

function assertCriticalHomeParity(frame) {
  assert.match(frame, /KAIRO/);
  assert.match(frame, /HOME — agentic-harness/);
  assert.match(frame, /coordina/i);
  assert.match(frame, /READY TO WORK|LIMITED|NEEDS /i);
  assert.match(frame, /agents ready/);
  assert.match(frame, /NEXT/);
  assert.match(frame, /Create a new run|Finish local setup|Review system health/i);
  assert.match(frame, /Enter →/);
  assert.match(frame, /RECENT/);
  assert.match(frame, /Last run · Codex · Failed|No runs yet/);
}

test("cockpit shell wide frame uses nav strip and single panel without SYSTEM", () => {
  const frame = composeCockpitFrame({ layoutMode: LAYOUT_MODES.WIDE, columns: 120 });
  assertCriticalHomeParity(frame);
  assert.match(frame, /ONLINE|Offline/);
  assert.match(frame, /NAVSTRIP/);
  assert.match(frame, /Overview/);
  assert.match(frame, /Orchestration|Governance|Activity|Runs/);
  assert.doesNotMatch(frame, /\bSYSTEM\b/);
  assert.doesNotMatch(frame, /MISSION CONTROL/);
  assert.deepEqual(regionsForLayout(LAYOUT_MODES.WIDE), [
    COCKPIT_REGIONS.NAV,
    COCKPIT_REGIONS.CONTENT
  ]);
  assert.match(frame, /FOOTER_COLS 120/);
});

test("cockpit compact 80x24 frame keeps nav strip without system column", () => {
  const frame = composeCockpitFrame({ layoutMode: LAYOUT_MODES.COMPACT, columns: 80 });
  assertCriticalHomeParity(frame);
  assert.match(frame, /NAVSTRIP/);
  assert.match(frame, /Overview · /);
  assert.doesNotMatch(frame, /\bSYSTEM\b/);
  assert.match(frame, /FOOTER_COLS 80/);
});

test("cockpit minimal frame keeps critical Home information", () => {
  const frame = composeCockpitFrame({ layoutMode: LAYOUT_MODES.MINIMAL, columns: 64 });
  assertCriticalHomeParity(frame);
  assert.match(frame, /Intelligence: Optional capability not configured/);
  assert.doesNotMatch(frame, /\bSYSTEM\b/);
});

test("cockpit home mission model stays textual under NO_COLOR assumptions", () => {
  const mission = buildHomeMissionModel({
    projectName: "demo",
    hasGlobalState: true,
    diagnostics: {
      diagnostics: { detected: 1, errors: 0 },
      intelligence: { summary: { localAvailable: true } },
      recommendations: []
    },
    dashboard: { providers: [{ launchable: true }], recentRuns: [] },
    layoutMode: LAYOUT_MODES.COMPACT
  });
  assert.match(mission.next.actionTitle, /new run/i);
  assert.equal(mission.next.targetAction, "launch");
  assert.ok(mission.recent.emptyHint || mission.recent.headline);
});
