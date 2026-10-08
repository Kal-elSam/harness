import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_PHASE,
  createSettingsActionState,
  formatSettingsDetailLines,
  formatSettingsLines,
  getCuratedIntegration,
  listCuratedIntegrations,
  reduceSettingsAction
} from "../src/global/operations/settings-model.js";
import {
  RECOVERY_PHASE,
  createRecoveryActionState,
  formatRecoveryLines,
  reduceRecoveryAction
} from "../src/global/operations/recovery-model.js";
import {
  CONTROL_PLANE_AUTO_SCAN,
  createSerializedReloader,
  loadCockpitScanBundle
} from "../src/global/operations/scan-bundle.js";
import { formatUsageLines } from "../src/global/operations/usage-model.js";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";

// Scenarios moved from the retired cockpit-settings / cockpit-recovery / cockpit-control-center
// tests. Bodies are unchanged unless noted; the legacy footer, focus and TTY-fold assertions
// were dropped with the code they exercised.

test("catalog pins pi-usage-widget@0.2.1; install never implied", () => {
  const catalog = listCuratedIntegrations();
  assert.equal(catalog.length, 1);
  const entry = getCuratedIntegration("pi-usage-widget");
  assert.equal(entry?.version, "0.2.1");
  assert.equal(entry?.license, "MIT");
  assert.match(entry?.notes ?? "", /Explicit install only/i);
  assert.ok(entry?.permissions.includes("full-local-access-on-install"));
});

test("browse → preview → confirm → receipt; wroteFiles stays false", () => {
  let state = createSettingsActionState();
  assert.equal(state.phase, SETTINGS_PHASE.BROWSE);

  state = reduceSettingsAction(state, { type: "preview", id: "missing" });
  assert.equal(state.phase, SETTINGS_PHASE.BROWSE);
  assert.match(state.message ?? "", /not found/i);

  state = reduceSettingsAction(state, { type: "preview", id: "pi-usage-widget" });
  assert.equal(state.phase, SETTINGS_PHASE.PREVIEW);
  assert.equal(state.selectedId, "pi-usage-widget");
  assert.equal(state.receipt, null);

  assert.equal(
    reduceSettingsAction(state, { type: "confirm" }).phase,
    SETTINGS_PHASE.PREVIEW
  );

  state = reduceSettingsAction(state, { type: "confirm-prompt" });
  assert.equal(state.phase, SETTINGS_PHASE.CONFIRMING);

  const cancel = reduceSettingsAction(state, { type: "cancel" });
  assert.equal(cancel.phase, SETTINGS_PHASE.BROWSE);
  assert.equal(cancel.selectedId, null);
  assert.match(cancel.message ?? "", /no files written/i);

  state = reduceSettingsAction(state, { type: "confirm" });
  assert.equal(state.phase, SETTINGS_PHASE.COMPLETED);
  assert.equal(state.receipt?.wroteFiles, false);
  assert.equal(state.receipt?.id, "pi-usage-widget");
  assert.equal(state.receipt?.version, "0.2.1");
  assert.ok(state.receipt?.confirmedAt);

  const detail = formatSettingsDetailLines(
    getCuratedIntegration("pi-usage-widget"),
    state
  );
  const detailText = detail.join("\n");
  assert.match(detailText, /wroteFiles · false/);
  assert.match(detailText, /no auto-install/i);
  assert.doesNotMatch(detailText, /wroteFiles · true/);
  assert.equal(detail[0], "RESULT");
  assert.match(detail[3] ?? "", /wroteFiles · false/);
});

test("completed receipt renders compactly (moved: content assertions only; the legacy TTY fold windowing was dropped)", () => {
  const completed = reduceSettingsAction(
    reduceSettingsAction(
      reduceSettingsAction(createSettingsActionState(), {
        type: "preview",
        id: "pi-usage-widget"
      }),
      { type: "confirm-prompt" }
    ),
    { type: "confirm" }
  );
  const lines = formatSettingsDetailLines(
    getCuratedIntegration("pi-usage-widget"),
    completed
  );
  const visible = lines.join("\n");
  assert.match(visible, /wroteFiles · false/);
  assert.match(visible, /^RESULT/m);
  assert.ok(lines.length <= 8, `completed view should stay compact (${lines.length})`);
});

test("browse marks selection (moved: footer and focus assertions dropped)", () => {
  const browse = formatSettingsLines({ listIndex: 0 }).join("\n");
  assert.match(browse, /› available · Pi usage widget · 0\.2\.1/);
  assert.match(browse, /Selected · pi-usage-widget/);
  assert.match(browse, /never automatic/i);
});

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

