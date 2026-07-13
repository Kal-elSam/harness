import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { CockpitShell } from "../src/global/ink/cockpit/primitives.js";
import { HomeMissionPanel } from "../src/global/ink/cockpit-views.js";
import {
  buildFooterModel,
  buildHomeMissionModel,
  buildNavModel,
  buildSystemStripModel,
  buildTopBarModel
} from "../src/global/ink/cockpit-models.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";

function createMockStdout(columns = 120, rows = 40) {
  const stream = new PassThrough();
  stream.columns = columns;
  stream.rows = rows;
  stream.isTTY = true;
  stream.frames = [];
  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    stream.frames.push(String(chunk));
    return originalWrite(chunk, encoding, callback);
  };
  return stream;
}

function createMockStdin() {
  const stream = new PassThrough();
  stream.isTTY = true;
  stream.setRawMode = () => {};
  stream.ref = () => {};
  stream.unref = () => {};
  return stream;
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "");
}

test("cockpit shell wide frame exposes mission and system labels", async () => {
  const stdout = createMockStdout(120, 40);
  const stdin = createMockStdin();

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
    layoutMode: LAYOUT_MODES.WIDE,
    activityLines: []
  });
  const footer = buildFooterModel({ view: "home" });

  const instance = render(
    React.createElement(CockpitShell, {
      topBar,
      footer,
      layoutMode: LAYOUT_MODES.WIDE,
      nav,
      system,
      navFocused: true,
      contentFocused: false,
      systemFocused: false,
      colorEnabled: true
    }, React.createElement(HomeMissionPanel, { model: mission })),
    { stdout, stdin, patchConsole: false, exitOnCtrlC: false }
  );

  await new Promise((resolve) => setTimeout(resolve, 80));
  const frame = stripAnsi(stdout.frames.join(""));
  assert.match(frame, /KAIRO/);
  assert.match(frame, /ONLINE/);
  assert.match(frame, /MISSION CONTROL/);
  assert.match(frame, /NAVIGATION/);
  assert.match(frame, /SYSTEM/);
  assert.match(frame, /Recommended action/i);
  instance.unmount();
  stdin.end();
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
