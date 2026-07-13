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

/**
 * Semantic frame capture without Ink paint timing.
 * Joins presentational models the shell renders so CI stays deterministic.
 */
function composeCockpitFrame({ layoutMode = LAYOUT_MODES.WIDE } = {}) {
  const topBar = buildTopBarModel({ projectName: "agentic-harness" });
  const nav = buildNavModel({ navIndex: 0, focused: true });
  const system = buildSystemStripModel({
    dashboard: { activeRuns: [], providers: [] },
    diagnostics: { diagnostics: { detected: 0 }, capabilities: [] }
  });
  const mission = buildHomeMissionModel({
    hasGlobalState: false,
    diagnostics: { diagnostics: { detected: 0 } },
    dashboard: { providers: [], recentRuns: [] },
    layoutMode,
    activityLines: []
  });
  const footer = buildFooterModel({ view: "home" });

  const lines = [
    `${topBar.brand} ${topBar.status} ${topBar.projectLabel}`,
    nav.title,
    ...nav.items.map((item) => `${item.marker} ${item.label}`),
    mission.title,
    mission.recommendedTitle,
    mission.recommendedAction,
    mission.activityTitle,
    mission.emptyHint,
    layoutMode === LAYOUT_MODES.WIDE ? system.title : null,
    ...(layoutMode === LAYOUT_MODES.WIDE
      ? system.rows.map((row) => `${row.key} ${row.value}`)
      : []),
    footer.text
  ].filter(Boolean);

  return lines.join("\n");
}

test("cockpit shell wide frame exposes mission and system labels", () => {
  const frame = composeCockpitFrame({ layoutMode: LAYOUT_MODES.WIDE });
  assert.match(frame, /KAIRO/);
  assert.match(frame, /ONLINE/);
  assert.match(frame, /MISSION CONTROL/);
  assert.match(frame, /NAVIGATION/);
  assert.match(frame, /SYSTEM/);
  assert.match(frame, /Recommended action/i);
  assert.match(frame, /agentic-harness/);
});

test("cockpit compact frame keeps nav and omits system strip", () => {
  const frame = composeCockpitFrame({ layoutMode: LAYOUT_MODES.COMPACT });
  assert.match(frame, /NAVIGATION/);
  assert.match(frame, /MISSION CONTROL/);
  assert.doesNotMatch(frame, /^SYSTEM$/m);
});

test("cockpit home mission model stays textual under NO_COLOR assumptions", () => {
  const mission = buildHomeMissionModel({
    hasGlobalState: true,
    diagnostics: {
      diagnostics: { detected: 1, errors: 0 },
      intelligence: { summary: { localAvailable: true } },
      recommendations: []
    },
    dashboard: { providers: [{ launchable: true }], recentRuns: [] },
    layoutMode: LAYOUT_MODES.COMPACT,
    activityLines: []
  });
  assert.match(mission.recommendedAction, /Launch|launch|run/i);
  assert.ok(mission.emptyHint || mission.activityLines);
});
