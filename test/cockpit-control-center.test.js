import test from "node:test";
import assert from "node:assert/strict";
import {
  buildControlCenterModel,
  formatHermesActivityLines,
  formatUsageLines
} from "../src/global/ink/cockpit-control-center.js";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";
import { COCKPIT_NAV } from "../src/global/ink/cockpit-models.js";
import {
  CONTROL_PLANE_AUTO_SCAN,
  createSerializedReloader,
  loadCockpitScanBundle
} from "../src/global/ink/cockpit-scan.js";
import { resolveEnterNavIntent } from "../src/global/ink/cockpit-enter.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";
import { formatOrchestrationStatus, formatRunsHubLines, RUNS_HUB_ITEMS } from "../src/global/ink/cockpit-runs.js";
import { formatRunDetailLines } from "../src/global/ink/orchestrator-state.js";

test("control center model surfaces health, coverage, and CTA from snapshot", () => {
  const model = buildControlCenterModel({
    projectName: "agentic-harness",
    snapshot: {
      health: CONTROL_PLANE_HEALTH.ACTION_REQUIRED,
      coverage: {
        governedAgents: 1,
        detectedAgents: 3,
        components: 2,
        activeModules: ["orchestrator", "sdd-core"]
      },
      backups: { count: 2 },
      policy: { profile: "safe", applyMode: "prompt" },
      status: { counts: { warning: 1 }, checks: [{ name: "engram", status: "warning", detail: "missing" }] },
      diff: { hasChanges: true, changeCount: 2 },
      cta: {
        kind: "repair",
        title: "Review and repair drift",
        detail: "Preview repairs first.",
        destination: "changes"
      }
    }
  });

  assert.match(model.title, /OVERVIEW/);
  assert.equal(model.health.label, "ACTION REQUIRED");
  assert.match(model.health.summaryLine, /1\/3 agents governed/);
  assert.equal(model.cta.destination, "changes");
  assert.match(model.cta.enterHint, /Enter|again/i);
  assert.equal(model.alerts.count, null);
  assert.equal(model.alerts.headline, "Alert data unavailable");
  assert.doesNotMatch(model.alerts.headline, /\d+\s+pending/i);
  assert.match(model.tokens.headline, /Data unavailable|stable|request/);
});

