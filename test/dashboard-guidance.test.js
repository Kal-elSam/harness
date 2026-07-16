import test from "node:test";
import assert from "node:assert/strict";
import {
  DASHBOARD_PURPOSE,
  NEXT_STEP_KINDS,
  READINESS_KINDS,
  formatDashboardPurpose,
  resolveDashboardRecommendation,
  resolveProjectReadiness
} from "../src/global/dashboard-guidance.js";
import { formatCliCommand } from "../src/global/brand/cli.js";

test("dashboard purpose is a stable product sentence", () => {
  assert.match(DASHBOARD_PURPOSE, /coordina/i);
  assert.equal(formatDashboardPurpose(), DASHBOARD_PURPOSE);
});

test("recommendation: configure environment when harness is not set up", () => {
  const next = resolveDashboardRecommendation({
    hasGlobalState: false,
    diagnostics: emptyDiagnostics(),
    dashboard: emptyDashboard()
  });

  assert.equal(next.kind, NEXT_STEP_KINDS.CONFIGURE);
  assert.match(next.message, /setup|configur/i);
  assert.equal(next.targetView, "diagnostics");
  assert.match(next.message, new RegExp(formatCliCommand("setup").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("recommendation: New run wins even without global state when agents are launchable", () => {
  const next = resolveDashboardRecommendation({
    hasGlobalState: false,
    diagnostics: emptyDiagnostics(),
    dashboard: emptyDashboard({ launchable: 2 })
  });
  assert.equal(next.kind, NEXT_STEP_KINDS.LAUNCH);
  assert.equal(next.targetAction, "launch");

  const readiness = resolveProjectReadiness({
    hasGlobalState: false,
    diagnostics: emptyDiagnostics(),
    dashboard: emptyDashboard({ launchable: 2 })
  });
  assert.equal(readiness.kind, READINESS_KINDS.LIMITED);
});

test("recommendation: New run wins when agents are launchable without intelligence", () => {
  const next = resolveDashboardRecommendation({
    hasGlobalState: true,
    diagnostics: {
      ...emptyDiagnostics(),
      diagnostics: { detected: 2, available: 2, unknown: 0, errors: 0 },
      intelligence: {
        summary: { localAvailable: false, cloudAuthenticated: false },
        routingPreview: { canInvoke: false, reason: "No backend" }
      },
      recommendations: [
        "No intelligence backend available. Start Ollama, install the OpenCode CLI, or set OPENCODE_API_KEY / OPENROUTER_API_KEY (env only)."
      ]
    },
    dashboard: emptyDashboard({ launchable: 1 })
  });

  assert.equal(next.kind, NEXT_STEP_KINDS.LAUNCH);
  assert.equal(next.targetView, "launch");
  assert.equal(next.targetAction, "launch");
  assert.match(next.title, /new run/i);
});

test("recommendation: enable intelligence only when no launchable agents", () => {
  const next = resolveDashboardRecommendation({
    hasGlobalState: true,
    diagnostics: {
      ...emptyDiagnostics(),
      diagnostics: { detected: 2, available: 2, unknown: 0, errors: 0 },
      intelligence: {
        summary: { localAvailable: false, cloudAuthenticated: false },
        routingPreview: { canInvoke: false, reason: "No backend" }
      },
      recommendations: []
    },
    dashboard: emptyDashboard({ launchable: 0 })
  });

  assert.equal(next.kind, NEXT_STEP_KINDS.ENABLE_INTELLIGENCE);
  assert.match(next.message, /intelligence|Ollama|OpenCode|OPENCODE_API_KEY|OPENROUTER/i);
  assert.match(next.message, /OpenCode CLI|OPENCODE_API_KEY/);
});

test("recommendation: launch a run when environment is ready", () => {
  const next = resolveDashboardRecommendation({
    hasGlobalState: true,
    diagnostics: {
      ...emptyDiagnostics(),
      diagnostics: { detected: 2, available: 2, unknown: 0, errors: 0 },
      intelligence: {
        summary: { localAvailable: true, cloudAuthenticated: false },
        routingPreview: { canInvoke: true, reason: "local" }
      },
      recommendations: []
    },
    dashboard: emptyDashboard({ launchable: 1 })
  });

  assert.equal(next.kind, NEXT_STEP_KINDS.LAUNCH);
  assert.match(next.message, /launch|run/i);
});

test("recommendation: review problems when diagnostics report errors and nothing is launchable", () => {
  const next = resolveDashboardRecommendation({
    hasGlobalState: true,
    diagnostics: {
      ...emptyDiagnostics(),
      diagnostics: { detected: 1, available: 0, unknown: 0, errors: 1 },
      capabilities: [{ id: "cursor", label: "Cursor", state: "error", recommendation: "Fix path" }],
      recommendations: ["Cursor: Fix path"],
      intelligence: {
        summary: { localAvailable: true, cloudAuthenticated: false },
        routingPreview: { canInvoke: true, reason: "local" }
      }
    },
    dashboard: emptyDashboard({ launchable: 0 })
  });

  assert.equal(next.kind, NEXT_STEP_KINDS.REVIEW);
  assert.match(next.message, /review|problem|health/i);
});

test("recommendation: inspect auth when cloud is configured but not authenticated", () => {
  const next = resolveDashboardRecommendation({
    hasGlobalState: true,
    diagnostics: {
      ...emptyDiagnostics(),
      diagnostics: { detected: 2, available: 2, unknown: 0, errors: 0 },
      intelligence: {
        summary: {
          localAvailable: false,
          cloudConfigured: true,
          cloudAuthenticated: false
        },
        routingPreview: { canInvoke: false, reason: "OpenCode Go HTTP 401" }
      },
      recommendations: []
    },
    dashboard: emptyDashboard({ launchable: 0 })
  });

  assert.equal(next.kind, NEXT_STEP_KINDS.REVIEW);
  assert.match(next.message, /intelligence status|not authenticated/i);
});

test("readiness: needs setup / attention / limited / ready", () => {
  assert.equal(resolveProjectReadiness({
    hasGlobalState: false,
    diagnostics: emptyDiagnostics(),
    dashboard: emptyDashboard()
  }).kind, READINESS_KINDS.NEEDS_SETUP);

  assert.equal(resolveProjectReadiness({
    hasGlobalState: true,
    diagnostics: {
      ...emptyDiagnostics(),
      diagnostics: { detected: 2, available: 0, unknown: 0, errors: 1 },
      recommendations: ["Cursor: Fix path"]
    },
    dashboard: emptyDashboard({ launchable: 0 })
  }).kind, READINESS_KINDS.NEEDS_ATTENTION);

  assert.equal(resolveProjectReadiness({
    hasGlobalState: true,
    diagnostics: {
      ...emptyDiagnostics(),
      diagnostics: { detected: 3, available: 3, unknown: 0, errors: 0 },
      intelligence: { summary: { localAvailable: false, cloudAuthenticated: false } },
      recommendations: []
    },
    dashboard: emptyDashboard({ launchable: 2 })
  }).kind, READINESS_KINDS.LIMITED);

  const ready = resolveProjectReadiness({
    hasGlobalState: true,
    diagnostics: {
      ...emptyDiagnostics(),
      diagnostics: { detected: 3, available: 3, unknown: 0, errors: 0 },
      intelligence: { summary: { localAvailable: true, cloudAuthenticated: false } },
      recommendations: []
    },
    dashboard: emptyDashboard({ launchable: 2 })
  });
  assert.equal(ready.kind, READINESS_KINDS.READY);
  assert.match(ready.headline, /READY TO WORK/i);
  assert.match(ready.summaryLine, /agents ready/);
});

test("readiness and CTA: launchable agents win even when diagnostics detected is 0", () => {
  const dashboard = emptyDashboard({ launchable: 3 });
  const diagnostics = {
    ...emptyDiagnostics(),
    diagnostics: { detected: 0, available: 0, unknown: 0, errors: 0 },
    recommendations: []
  };

  const readiness = resolveProjectReadiness({
    hasGlobalState: true,
    diagnostics,
    dashboard
  });
  assert.equal(readiness.kind, READINESS_KINDS.LIMITED);

  const next = resolveDashboardRecommendation({
    hasGlobalState: true,
    diagnostics,
    dashboard
  });
  assert.equal(next.kind, NEXT_STEP_KINDS.LAUNCH);
  assert.equal(next.targetAction, "launch");
});

function emptyDiagnostics() {
  return {
    diagnostics: { detected: 0, available: 0, unknown: 0, errors: 0 },
    capabilities: [],
    recommendations: [],
    intelligence: {
      summary: { localAvailable: false, cloudAuthenticated: false },
      routingPreview: { canInvoke: false, reason: "n/a" }
    }
  };
}

function emptyDashboard({ launchable = 0 } = {}) {
  return {
    activeRuns: [],
    recentRuns: [],
    providers: Array.from({ length: launchable }, (_, index) => ({
      id: `agent-${index}`,
      compatible: true,
      available: true,
      launchable: true
    }))
  };
}
