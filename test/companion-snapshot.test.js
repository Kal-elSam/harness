import test from "node:test";
import assert from "node:assert/strict";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";
import {
  SOFT_LINK_WINDOW_MS, softLinkReviewToRun, buildCompanionSnapshot, summarizeCompanionProbes
} from "../src/global/observability/build-companion-snapshot.js";

const t0 = Date.parse("2026-08-03T12:00:00.000Z");
const mins = (n) => new Date(t0 + n * 60_000).toISOString();
const stubUpdates = async () => ({
  state: "available", checkedAt: mins(0), cacheHit: true, diagnostics: [],
  tools: {
    kairo: { id: "kairo", state: "available", updateAvailable: false },
    hermes: { id: "hermes", state: "unavailable", updateAvailable: false },
    gentle: { id: "gentle", state: "unavailable", updateAvailable: false },
    skills: { id: "skills", state: "available", updateAvailable: false }
  }
});

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
    loadEcosystemUpdates: stubUpdates,
    runs: [], reviews: [], alerts: []
  });
  assert.equal(threw.ok, false);

  const engramFail = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.HEALTHY,
    buildObservability: async () => ({ probes: [{ id: "gentle", state: "available", evidence: [] }] }),
    inspectEngram: () => { throw new Error("engram down"); },
    loadEcosystemUpdates: stubUpdates,
    runs: [], reviews: [], alerts: []
  });
  assert.equal(engramFail.ok, true);
  assert.equal(engramFail.engram.status, "error");
  assert.equal(engramFail.nextSafeAction.kind, "investigate");

  let loadReviewsCalls = 0;
  const viaLoader = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.HEALTHY,
    buildObservability: async () => ({ probes: [{ id: "gentle", state: "available", evidence: [] }] }),
    inspectEngram: () => ({ status: "configured", binary: { path: "/bin/engram" } }),
    loadEcosystemUpdates: stubUpdates,
    runs: [{ runId: "r1", agentId: "codex", updatedAt: mins(-10) }],
    loadReviews: async () => {
      loadReviewsCalls += 1;
      return [{ reviewId: "v1", agentId: "codex", createdAt: mins(0) }];
    }
  });
  assert.equal(loadReviewsCalls, 1);
  assert.equal(viaLoader.links.length, 1);
  assert.equal(viaLoader.links[0]?.runId, "r1");
  assert.equal(viaLoader.links[0]?.displayOnly, true);

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
    loadEcosystemUpdates: stubUpdates,
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
