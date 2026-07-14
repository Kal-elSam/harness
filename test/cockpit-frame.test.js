import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFooterModel,
  buildHomeMissionModel,
  buildNavModel,
  buildSystemStripModel,
  buildTopBarModel
} from "../src/global/ink/cockpit-models.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";

/**
 * Semantic frame capture without Ink paint timing.
 * Joins presentational models the shell renders so CI stays deterministic.
 */
function composeCockpitFrame({ layoutMode = LAYOUT_MODES.WIDE } = {}) {
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
  const system = buildSystemStripModel({
    dashboard: {
      activeRuns: [],
      providers: [{ launchable: true }]
    },
    diagnostics: {
      diagnostics: { detected: 4 },
      capabilities: [{}, {}, {}, {}],
      intelligence: { summary: { localAvailable: false } }
    },
    readiness: mission.readiness
  });
  const footer = buildFooterModel({ view: "home" });

  const lines = [
    `${topBar.brand} ${topBar.status} ${topBar.projectLabel}`,
    nav.title,
    ...nav.items.map((item) => `${item.marker} ${item.label}`),
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
    layoutMode === LAYOUT_MODES.WIDE ? system.title : null,
    ...(layoutMode === LAYOUT_MODES.WIDE
      ? system.rows.map((row) => `${row.key} ${row.value}`)
      : []),
    footer.text
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

test("cockpit shell wide frame exposes Home, readiness, and system labels", () => {
  const frame = composeCockpitFrame({ layoutMode: LAYOUT_MODES.WIDE });
  assertCriticalHomeParity(frame);
  assert.match(frame, /ONLINE|Offline/);
  assert.match(frame, /NAVIGATION/);
  assert.match(frame, /Control center|HOME/);
  assert.match(frame, /Runs|Changes/);
  assert.match(frame, /SYSTEM/);
  assert.match(frame, /Health Limited|Health Ready|Health Needs/i);
  assert.doesNotMatch(frame, /MISSION CONTROL/);
});

test("cockpit compact frame keeps nav and embeds readiness without system strip", () => {
  const frame = composeCockpitFrame({ layoutMode: LAYOUT_MODES.COMPACT });
  assertCriticalHomeParity(frame);
  assert.match(frame, /NAVIGATION/);
  assert.doesNotMatch(frame, /^SYSTEM$/m);
});

test("cockpit minimal frame keeps critical Home information", () => {
  const frame = composeCockpitFrame({ layoutMode: LAYOUT_MODES.MINIMAL });
  assertCriticalHomeParity(frame);
  assert.match(frame, /Intelligence: Optional capability not configured/);
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
