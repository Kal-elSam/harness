import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANGES_PHASE,
  buildChangesFooterParts,
  createChangesActionState,
  reduceChangesAction
} from "../src/global/ink/cockpit-changes.js";
import { createCockpitUiState, reduceCockpitUi } from "../src/global/ink/cockpit-controller.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";
import { adaptGovernanceModel, detailsPathLimit } from "../src/global/ink/ux/live-governance.js";

const snapshot = {
  health: "ACTION_REQUIRED",
  coverage: { governedAgents: 1, detectedAgents: 3, components: 2 },
  cta: { title: "Review and repair drift", detail: "Preview repairs first.", destination: "changes" },
  diff: {
    installed: true, hasChanges: true, changeCount: 2,
    changes: [{ action: "repair", target: "/Users/me/.cursor/AGENTS.md" }]
  }
};

function manyChanges(n) {
  return Array.from({ length: n }, (_, i) => ({ action: "repair", target: `/Users/me/.cursor/f-${i}.md` }));
}

test("adapter covers all governance phases without paths outside Details", () => {
  const idle = adaptGovernanceModel({ snapshot, changesAction: createChangesActionState() });
  assert.equal(idle.phase, CHANGES_PHASE.IDLE);
  assert.match(idle.primary.label, /Review and repair/);
  assert.equal(idle.primary.detail, "Preview repairs first.");
  assert.equal(idle.callout.body, "");
  assert.doesNotMatch(JSON.stringify(idle.metrics), /\/Users|\.cursor/);
  assert.equal(idle.detailsOpen, false);

  const previewing = adaptGovernanceModel({
    snapshot, changesAction: reduceChangesAction(createChangesActionState(), { type: "preview-start" })
  });
  assert.equal(previewing.primary, null);
  assert.match(previewing.callout.title, /Previewing/);

  const confirming = adaptGovernanceModel({
    snapshot,
    changesAction: reduceChangesAction(createChangesActionState(), {
      type: "preview-ready",
      preview: { hasChanges: true, changes: snapshot.diff.changes, fingerprint: "fp" }
    })
  });
  assert.equal(confirming.phase, CHANGES_PHASE.CONFIRMING);
  assert.equal(confirming.primary, null);
  assert.equal(confirming.confirm.primaryLabel, "Apply");
  assert.doesNotMatch(confirming.confirm.primaryLabel, /Y |N\/Esc/);
  assert.ok(confirming.details.some((line) => /repair/.test(line)));

  const applying = adaptGovernanceModel({
    snapshot, changesAction: { phase: CHANGES_PHASE.APPLYING, message: "Applying…", preview: null }
  });
  assert.equal(applying.primary, null);
  assert.match(applying.callout.title, /Applying/);

  const completed = adaptGovernanceModel({
    snapshot: { ...snapshot, diff: { installed: true, hasChanges: false } },
    changesAction: {
      phase: CHANGES_PHASE.COMPLETED,
      receipt: { action: "repaired", backups: ["b1"], checksBefore: { ok: 1 }, checksAfter: { ok: 2 } }
    },
    detailsOpen: true
  });
  assert.ok(completed.metrics.some((m) => /Result · repaired/.test(m.label)));
  assert.ok(completed.details.some((line) => /Checks · before/.test(line)));

  const failed = adaptGovernanceModel({
    snapshot, changesAction: { phase: CHANGES_PHASE.FAILED, error: "setup-required", message: "Not configured" }
  });
  assert.equal(failed.callout.tone, "danger");
  assert.match(failed.callout.title, /Setup required/i);
  assert.match(failed.callout.body, /Not configured|setup/i);
});

test("message ownership: Callout status, Confirm action, footer keys", () => {
  const confirming = adaptGovernanceModel({
    snapshot,
    changesAction: {
      phase: CHANGES_PHASE.CONFIRMING,
      message: "Confirm apply? Y apply · N/Esc cancel",
      preview: { hasChanges: true, changes: snapshot.diff.changes }
    }
  });
  const blobs = [
    confirming.callout.title, confirming.callout.body,
    confirming.confirm.summary, confirming.confirm.primaryLabel
  ].join("\n");
  assert.doesNotMatch(blobs, /Y apply|N\/Esc cancel/i);
  assert.match(confirming.confirm.summary, /Apply 1 planned/);
  assert.deepEqual(buildChangesFooterParts(CHANGES_PHASE.CONFIRMING), ["Y Apply", "N/Esc Cancel", "Space"]);
  const idle = adaptGovernanceModel({ snapshot, changesAction: createChangesActionState() });
  assert.equal(idle.callout.body, "");
  assert.notEqual(idle.callout.title, idle.primary.label);
});

test("Details path cap: compact 3 + remainder, wide 12", () => {
  assert.equal(detailsPathLimit(LAYOUT_MODES.COMPACT), 3);
  assert.equal(detailsPathLimit(LAYOUT_MODES.WIDE), 12);
  const changes = manyChanges(12);
  const snap = { ...snapshot, diff: { ...snapshot.diff, changeCount: 12, changes } };
  const compact = adaptGovernanceModel({
    snapshot: snap, changesAction: createChangesActionState(),
    detailsOpen: true, layoutMode: LAYOUT_MODES.COMPACT, homeDir: "/Users/me"
  });
  assert.equal(compact.details.filter((l) => /repair ·/.test(l)).length, 3);
  assert.ok(compact.details.some((l) => /… 9 more/.test(l)));
  const wide = adaptGovernanceModel({
    snapshot: snap, changesAction: createChangesActionState(),
    detailsOpen: true, layoutMode: LAYOUT_MODES.WIDE, homeDir: "/Users/me"
  });
  assert.equal(wide.details.filter((l) => /repair ·/.test(l)).length, 12);
  assert.equal(wide.details.some((l) => /… /.test(l)), false);
});

test("Space toggles Details; Esc closes; footer phase-scoped", () => {
  let s = createCockpitUiState({ view: ORCHESTRATOR_VIEWS.CHANGES, navIndex: 1 });
  s = reduceCockpitUi(s, { type: "toggle-governance-details" });
  assert.equal(s.governanceDetailsOpen, true);
  s = reduceCockpitUi(s, { type: "escape" });
  assert.equal(s.governanceDetailsOpen, false);
  assert.equal(s.view, ORCHESTRATOR_VIEWS.CHANGES);
  assert.ok(buildChangesFooterParts(CHANGES_PHASE.IDLE).includes("Space"));
  const open = adaptGovernanceModel({
    snapshot, changesAction: createChangesActionState(), detailsOpen: true, homeDir: "/Users/me"
  });
  assert.ok(open.details.some((line) => /AGENTS\.md|repair/.test(line)));
  assert.doesNotMatch(JSON.stringify(open.metrics), /\/Users\/me\/\.cursor/);
});
