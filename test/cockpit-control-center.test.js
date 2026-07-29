import test from "node:test";
import assert from "node:assert/strict";
import { buildControlCenterModel, formatUsageLines } from "../src/global/ink/cockpit-control-center.js";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";
import { COCKPIT_NAV } from "../src/global/ink/cockpit-models.js";
import {
  CONTROL_PLANE_AUTO_SCAN,
  createSerializedReloader,
  loadCockpitScanBundle
} from "../src/global/ink/cockpit-scan.js";
import { resolveEnterNavIntent } from "../src/global/ink/cockpit-enter.js";
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

test("usage lines show configured limits and run tokenUsage without inventing totals", () => {
  const empty = formatUsageLines({});
  assert.match(empty.join("\n"), /MEASURED/);
  assert.match(empty.join("\n"), /Data unavailable/);
  assert.match(empty.join("\n"), /No profile token budgets configured/);
  assert.match(empty.join("\n"), /no invented token savings/i);

  const lines = formatUsageLines({
    dashboard: {
      profile: { tokenBudget: 8000, stableContextBudget: 4000 },
      recentRuns: [{ agentId: "codex", tokenUsage: { input: 10, output: 5, total: 15 } }]
    }
  });
  const text = lines.join("\n");
  assert.match(text, /CONFIGURED LIMITS/);
  assert.match(text, /token 8000 · stable 4000/);
  assert.match(text, /codex · 15 tokens/);
  assert.doesNotMatch(text, /invented savings amount/i);
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
  const text = detail.join("\n");
  assert.match(text, /SUMMARY/);
  assert.match(text, /Tokens · in 1 · out 2 · total 3/);
  assert.match(text, /DETAILS/);
  assert.match(text, /Run id · run_secretish/);
  assert.match(text, /Cwd · ~\/proj/);
  assert.doesNotMatch(text, /JSON|\{"input"/);
});

test("primary nav lists six user destinations", () => {
  assert.deepEqual(COCKPIT_NAV.map((item) => item.label), [
    "Overview",
    "Governance",
    "Activity",
    "Orchestration",
    "Usage",
    "Settings"
  ]);
  assert.equal(COCKPIT_NAV[3].view, ORCHESTRATOR_VIEWS.RUNS);
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
      ctaDestination: "changes"
    }).kind,
    "activate-cta"
  );
});
