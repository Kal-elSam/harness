import test from "node:test";
import assert from "node:assert/strict";
import {
  DASHBOARD_PURPOSE,
  NEXT_STEP_KINDS,
  formatDashboardPurpose,
  resolveDashboardRecommendation
} from "../src/global/dashboard-guidance.js";
import { formatCliCommand } from "../src/global/brand/cli.js";

test("dashboard purpose is a stable product sentence", () => {
  assert.match(DASHBOARD_PURPOSE, /detect|configur|coordina/i);
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
  assert.match(next.message, new RegExp(formatCliCommand("setup").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("recommendation: enable intelligence when backends are missing", () => {
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
        "No intelligence backend available. Start Ollama or set OPENROUTER_API_KEY (env only)."
      ]
    },
    dashboard: emptyDashboard({ launchable: 1 })
  });

  assert.equal(next.kind, NEXT_STEP_KINDS.ENABLE_INTELLIGENCE);
  assert.match(next.message, /intelligence|Ollama|OpenRouter/i);
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

test("recommendation: review problems when diagnostics report errors", () => {
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
  assert.match(next.message, /review|problem|diagnostic/i);
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