test("overview alerts use store counts — never synthetic warning/drift totals", () => {
  const empty = buildControlCenterModel({
    projectName: "p",
    snapshot: { health: CONTROL_PLANE_HEALTH.HEALTHY, coverage: {} },
    alerts: []
  });
  assert.equal(empty.alerts.count, 0);
  assert.equal(empty.alerts.headline, "None pending");
  const pending = buildControlCenterModel({
    projectName: "p",
    snapshot: { health: CONTROL_PLANE_HEALTH.HEALTHY, coverage: {} },
    alerts: [{ state: "open" }, { state: "resolved" }, { state: "open" }]
  });
  assert.equal(pending.alerts.count, 2);
  assert.equal(pending.alerts.headline, "2 pending");
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

test("orchestration hub labels stay selectable; detail keeps ids under DETAILS", () => {
  assert.deepEqual(formatRunsHubLines(), [
    "Active runs",
    "History",
    "Reviews",
    "New run"
  ]);
  assert.match(formatOrchestrationStatus({ active: 2, recent: 5, reviews: 1 }), /2 active · 5 recent · 1 reviews/);
  const detail = formatRunDetailLines({
    runId: "run_secretish",
    agentId: "codex",
    state: "succeeded",
    model: "gpt",
    cwd: "/Users/me/proj",
    startedAt: "2026-07-29T12:00:00.000Z",
    tokenUsage: { input: 1, output: 2, total: 3 }
  }, [], { homeDir: "/Users/me" });
  const dtext = detail.join("\n");
  assert.match(dtext, /SUMMARY/);
  assert.match(dtext, /Tokens · in 1 · out 2 · total 3/);
  assert.match(dtext, /DETAILS/);
  assert.match(dtext, /Run id · run_secretish/);
  assert.match(dtext, /Cwd · ~\/proj/);
  assert.doesNotMatch(dtext, /JSON|\{"input"/);
});

test("primary nav lists three user destinations", () => {
  assert.deepEqual(COCKPIT_NAV.map((item) => item.label), [
    "Home",
    "Settings",
    "History"
  ]);
  assert.equal(COCKPIT_NAV[2].view, ORCHESTRATOR_VIEWS.ACTIVITY);
  assert.deepEqual(RUNS_HUB_ITEMS.map((item) => item.label), [
    "Active runs",
    "History",
    "Reviews",
    "New run"
  ]);
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

test("Hermes activity lines degrade opaquely and vary by layout", () => {
  assert.deepEqual(formatHermesActivityLines(null), ["Hermes · unavailable"]);
  assert.deepEqual(formatHermesActivityLines({ state: "error" }), ["Hermes · error"]);
  assert.deepEqual(formatHermesActivityLines({ state: "unavailable" }), ["Hermes · unavailable"]);
  assert.deepEqual(
    formatHermesActivityLines({
      state: "available",
      aggregates: { activeCount: 2, endedCount: 5, hasMore: false },
      sessions: []
    }, LAYOUT_MODES.MINIMAL),
    ["Hermes · available · 2 active"]
  );
  assert.deepEqual(
    formatHermesActivityLines({
      state: "partial",
      aggregates: { activeCount: 1, endedCount: 4, hasMore: false },
      sessions: []
    }, LAYOUT_MODES.COMPACT),
    ["Hermes · partial · 1 active · 4 ended"]
  );

  const wide = formatHermesActivityLines({
    state: "available",
    aggregates: { activeCount: 2, endedCount: 1, hasMore: true },
    sessions: [
      { id: "sess-secret", title: "Refactor auth", active: true },
      { id: "sess-2", source: "cli", active: false },
      { id: "sess-3", title: "x".repeat(80), active: true },
      { id: "sess-4", title: "hidden", active: false }
    ]
  }, LAYOUT_MODES.WIDE);
  assert.equal(wide[0], "Hermes · available · 2 active · 1 ended");
  assert.equal(wide[1], "  · Refactor auth · active");
  assert.equal(wide[2], "  · cli · ended");
  assert.equal(wide[3], `  · ${"x".repeat(48)} · active`);
  assert.equal(wide[4], "  · … more sessions");
  assert.equal(wide.length, 5);
  assert.doesNotMatch(wide.join("\n"), /sess-secret|sess-2|baseUrl|http:\/\//i);
});

test("control center companion overlay includes Hermes observe-only lines", () => {
  const companion = {
    ok: true,
    signals: {
      gentle: { state: "available" },
      graphify: { state: "available", graphStatus: "fresh" },
      hermes: {
        activity: {
          state: "available",
          aggregates: { activeCount: 1, endedCount: 0, hasMore: false },
          sessions: [{ id: "do-not-leak", title: "Probe session", active: true }]
        }
      }
    },
    engram: { status: "ready" },
    links: [],
    nextSafeAction: { kind: "idle", title: "quiet" }
  };
  const compact = buildControlCenterModel({
    projectName: "p",
    layoutMode: LAYOUT_MODES.COMPACT,
    snapshot: { health: CONTROL_PLANE_HEALTH.HEALTHY, coverage: {}, diff: { hasChanges: false } },
    companion
  });
  assert.ok(compact.companion.lines.some((line) => line === "Hermes · available · 1 active · 0 ended"));
  assert.ok(!compact.companion.lines.some((line) => /do-not-leak|Probe session/.test(line)));

  const wide = buildControlCenterModel({
    projectName: "p",
    layoutMode: LAYOUT_MODES.WIDE,
    snapshot: { health: CONTROL_PLANE_HEALTH.HEALTHY, coverage: {}, diff: { hasChanges: false } },
    companion
  });
  assert.ok(wide.companion.lines.some((line) => line === "  · Probe session · active"));
  assert.doesNotMatch(wide.companion.lines.join("\n"), /do-not-leak/);
  assert.equal(wide.includeEmbeddedStatus, false);
});

test("Enter intent separates Control center open from CTA activation", () => {
  const overview = COCKPIT_NAV[0];
  assert.equal(
    resolveEnterNavIntent({
      currentView: ORCHESTRATOR_VIEWS.CHANGES,
      navItem: overview,
      ctaDestination: "changes"
    }).kind,
    "open-nav"
  );
  assert.equal(
    resolveEnterNavIntent({
      currentView: ORCHESTRATOR_VIEWS.HOME,
      navItem: overview,
      ctaDestination: "setup"
    }).kind,
    "activate-setup"
  );
  assert.equal(
    resolveEnterNavIntent({
      currentView: ORCHESTRATOR_VIEWS.HOME,
      navItem: overview,
      ctaDestination: "changes"
    }).kind,
    "activate-cta"
  );
});
