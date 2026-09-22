import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  buildKairoWorkspaceSnapshot,
  loadKairoWorkspaceSnapshot
} from "../src/global/host/workspace-snapshot.js";

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
  assert.deepEqual(snapshot.team, {
    state: "active",
    assignments: [
      { role: "Builder", model: "GPT-6 Terra", via: "codex" },
      { role: "Reviewer", model: "MiniMax-M3", via: "opencode-go" }
    ]
  });
  assert.deepEqual(snapshot.usage, [{ provider: "codex", totalTokens: 2400 }]);
  assert.deepEqual(snapshot.memory, { status: "configured" });
});

test("workspace snapshot never invents a session or project team", () => {
  const snapshot = buildKairoWorkspaceSnapshot({ projectRoot: "/work/empty", session: null, strategy: null });

  assert.deepEqual(snapshot.session, { state: "unbound" });
  assert.deepEqual(snapshot.team, { state: "not_analyzed", assignments: [] });
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
