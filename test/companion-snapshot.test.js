import test from "node:test";
import assert from "node:assert/strict";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";
import {
  SOFT_LINK_WINDOW_MS, softLinkReviewToRun, buildCompanionSnapshot, summarizeCompanionProbes
} from "../src/global/observability/build-companion-snapshot.js";
import { buildControlCenterModel } from "../src/global/ink/cockpit-control-center.js";
import { adaptControlCenterToOverview } from "../src/global/ink/ux/live-overview.js";
import { loadCockpitScanBundle } from "../src/global/ink/cockpit-scan.js";

const t0 = Date.parse("2026-08-03T12:00:00.000Z");
const mins = (n) => new Date(t0 + n * 60_000).toISOString();

test("soft correlation: window, agent, invalid stamps, tie-break", () => {
  const runs = [
    { runId: "run-b", agentId: "codex", updatedAt: mins(-30) },
    { runId: "run-a", agentId: "codex", updatedAt: mins(-30) },
    { runId: "run-old", agentId: "codex", endedAt: mins(-90) },
    { runId: "run-claude", agentId: "claude", updatedAt: mins(-10) }
  ];
  const ok = softLinkReviewToRun({ reviewId: "rev-1", agentId: "codex", createdAt: mins(0) }, runs);
  assert.equal(ok?.kind, "soft");
  assert.equal(ok?.displayOnly, true);
  assert.equal(ok?.runId, "run-a");
  assert.ok(ok.deltaMs <= SOFT_LINK_WINDOW_MS);
  assert.equal(softLinkReviewToRun(
    { reviewId: "r", agentId: "codex", createdAt: mins(0) },
    [{ runId: "x", agentId: "codex", updatedAt: mins(-61) }]
  ), null);
  assert.equal(softLinkReviewToRun(
    { reviewId: "r", agentId: "codex", createdAt: mins(0) },
    [{ runId: "y", agentId: "claude", updatedAt: mins(-5) }]
  ), null);
  assert.equal(softLinkReviewToRun(
    { reviewId: "r", agentId: "codex", createdAt: "bad" }, runs
  ), null);
  assert.equal(softLinkReviewToRun(
    { reviewId: "r", agentId: "codex", createdAt: mins(-5) },
    [{ runId: "z", agentId: "codex", updatedAt: mins(0) }]
  ), null);
});

test("companion fail-soft, isolated provider errors, stale informational", async () => {
  const threw = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.HEALTHY,
    buildObservability: async () => { throw new Error("boom"); },
    inspectEngram: () => ({ status: "missing", binary: { path: null } }),
    runs: [], reviews: [], alerts: []
  });
  assert.equal(threw.ok, false);

  const engramFail = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.HEALTHY,
    buildObservability: async () => ({ probes: [{ id: "gentle", state: "available", evidence: [] }] }),
    inspectEngram: () => { throw new Error("engram down"); },
    runs: [], reviews: [], alerts: []
  });
  assert.equal(engramFail.ok, true);
  assert.equal(engramFail.engram.status, "error");

  const mixed = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.HEALTHY,
    buildObservability: async () => ({
      probes: [
        { id: "gentle", state: "error", diagnostics: ["x"], error: "e", evidence: [] },
        {
          id: "graphify", state: "available", diagnostics: ["stale"],
          evidence: [{ kind: "graph", status: "stale", path: "/g" }]
        }
      ]
    }),
    inspectEngram: () => ({ status: "missing", binary: { path: null } }),
    runs: [{ runId: "r1", agentId: "codex", updatedAt: mins(-10) }],
    reviews: [{ reviewId: "v1", agentId: "codex", createdAt: mins(0) }],
    alerts: [{ state: "open" }]
  });
  assert.equal(mixed.ok, true);
  assert.equal(mixed.signals.graphify.graphStatus, "stale");
  assert.equal(mixed.links[0]?.displayOnly, true);
  assert.equal(mixed.nextSafeAction.kind, "investigate");
  assert.notEqual(mixed.nextSafeAction.kind, "stale_block");
  assert.equal(summarizeCompanionProbes([
    { id: "graphify", state: "available", evidence: [{ kind: "graph", status: "ok" }] }
  ]).graphify.graphStatus, "ok");
});

test("overview keeps governance health+CTA; compact primary unchanged", async () => {
  const companion = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.ACTION_REQUIRED,
    buildObservability: async () => ({ probes: [{ id: "gentle", state: "missing", evidence: [] }] }),
    inspectEngram: () => ({ status: "missing", binary: { path: null } }),
    runs: [], reviews: [], alerts: []
  });
  const model = buildControlCenterModel({
    projectName: "p",
    snapshot: {
      health: CONTROL_PLANE_HEALTH.ACTION_REQUIRED,
      coverage: { governedAgents: 1, detectedAgents: 2 },
      diff: { hasChanges: true },
      cta: { kind: "repair", title: "Review and repair drift", detail: "Preview", destination: "changes" }
    },
    companion
  });
  assert.equal(model.health.kind, CONTROL_PLANE_HEALTH.ACTION_REQUIRED);
  assert.equal(model.cta.destination, "changes");
  assert.equal(model.nextAction.destination, "changes");
  const view = adaptControlCenterToOverview(model);
  assert.match(view.primary.label, /repair|Review/i);
  assert.ok(view.metrics.some((m) => /Gentle|Graphify|Engram/i.test(m.label)));

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
