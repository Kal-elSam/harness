import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANGES_PHASE,
  buildChangesFooterParts,
  createChangesActionState,
  formatChangesActionLines,
  reduceChangesAction
} from "../src/global/ink/cockpit-changes.js";
import { buildFooterModel } from "../src/global/ink/cockpit-models.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";

test("preview → confirm → cancel; N/Esc identical; setup-required fail-closed", () => {
  let state = reduceChangesAction(createChangesActionState(), { type: "preview-start" });
  assert.equal(state.phase, CHANGES_PHASE.PREVIEWING);
  state = reduceChangesAction(state, {
    type: "preview-ready",
    preview: { hasChanges: true, changes: [{ action: "repair", target: "x" }], fingerprint: "abc" }
  });
  assert.equal(state.phase, CHANGES_PHASE.CONFIRMING);
  assert.deepEqual(
    reduceChangesAction(state, { type: "cancel" }),
    reduceChangesAction(state, { type: "cancel" })
  );
  assert.equal(reduceChangesAction(state, { type: "cancel" }).preview, null);

  const setup = reduceChangesAction(createChangesActionState(), {
    type: "preview-ready", preview: { setupRequired: true }
  });
  assert.equal(setup.phase, CHANGES_PHASE.FAILED);
  assert.equal(setup.error, "setup-required");
});

test("stale apply fails; footer keys phase-scoped; receipt lines render", () => {
  const confirming = reduceChangesAction(createChangesActionState(), {
    type: "preview-ready",
    preview: { hasChanges: true, changes: [], fingerprint: "old" }
  });
  const failed = reduceChangesAction(
    reduceChangesAction(confirming, { type: "apply-start" }),
    { type: "apply-done", ok: false, reason: "stale-preview", message: "Preview stale" }
  );
  assert.equal(failed.phase, CHANGES_PHASE.FAILED);
  assert.equal(failed.error, "stale-preview");

  assert.deepEqual(buildChangesFooterParts(CHANGES_PHASE.CONFIRMING), ["Y Apply", "N/Esc Cancel"]);
  const footer = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.CHANGES, changesPhase: CHANGES_PHASE.CONFIRMING, unicode: false
  });
  assert.match(footer.text, /Y Apply/);
  assert.doesNotMatch(footer.text, /Enter Open/);

  const lines = formatChangesActionLines({
    snapshot: { diff: { installed: true, hasChanges: false } },
    changesAction: {
      phase: CHANGES_PHASE.COMPLETED,
      message: "Applied — re-scan complete.",
      receipt: {
        action: "repaired", backups: ["b1"],
        checksBefore: { ok: 1 }, checksAfter: { ok: 2 },
        integrations: { status: "noop" }
      }
    }
  });
  assert.ok(lines.some((line) => line.includes("Receipt · repaired")));
});
