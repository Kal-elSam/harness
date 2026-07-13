#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLayoutMode, LAYOUT_MODES } from "../src/global/ink/layout.js";
import { resolveTerminalCapabilities } from "../src/global/ink/terminal-capabilities.js";
import { createFullscreenSession } from "../src/global/ink/fullscreen-session.js";
import { buildTopBarModel, buildHomeMissionModel } from "../src/global/ink/cockpit-models.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pkg = require(join(root, "package.json"));

assert.equal(pkg.version, "0.3.0");
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

console.log("cockpit smoke OK");
