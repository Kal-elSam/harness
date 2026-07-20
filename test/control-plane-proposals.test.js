import test from "node:test";
import assert from "node:assert/strict";
import {
  PROPOSAL_DESTINATION,
  PROPOSAL_SEVERITY,
  buildControlPlaneProposals
} from "../src/global/control-plane-proposals.js";

function base(overrides = {}) {
  return {
    health: "HEALTHY",
    status: {
      overall: "ok",
      checks: [{ name: "core", status: "ok", category: "core" }],
      agents: [{ id: "cursor", detected: true, managed: true }],
      policy: { applyMode: "confirm" }
    },
    adapters: { adapters: [{ id: "cursor", detected: true, managed: true }] },
    policy: { applyMode: "confirm" },
    diff: { hasChanges: false, changes: [] },
    ...overrides
  };
}

test("healthy empty; every proposal requires evidence", () => {
  assert.deepEqual(buildControlPlaneProposals(base()), []);
});

test("optional intelligence absence yields no proposal", () => {
  const proposals = buildControlPlaneProposals(base({
    status: {
      overall: "ok",
      checks: [{
        name: "intelligence providers",
        status: "warning",
        category: "intelligence",
        detail: "Optional. Start Ollama."
      }],
      agents: [],
      policy: { applyMode: "confirm" }
    },
    adapters: { adapters: [] }
  }));
  assert.equal(proposals.length, 0);
});

test("setup proposal carries verifiable evidence", () => {
  const [proposal] = buildControlPlaneProposals(base({
    health: "NOT_CONFIGURED",
    status: { overall: "missing", nextAction: "Run setup", checks: [], agents: [] },
    adapters: { adapters: [] }
  }));
  assert.equal(proposal.id, "setup-local");
  assert.equal(proposal.severity, PROPOSAL_SEVERITY.HIGH);
  assert.equal(proposal.destination, PROPOSAL_DESTINATION.CHANGES);
  assert.ok(proposal.evidence.every((item) => item.type && item.source && item.ref));
});

test("drift proposals are deduped with stable severity/id order", () => {
  const input = base({
    health: "ACTION_REQUIRED",
    status: {
      overall: "drift",
      nextAction: "Run sync",
      checks: [
        { name: "managed:workflow", status: "stale", category: "drift" },
        { name: "intelligence providers", status: "ok", category: "intelligence" }
      ],
      agents: [
        { id: "codex", detected: true, managed: false },
        { id: "cursor", detected: true, managed: true }
      ]
    },
    adapters: {
      adapters: [
        { id: "codex", detected: true, managed: false },
        { id: "cursor", detected: true, managed: true }
      ]
    },
    diff: {
      hasChanges: true,
      changeCount: 1,
      changes: [{ target: "components/sdd-core/workflow.md" }]
    }
  });

  const first = buildControlPlaneProposals(input);
  const second = buildControlPlaneProposals(input);
  assert.deepEqual(first.map((entry) => entry.id), second.map((entry) => entry.id));
  assert.ok(first.some((entry) => entry.id === "repair-drift"));
  assert.ok(first.some((entry) => entry.id === "govern-adapter-codex"));
  assert.equal(first.filter((entry) => entry.id === "repair-drift").length, 1);
  assert.ok(first.every((entry) => entry.evidence.length > 0));

  const ranks = { high: 0, medium: 1, low: 2, info: 3 };
  for (let i = 1; i < first.length; i += 1) {
    const prev = ranks[first[i - 1].severity];
    const curr = ranks[first[i].severity];
    assert.ok(prev <= curr);
    if (prev === curr) assert.ok(first[i - 1].id.localeCompare(first[i].id) <= 0);
  }
});

test("engram/graphify proposals need check evidence and never claim runtime", () => {
  const proposals = buildControlPlaneProposals(base({
    health: "HEALTHY_WITH_NOTES",
    status: {
      overall: "ok",
      checks: [
        {
          name: "graphify:graph.json",
          status: "warning",
          category: "integration",
          detail: "graphify-out/graph.json may be stale (graph abc, HEAD def)."
        },
        {
          name: "engram:agent:cursor",
          status: "warning",
          category: "integration",
          detail: "cursor → cursor: unconfigured (config evidence only; not runtime-active)."
        },
        {
          name: "intelligence providers",
          status: "warning",
          category: "intelligence",
          detail: "Optional. No backends."
        }
      ],
      agents: [],
      policy: { applyMode: "confirm" }
    },
    adapters: { adapters: [] }
  }));

  const ids = proposals.map((entry) => entry.id);
  assert.ok(ids.includes("external-graphify-graph-json"));
  assert.ok(ids.includes("external-engram-agent-cursor"));
  assert.equal(ids.some((id) => id.includes("intelligence")), false);
  for (const entry of proposals.filter((item) => item.id.startsWith("external-"))) {
    assert.match(entry.detail, /not .*runtime|Configuration\/version\/freshness/i);
  }
});

test("duplicate candidate ids collapse", () => {
  const proposals = buildControlPlaneProposals(base({
    health: "ACTION_REQUIRED",
    status: {
      overall: "drift",
      checks: [
        { name: "managed:a", status: "stale", category: "drift" },
        { name: "managed:a", status: "stale", category: "drift" }
      ],
      agents: []
    },
    adapters: { adapters: [] },
    diff: { hasChanges: true, changes: [{ target: "a" }, { target: "a" }] }
  }));
  assert.equal(proposals.filter((entry) => entry.id === "repair-drift").length, 1);
});

test("SDD integration warning with hasChanges does not emit repair-drift", () => {
  const proposals = buildControlPlaneProposals(base({
    health: "HEALTHY_WITH_NOTES",
    status: {
      overall: "ok",
      nextAction: "Ecosystem healthy.",
      checks: [{
        name: "sdd-core:skills",
        status: "warning",
        category: "integration",
        componentId: "sdd-core",
        detail: "SDD skills missing (disk presence ≠ runtime active)."
      }],
      counts: { warning: 1, missing: 0, stale: 0 },
      agents: [],
      policy: { applyMode: "confirm" }
    },
    adapters: { adapters: [] },
    diff: { hasChanges: true, changes: [], changeCount: 0 }
  }));

  const ids = proposals.map((entry) => entry.id);
  assert.equal(ids.includes("repair-drift"), false);
  assert.ok(ids.includes("warning-sdd-core-skills"));
  assert.equal(
    proposals.find((entry) => entry.id === "warning-sdd-core-skills")?.severity,
    PROPOSAL_SEVERITY.LOW
  );
});
