#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLayoutMode, LAYOUT_MODES } from "../src/global/ink/layout.js";
import { resolveTerminalCapabilities } from "../src/global/ink/terminal-capabilities.js";
import { createFullscreenSession } from "../src/global/ink/fullscreen-session.js";
import {
  buildFooterModel,
  buildHomeMissionModel,
  buildTopBarModel,
  COCKPIT_NAV,
  COCKPIT_REGIONS
} from "../src/global/ink/cockpit-models.js";
import {
  createCockpitUiState,
  reduceCockpitUi,
  routeCockpitKey
} from "../src/global/ink/cockpit-controller.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pkg = require(join(root, "package.json"));

assert.equal(pkg.version, "0.3.1");
assert.ok(pkg.dependencies["ansi-escapes"]);

assert.equal(resolveLayoutMode({ columns: 120, rows: 40 }), LAYOUT_MODES.WIDE);
assert.equal(resolveLayoutMode({ columns: 80, rows: 24 }), LAYOUT_MODES.COMPACT);
assert.equal(resolveLayoutMode({ columns: 65, rows: 24 }), LAYOUT_MODES.MINIMAL);
assert.equal(resolveLayoutMode({ columns: 50, rows: 24 }), null);

const caps = resolveTerminalCapabilities({
  columns: 80,
  rows: 24,
  isTTY: true,
  term: "xterm-256color",
  env: { NO_COLOR: "1" }
});
assert.equal(caps.color, false);
assert.equal(caps.canUseInk, true);

const session = createFullscreenSession({
  stdout: { isTTY: true, write: () => true },
  processRef: { on() {}, removeListener() {}, exit() {} },
  onSignal: () => {}
});
assert.equal(session.enter(), true);
assert.equal(session.leave(), true);
assert.equal(session.leave(), false);

const top = buildTopBarModel({ projectName: "smoke" });
assert.match(top.status, /ONLINE|Offline/);
const mission = buildHomeMissionModel({
  hasGlobalState: false,
  diagnostics: { diagnostics: { detected: 0 } },
  dashboard: { providers: [], recentRuns: [] }
});
assert.match(mission.title, /MISSION CONTROL/);

function applyKey(state, keyAction) {
  const routed = routeCockpitKey(state, keyAction);
  if (!routed) return state;
  return reduceCockpitUi(state, routed);
}

function smokeNavigation(layoutMode) {
  let state = createCockpitUiState({
    layoutMode,
    region: layoutMode === LAYOUT_MODES.MINIMAL ? COCKPIT_REGIONS.CONTENT : COCKPIT_REGIONS.NAV
  });
  const diagnosticsIndex = COCKPIT_NAV.findIndex((item) => item.id === "diagnostics");
  while (state.navIndex < diagnosticsIndex) {
    state = applyKey(state, { type: "arrow", direction: "down" });
  }
  state = applyKey(state, { type: "enter" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.DIAGNOSTICS);
  assert.equal(state.region, COCKPIT_REGIONS.NAV);

  state = applyKey(state, { type: "arrow", direction: "up" });
  state = applyKey(state, { type: "enter" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.LAUNCH);
  assert.equal(state.region, COCKPIT_REGIONS.CONTENT);

  const footer = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.DIAGNOSTICS,
    region: COCKPIT_REGIONS.NAV,
    unicode: false
  });
  assert.doesNotMatch(footer.text, /Tab/);

  state = applyKey(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HOME);
  state = applyKey(state, { type: "escape" });
  assert.equal(state.shouldExit, true);
}

smokeNavigation(LAYOUT_MODES.WIDE);
smokeNavigation(LAYOUT_MODES.COMPACT);

console.log("cockpit smoke OK");
