import assert from "node:assert/strict";
import test from "node:test";
import { buildControlPlaneReport } from "../src/global/control-plane/build-report.js";
import {
  CONTROL_PLANE_SCHEMA,
  NO_ACTIVE_WORKFLOW,
  WORKFLOW_KIND
} from "../src/global/control-plane/constants.js";

test("buildControlPlaneReport composes sections and survives Gentle failure", async () => {
  const report = await buildControlPlaneReport({
    buildNext: async () => ({
      schema: "kairo.next/v1",
      ok: true,
      goal: "Ship control plane",
      progress: ["Slice 1"],
      now: "Contract",
      blockers: [],
      next: "Panel fetch",
      conversationId: "c1",
      updatedAt: "2026-08-12T00:00:00.000Z",
      integration: {
        state: "active",
        provider: "cursor",
        client: "cursor",
        mcpConnected: true,
        enrolled: true,
        showRepair: false,
        detail: "ok"
      },
      diagnostics: []
    }),
    buildConnections: async () => ({
      ok: true,
      connections: [{ id: "gentle", label: "Gentle", state: "available" }],
      fleets: [{
        platform: "cursor",
        orchestrator: { id: "auto", opaque: true },
        minions: Array.from({ length: 10 }, (_, i) => ({
          id: `sdd-${i}`,
          role: "specialist",
          opaque: false
        })),
        opaque: true
      }],
      activity: null,
      fleetNote: "declared",
      orchestratorAuthority: "gentle-ai"
    }),
    loadWorkflow: async () => ({
      ok: false,
      error: "gentle_unavailable",
      provider: "unavailable",
      workflow: {
        kind: WORKFLOW_KIND.NONE,
        active: false,
        label: NO_ACTIVE_WORKFLOW,
        phase: null,
        nextTransition: null,
        changeName: null,
        review: null,
        provider: "unavailable"
      }
    })
  });

  assert.equal(report.schema, CONTROL_PLANE_SCHEMA);
  assert.equal(report.work.goal, "Ship control plane");
  assert.equal(report.workflow.label, NO_ACTIVE_WORKFLOW);
  assert.equal(report.sections.workflow.ok, false);
  assert.equal(report.sections.work.ok, true);
  assert.equal(report.sections.team.ok, true);
  assert.equal(report.team.platforms[0].agents.length, 10);
  assert.ok(report.diagnostics.includes("gentle_unavailable"));
  assert.equal(report.workflow.provider, "unavailable");
  assert.ok(report.attention.primaryActions.length <= 2);
});

test("buildControlPlaneReport never invents empty platforms when fleets exist", async () => {
  const report = await buildControlPlaneReport({
    buildNext: async () => ({
      schema: "kairo.next/v1",
      ok: true,
      goal: null,
      progress: [],
      now: null,
      blockers: [],
      next: null,
      conversationId: null,
      updatedAt: null,
      integration: {
        state: "ready",
        provider: "cursor",
        client: "cursor",
        mcpConnected: true,
        enrolled: false,
        showRepair: false,
        detail: "ready"
      },
      diagnostics: []
    }),
    buildConnections: async () => ({
      ok: true,
      connections: [],
      fleets: [{ platform: "claude", orchestrator: { id: "default" }, minions: [], opaque: false }],
      activity: null
    }),
    loadWorkflow: async () => ({
      ok: true,
      error: null,
      workflow: {
        kind: WORKFLOW_KIND.NONE,
        active: false,
        label: NO_ACTIVE_WORKFLOW,
        phase: null,
        nextTransition: null,
        changeName: null,
        review: null
      }
    })
  });
  assert.equal(report.team.platforms.length, 1);
  assert.equal(
    report.attention.items.some((i) => i.id === "no-platforms"),
    false
  );
});
