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
  regionsForLayout,
  resolveProjectName
} from "../src/global/ink/cockpit-models.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";

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

test("top bar and nav models expose textual status", () => {
  const top = buildTopBarModel({ projectName: "agentic-harness", unicode: true });
  assert.equal(top.brand, "KAIRO");
  assert.equal(top.status, "ONLINE");
  assert.match(top.projectLabel, /agentic-harness/);

  const nav = buildNavModel({ navIndex: 0, focused: true });
  assert.equal(nav.title, "NAVIGATION");
  assert.equal(nav.items[0].selected, true);
  assert.ok(nav.items[0].marker.trim().length >= 1);
  assert.ok(COCKPIT_NAV.some((item) => item.id === "overview"));
});

test("system strip and home mission keep labels without relying on color", () => {
  const system = buildSystemStripModel({
    dashboard: { activeRuns: [], providers: [{ available: true }, { available: false }] },
    diagnostics: {
      diagnostics: { detected: 1 },
      capabilities: [{}, {}],
      intelligence: { summary: { localAvailable: true } }
    }
  });
  assert.equal(system.title, "SYSTEM");
  assert.ok(system.rows.every((row) => row.key && row.value));

  const mission = buildHomeMissionModel({
    hasGlobalState: false,
    diagnostics: { diagnostics: { detected: 0 } },
    dashboard: { providers: [], recentRuns: [] },
    layoutMode: LAYOUT_MODES.WIDE,
    activityLines: []
  });
  assert.equal(mission.title, "MISSION CONTROL");
  assert.match(mission.recommendedAction, /setup/i);
  assert.ok(mission.emptyHint);

  const long = buildHomeMissionModel({
    hasGlobalState: true,
    diagnostics: {
      diagnostics: { detected: 2, errors: 0 },
      intelligence: { summary: { localAvailable: true } },
      recommendations: []
    },
    dashboard: {
      providers: [{ launchable: true }],
      recentRuns: Array.from({ length: 20 }, (_, i) => `run-${i}`)
    },
    layoutMode: LAYOUT_MODES.MINIMAL,
    activityLines: Array.from({ length: 20 }, (_, i) => `line-${i}`)
  });
  assert.ok(long.moreLine);
});

test("footer and project name helpers", () => {
  const footer = buildFooterModel({ view: "home", unicode: false });
  assert.match(footer.text, /Navigate/);
  assert.match(footer.text, /Help/);
  assert.equal(resolveProjectName("/tmp/agentic-harness"), "agentic-harness");
});
