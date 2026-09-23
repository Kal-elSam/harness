import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  buildKairoWorkspaceSnapshot,
  loadKairoWorkspaceSnapshot,
  loadKairoTeamAvailability
} from "../src/global/host/workspace-snapshot.js";

const FULL_STRATEGY = {
  status: "active",
  bootstrapAnalyst: { displayName: "Claude Opus 5", adapterId: "claude", modelId: "claude-opus-5", accessMode: "automatic" },
  orchestrator: { displayName: "Kimi K3", adapterId: "opencode-go", modelId: "kimi-k3", accessMode: "automatic" },
  projectTeam: [
    { role: "Builder", model: { displayName: "GPT-6 Terra", adapterId: "codex", modelId: "gpt-6-terra", accessMode: "automatic" } },
    { role: "Reviewer", model: null }
  ]
};

test("workspace snapshot keeps Kairo's project team, bound session, usage and memory as separate honest sections", () => {
  const snapshot = buildKairoWorkspaceSnapshot({
    projectRoot: "/work/agentic-harness",
    session: { id: "11111111-1111-4111-8111-111111111111", title: "Routing overhaul", mode: "agent" },
    strategy: {
      status: "active",
      projectTeam: [
        { role: "Builder", model: { displayName: "GPT-6 Terra", adapterId: "codex", modelId: "gpt-6-terra" } },
        { role: "Reviewer", model: { displayName: "MiniMax-M3", adapterId: "opencode-go", modelId: "minimax-m3" } }
      ]
    },
    usage: [{ provider: "codex", totalTokens: 2400 }],
    engram: { status: "configured" }
  });

  assert.equal(snapshot.schema, KAIRO_WORKSPACE_SNAPSHOT_SCHEMA);
  assert.deepEqual(snapshot.project, { root: "/work/agentic-harness", label: "agentic-harness" });
  assert.deepEqual(snapshot.session, {
    id: "11111111-1111-4111-8111-111111111111", title: "Routing overhaul", mode: "agent", state: "bound"
  });
  // Compat: the pre-existing state/assignments shape is unchanged
  // (additive change — team.rows is asserted separately below).
  assert.equal(snapshot.team.state, "active");
  assert.deepEqual(snapshot.team.assignments, [
    { role: "Builder", model: "GPT-6 Terra", via: "codex" },
    { role: "Reviewer", model: "MiniMax-M3", via: "opencode-go" }
  ]);
  assert.deepEqual(snapshot.usage, [{ provider: "codex", totalTokens: 2400 }]);
  assert.deepEqual(snapshot.memory, { status: "configured" });
});

test("workspace snapshot never invents a session or project team", () => {
  const snapshot = buildKairoWorkspaceSnapshot({ projectRoot: "/work/empty", session: null, strategy: null });

  assert.deepEqual(snapshot.session, { state: "unbound" });
  assert.equal(snapshot.team.state, "not_analyzed");
  assert.deepEqual(snapshot.team.assignments, []);
  assert.deepEqual(snapshot.team.rows, []);
  assert.deepEqual(snapshot.usage, []);
  assert.deepEqual(snapshot.memory, { status: "unknown" });
});

test("workspace loader reads each existing Kairo source without choosing an arbitrary session", async () => {
  const snapshot = await loadKairoWorkspaceSnapshot({ cwd: "/requested", sessionId: null }, {
    resolveProjectRoot: async () => "/repo/project",
    resolveHomeDir: () => "/home/kairo",
    readProjectStrategy: async (homeDir, root) => {
      assert.equal(homeDir, "/home/kairo");
      assert.equal(root, "/repo/project");
      return { status: "suggested", projectTeam: [{ role: "Explorer", model: { displayName: "Gemini Flash", adapterId: "cursor" } }] };
    },
    getSession: async () => {
      throw new Error("unbound workspace must not choose a session");
    },
    listProviderUsage: async () => [{ provider: "cursor", totalTokens: 4 }],
    inspectEngramIntegration: () => ({ status: "available" })
  });

  assert.equal(snapshot.project.label, "project");
  assert.equal(snapshot.session.state, "unbound");
  assert.equal(snapshot.team.assignments[0].via, "cursor");
  assert.equal(snapshot.memory.status, "available");
});

