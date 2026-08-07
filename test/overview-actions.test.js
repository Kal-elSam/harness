import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOverviewButtons,
  OVERVIEW_BUTTON_COUNT
} from "../src/global/ink/ux/overview-actions.js";

test("buildOverviewButtons always returns prepare + configure", () => {
  const buttons = buildOverviewButtons();
  assert.equal(buttons.length, OVERVIEW_BUTTON_COUNT);
  assert.equal(buttons[0].id, "prepare");
  assert.equal(buttons[1].id, "configure");
  assert.equal(buttons[1].intent, "settings");
  assert.match(buttons[1].label, /Configure/i);
});

test("prepare button asks to set up when no agents are detected", () => {
  const noState = buildOverviewButtons({ hasGlobalState: false });
  assert.equal(noState[0].intent, "setup");
  assert.match(noState[0].label, /Set up Kairo/i);

  const zeroDetected = buildOverviewButtons({
    hasGlobalState: true,
    diagnostics: { diagnostics: { detected: 0 } }
  });
  assert.equal(zeroDetected[0].intent, "setup");
});

test("prepare button repairs drift when changes are pending", () => {
  const buttons = buildOverviewButtons({
    hasGlobalState: true,
    snapshot: {
      coverage: { detectedAgents: 2 },
      diff: { hasChanges: true, changeCount: 3 }
    }
  });
  assert.equal(buttons[0].intent, "governance");
  assert.match(buttons[0].label, /Repair 3 change/i);
  assert.match(buttons[0].detail, /exact plan/i);
});

test("prepare button reports ready when drift is clean", () => {
  const buttons = buildOverviewButtons({
    hasGlobalState: true,
    snapshot: {
      coverage: { detectedAgents: 2 },
      diff: { hasChanges: false }
    },
    diagnostics: { diagnostics: { detected: 2 } }
  });
  assert.equal(buttons[0].intent, "history");
  assert.match(buttons[0].label, /ready/i);
});
