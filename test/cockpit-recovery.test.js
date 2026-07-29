import test from "node:test";
import assert from "node:assert/strict";
import {
  RECOVERY_PHASE,
  buildRecoveryFooterParts,
  createRecoveryActionState,
  formatRecoveryLines,
  reduceRecoveryAction
} from "../src/global/ink/cockpit-recovery.js";
import { buildFooterModel } from "../src/global/ink/cockpit-models.js";
import { isContentInteractiveView } from "../src/global/ink/cockpit-focus.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";

test("recovery preview → confirm → cancel keeps prior snapshot operable", () => {
  let state = reduceRecoveryAction(createRecoveryActionState(), {
    type: "preview-start", snapshot: "snap-1"
  });
  state = reduceRecoveryAction(state, {
    type: "preview-ready",
    preview: {
      snapshot: "snap-1",
      noop: false,
      files: [{ displayPath: "~/.cursor/AGENTS.md" }],
      fingerprint: "abc"
    }
  });
  assert.equal(state.phase, RECOVERY_PHASE.CONFIRMING);
  const cancelled = reduceRecoveryAction(state, { type: "cancel" });
  assert.equal(cancelled.phase, RECOVERY_PHASE.IDLE);
  assert.match(cancelled.message, /previous snapshot kept/i);
  assert.deepEqual(
    reduceRecoveryAction(state, { type: "cancel" }),
    reduceRecoveryAction(state, { type: "cancel" })
  );
});

test("failed apply retains preview; Activity is content-interactive; footer phase keys", () => {
  const confirming = reduceRecoveryAction(createRecoveryActionState(), {
    type: "preview-ready",
    preview: { snapshot: "s", files: [], fingerprint: "f" }
  });
  const failed = reduceRecoveryAction(
    reduceRecoveryAction(confirming, { type: "apply-start" }),
    {
      type: "apply-done",
      ok: false,
      reason: "apply-failed",
      message: "boom",
      preview: confirming.preview
    }
  );
  assert.equal(failed.phase, RECOVERY_PHASE.FAILED);
  assert.equal(failed.preview?.snapshot, "s");
  assert.equal(isContentInteractiveView(ORCHESTRATOR_VIEWS.ACTIVITY), true);

  const footer = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.ACTIVITY,
    recoveryPhase: RECOVERY_PHASE.CONFIRMING,
    unicode: false
  });
  assert.deepEqual(buildRecoveryFooterParts(RECOVERY_PHASE.CONFIRMING), ["Y Restore", "N/Esc Cancel"]);
  assert.match(footer.text, /Y Restore/);

  const lines = formatRecoveryLines({
    snapshot: { backups: { count: 1, snapshots: [{ name: "s1", fileCount: 2 }] }, history: { events: [] } },
    recoveryAction: {
      phase: RECOVERY_PHASE.COMPLETED,
      receipt: { action: "rollback", safetyBackup: "safe", restored: ["~/.cursor/AGENTS.md"] }
    },
    listIndex: 0
  });
  assert.ok(lines.some((line) => line.includes("Safety backup retained")));
  assert.ok(lines.some((line) => line.includes("› s1")));
  assert.ok(lines.some((line) => line.includes("RECENT")));
});

test("activity lists when · what · result without dumping restore paths by default", () => {
  const lines = formatRecoveryLines({
    snapshot: {
      history: {
        events: [{
          timestamp: "2026-07-29T12:00:00.000Z",
          command: "sync",
          action: "applied"
        }]
      },
      backups: { count: 0, snapshots: [] }
    },
    dashboard: {
      recentRuns: [{ agentId: "codex", state: "succeeded", endedAt: "2026-07-29T12:05:00.000Z" }]
    },
    recoveryAction: { phase: RECOVERY_PHASE.IDLE }
  });
  const text = lines.join("\n");
  assert.match(text, /sync · ok/);
  assert.match(text, /codex · succeeded/);
  assert.doesNotMatch(text, /Fingerprint|displayPath|\/Users\//);
});

test("restore confirm DETAILS distinguishes duplicate basenames with ~/ paths", () => {
  const lines = formatRecoveryLines({
    homeDir: "/Users/me",
    snapshot: { history: { events: [] }, backups: { count: 0, snapshots: [] } },
    recoveryAction: {
      phase: RECOVERY_PHASE.CONFIRMING,
      message: "Confirm restore? Y restore · N/Esc cancel",
      preview: {
        snapshot: "s1",
        files: [
          { displayPath: "/Users/me/.cursor/AGENTS.md" },
          { displayPath: "/Users/me/.codex/AGENTS.md" }
        ]
      }
    }
  });
  const text = lines.join("\n");
  assert.match(text, /DETAILS/);
  assert.match(text, /~\/\.cursor\/AGENTS\.md/);
  assert.match(text, /~\/\.codex\/AGENTS\.md/);
  assert.doesNotMatch(text, /^AGENTS\.md$/m);
});