test("workspace snapshot team rows cover Project Analyst, Orchestrator, and every project-team role, defaulting availability to checking", () => {
  const snapshot = buildKairoWorkspaceSnapshot({ projectRoot: "/work/agentic-harness", strategy: FULL_STRATEGY });

  assert.deepEqual(snapshot.team.rows, [
    { role: "Project Analyst", model: "Claude Opus 5", via: "claude", accessMode: "automatic", availability: { state: "checking", warning: null } },
    { role: "Orchestrator", model: "Kimi K3", via: "opencode-go", accessMode: "automatic", availability: { state: "checking", warning: null } },
    { role: "Builder", model: "GPT-6 Terra", via: "codex", accessMode: "automatic", availability: { state: "checking", warning: null } },
    { role: "Reviewer", model: "no eligible option", via: "unknown", accessMode: null, availability: { state: "checking", warning: null } }
  ]);
  // Existing compatible shape stays intact (additive change).
  assert.deepEqual(snapshot.team.state, "active");
  assert.deepEqual(snapshot.team.assignments, [
    { role: "Builder", model: "GPT-6 Terra", via: "codex" },
    { role: "Reviewer", model: "Unavailable", via: "unknown" }
  ]);
});

test("workspace snapshot team rows compute real availability when intelligence is injected", () => {
  const snapshot = buildKairoWorkspaceSnapshot({
    projectRoot: "/work/agentic-harness",
    strategy: FULL_STRATEGY,
    intelligence: { eligibility: { codex: { ok: true } }, claudeEntitlement: { "claude-opus-5": { status: "denied", reason: "plan tier too low" } }, cursorAccess: {} }
  });

  assert.deepEqual(snapshot.team.rows[0].availability, {
    state: "blocked",
    warning: "Unavailable — your Claude plan denies this model (plan tier too low)"
  });
  assert.deepEqual(snapshot.team.rows[2].availability, { state: "available", warning: null });
});

test("workspace snapshot team rows never claim available when intelligence explicitly failed", () => {
  const snapshot = buildKairoWorkspaceSnapshot({ projectRoot: "/work/agentic-harness", strategy: FULL_STRATEGY, intelligence: null });

  for (const row of snapshot.team.rows) {
    assert.deepEqual(row.availability, { state: "unknown", warning: null });
  }
});

test("workspace loader reads only the explicitly bound Kairo session", async () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const snapshot = await loadKairoWorkspaceSnapshot({ cwd: "/repo", sessionId }, {
    resolveProjectRoot: async () => "/repo",
    resolveHomeDir: () => "/home/kairo",
    readProjectStrategy: async () => null,
    getSession: async (homeDir, root, id) => ({ id, title: `${homeDir}:${root}`, mode: "plan" }),
    listProviderUsage: async () => [],
    inspectEngramIntegration: () => ({ status: "unconfigured" })
  });

  assert.equal(snapshot.session.id, sessionId);
  assert.equal(snapshot.session.mode, "plan");
});

test("loadKairoTeamAvailability returns real intelligence from the conversation service snapshot", async () => {
  const intelligence = await loadKairoTeamAvailability({ cwd: "/repo" }, {
    createConversationService: (deps) => {
      assert.equal(deps.enableProviderProbes, true);
      return {
        snapshot: async ({ cwd }) => {
          assert.equal(cwd, "/repo");
          return { modelIntelligence: { eligibility: { codex: { ok: true } }, claudeEntitlement: { x: { status: "denied" } }, cursorAccess: {} } };
        }
      };
    }
  });

  assert.deepEqual(intelligence, { eligibility: { codex: { ok: true } }, claudeEntitlement: { x: { status: "denied" } }, cursorAccess: {} });
});

test("loadKairoTeamAvailability never reports available when the service throws", async () => {
  const intelligence = await loadKairoTeamAvailability({ cwd: "/repo" }, {
    createConversationService: () => ({ snapshot: async () => { throw new Error("provider probe failed"); } })
  });

  assert.equal(intelligence, null);
});

test("loadKairoTeamAvailability never reports available when the snapshot has no real eligibility data", async () => {
  const intelligence = await loadKairoTeamAvailability({ cwd: "/repo" }, {
    createConversationService: () => ({ snapshot: async () => ({ modelIntelligence: { eligibility: {} } }) })
  });

  assert.equal(intelligence, null);
});
