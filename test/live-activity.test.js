import test from "node:test";
import assert from "node:assert/strict";
import {
  RECOVERY_PHASE, buildRecoveryFooterParts, createRecoveryActionState, reduceRecoveryAction
} from "../src/global/ink/cockpit-recovery.js";
import { createCockpitUiState, reduceCockpitUi } from "../src/global/ink/cockpit-controller.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";
import {
  activityContentLimits, adaptActivityModel, windowSlice
} from "../src/global/ink/ux/live-activity.js";
import { detailsPathLimit } from "../src/global/ink/ux/live-governance.js";

const snapshot = {
  history: {
    events: Array.from({ length: 6 }, (_, i) => ({
      timestamp: `2026-07-29T12:0${i}:00.000Z`, command: `cmd-${i}`, action: "applied"
    }))
  },
  backups: {
    count: 10,
    snapshots: Array.from({ length: 10 }, (_, i) => ({ name: `snap-${i}`, fileCount: i + 1 }))
  }
};
const previewFiles = Array.from({ length: 12 }, (_, i) => ({ displayPath: `/Users/me/.cursor/f-${i}.md` }));

test("adapter phases: snapshots own focus; paths only in Details/confirming", () => {
  const idle = adaptActivityModel({
    snapshot, recoveryAction: createRecoveryActionState(), listIndex: 1
  });
  assert.equal(idle.selectedIndex, 1);
  assert.equal(idle.detailsOpen, false);
  assert.equal(idle.showDetails, false);
  assert.doesNotMatch(JSON.stringify(idle.recent), /\/Users|\.cursor\/f-/);

  const confirming = adaptActivityModel({
    snapshot,
    recoveryAction: reduceRecoveryAction(createRecoveryActionState(), {
      type: "preview-ready",
      preview: { snapshot: "snap-0", files: previewFiles.slice(0, 2), fingerprint: "fp" }
    }),
    homeDir: "/Users/me", layoutMode: LAYOUT_MODES.COMPACT
  });
  assert.equal(confirming.phase, RECOVERY_PHASE.CONFIRMING);
  assert.equal(confirming.primary, null);
  assert.equal(confirming.confirm.primaryLabel, "Restore");
  assert.doesNotMatch(confirming.confirm.primaryLabel, /Y |N\/Esc/);
  assert.doesNotMatch(confirming.callout.body || "", /Y restore|N\/Esc/i);
  assert.ok(confirming.details.some((l) => /~\/\.cursor/.test(l)));

  const working = adaptActivityModel({
    snapshot, recoveryAction: { phase: RECOVERY_PHASE.PREVIEWING, message: "Previewing…", preview: null }
  });
  assert.equal(working.primary, null);
  assert.match(working.callout.title, /Previewing/);
});

test("message ownership + Space only when preview exists", () => {
  const confirming = adaptActivityModel({
    snapshot,
    recoveryAction: {
      phase: RECOVERY_PHASE.CONFIRMING,
      message: "Confirm restore? Y restore · N/Esc cancel",
      preview: { snapshot: "s", files: previewFiles.slice(0, 1) }
    }
  });
  const blobs = [
    confirming.callout.title, confirming.callout.body,
    confirming.confirm.summary, confirming.confirm.primaryLabel
  ].join("\n");
  assert.doesNotMatch(blobs, /Y restore|N\/Esc cancel/i);
  assert.deepEqual(buildRecoveryFooterParts(RECOVERY_PHASE.CONFIRMING), ["Y Restore", "N/Esc Cancel", "Space"]);
  assert.ok(!buildRecoveryFooterParts(RECOVERY_PHASE.IDLE).includes("Space"));
  assert.ok(buildRecoveryFooterParts(RECOVERY_PHASE.IDLE, { hasPreview: true }).includes("Space"));

  let s = createCockpitUiState({ view: ORCHESTRATOR_VIEWS.ACTIVITY, navIndex: 2 });
  s = reduceCockpitUi(s, { type: "toggle-activity-details" });
  assert.equal(s.activityDetailsOpen, true);
  s = reduceCockpitUi(s, { type: "escape" });
  assert.equal(s.activityDetailsOpen, false);
});

test("content caps: visual window keeps deep listIndex reachable", () => {
  assert.deepEqual(activityContentLimits(LAYOUT_MODES.COMPACT), { events: 3, snapshots: 3 });
  assert.equal(detailsPathLimit(LAYOUT_MODES.WIDE), 12);
  assert.equal(windowSlice(snapshot.backups.snapshots, 9, 3).items[2].name, "snap-9");

  const deep = adaptActivityModel({
    snapshot, recoveryAction: createRecoveryActionState(),
    listIndex: 9, layoutMode: LAYOUT_MODES.COMPACT
  });
  assert.equal(deep.snapshots.length, 3);
  assert.equal(deep.snapshotTotal, 10);
  assert.equal(deep.focusedSnapshot, "snap-9");
  assert.equal(deep.snapshots[deep.selectedIndex].id, "snap-9");
  assert.equal(deep.recent.length, 3);

  const wideDeep = adaptActivityModel({
    snapshot, recoveryAction: createRecoveryActionState(),
    listIndex: 9, layoutMode: LAYOUT_MODES.WIDE
  });
  assert.equal(wideDeep.snapshots.length, 8);
  assert.equal(wideDeep.focusedSnapshot, "snap-9");
  assert.equal(wideDeep.snapshots[wideDeep.selectedIndex].id, "snap-9");

  const open = adaptActivityModel({
    snapshot,
    recoveryAction: { phase: RECOVERY_PHASE.IDLE, preview: { snapshot: "s", files: previewFiles } },
    detailsOpen: true, layoutMode: LAYOUT_MODES.COMPACT, homeDir: "/Users/me"
  });
  assert.equal(open.details.filter((l) => /~\/\.cursor/.test(l)).length, 3);
  assert.ok(open.details.some((l) => /… 9 more/.test(l)));
});