test("failed apply retains preview and the activity view lists the safety backup (moved: footer and focus assertions dropped)", () => {
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

test("usage lines with real profile shape show configured limits", () => {
  const empty = formatUsageLines({});
  assert.match(empty.join("\n"), /MEASURED/);
  assert.match(empty.join("\n"), /Data unavailable/);
  assert.match(empty.join("\n"), /No profile token budgets configured/);

  const lines = formatUsageLines({
    dashboard: {
      profile: {
        profile: { tokenBudget: 8000, stableContextBudget: 4000 },
        sources: { global: "/home/.harness/profile.json", project: null }
      },
      recentRuns: [{ agentId: "codex", tokenUsage: { input: 10, output: 5, total: 15 } }]
    }
  });
  const text = lines.join("\n");
  assert.match(text, /token 8000 · stable 4000/);
  assert.match(text, /codex · in 10 · out 5 · total 15/);
});

test("empty or partial tokenUsage never invents zero values", () => {
  const emptyUsage = formatUsageLines({
    dashboard: { recentRuns: [{ agentId: "cursor", tokenUsage: {} }] }
  });
  assert.match(emptyUsage.join("\n"), /No auditable run tokenUsage/);
  assert.doesNotMatch(emptyUsage.join("\n"), /0 tokens/);

  const inputOnly = formatUsageLines({
    dashboard: { recentRuns: [{ agentId: "codex", tokenUsage: { input: 10 } }] }
  });
  assert.match(inputOnly.join("\n"), /codex · in 10/);
  assert.doesNotMatch(inputOnly.join("\n"), /total/);

  const inputOutput = formatUsageLines({
    dashboard: { recentRuns: [{ agentId: "pi", tokenUsage: { input: 10, output: 5 } }] }
  });
  assert.match(inputOutput.join("\n"), /pi · in 10 · out 5/);
  assert.doesNotMatch(inputOutput.join("\n"), /total/);
});

test("auto-scan contract requests read-only snapshot options without writes", async () => {
  assert.deepEqual(CONTROL_PLANE_AUTO_SCAN, {
    includeDiff: true,
    includeExplain: false,
    includeRuntime: false
  });

  const calls = [];
  const bundle = await loadCockpitScanBundle({
    homeDir: "/tmp/home",
    workspaceRoot: "/tmp/ws",
    packageName: "@kal-elsam/kairo-runtime",
    packageRoot: "/tmp/pkg",
    cliVersion: "0.4.3",
    buildDashboard: async (args) => {
      calls.push({ kind: "dashboard", args });
      return { activeRuns: [], providers: [] };
    },
    buildDiagnostics: async (args) => {
      calls.push({ kind: "diagnostics", args });
      return { diagnostics: { detected: 0 } };
    },
    buildSnapshot: async (args) => {
      calls.push({ kind: "snapshot", args });
      return { health: CONTROL_PLANE_HEALTH.NOT_CONFIGURED, cta: null };
    }
  });

  assert.equal(bundle.snapshot.health, CONTROL_PLANE_HEALTH.NOT_CONFIGURED);
  const snapshotCall = calls.find((entry) => entry.kind === "snapshot");
  assert.equal(snapshotCall.args.includeDiff, true);
  assert.equal(snapshotCall.args.includeExplain, false);
  assert.equal(snapshotCall.args.includeRuntime, false);
  assert.ok(!Object.hasOwn(snapshotCall.args, "write"));
});

test("serialized reload keeps only the latest outcome and preserves prior error until success", async () => {
  const outcomes = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let calls = 0;

  const reload = createSerializedReloader(async () => {
    calls += 1;
    if (calls === 1) {
      await firstGate;
      return { token: "stale" };
    }
    return { token: "fresh" };
  });

  const first = reload().then((outcome) => {
    outcomes.push(outcome);
    return outcome;
  });
  const second = reload().then((outcome) => {
    outcomes.push(outcome);
    return outcome;
  });

  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0].stale, true);
  assert.equal(outcomes[1].stale, false);
  assert.equal(outcomes[1].result.token, "fresh");
  assert.equal(outcomes[1].error, null);
});

test("scan bundle fail-softs a throwing companion (moved from the control-center companion scenario; the legacy control-center model assertions were dropped)", async () => {
  const bundle = await loadCockpitScanBundle({
    homeDir: "/tmp", workspaceRoot: "/tmp", packageName: "x", packageRoot: "/tmp", cliVersion: "0",
    buildDashboard: async () => ({ recentRuns: [] }),
    buildDiagnostics: async () => ({}),
    buildSnapshot: async () => ({ health: CONTROL_PLANE_HEALTH.HEALTHY }),
    buildCompanion: async () => { throw new Error("companion fail"); }
  });
  assert.equal(bundle.snapshot.health, CONTROL_PLANE_HEALTH.HEALTHY);
  assert.equal(bundle.companion.ok, false);
});
