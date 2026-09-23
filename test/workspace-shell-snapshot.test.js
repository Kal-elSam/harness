import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  buildKairoWorkspaceSnapshot,
  loadKairoWorkspaceSnapshot,
  loadKairoLiveData,
  loadKairoUsageData
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

test("loadKairoLiveData returns real intelligence AND real usage/providers from ONE conversation service snapshot call", async () => {
  let snapshotCalls = 0;
  const liveData = await loadKairoLiveData({ cwd: "/repo" }, {
    createConversationService: (deps) => {
      assert.equal(deps.enableProviderProbes, true);
      return {
        snapshot: async ({ cwd }) => {
          snapshotCalls += 1;
          assert.equal(cwd, "/repo");
          return {
            modelIntelligence: { eligibility: { codex: { ok: true } }, claudeEntitlement: { x: { status: "denied" } }, cursorAccess: {} },
            usage: { codex: { primary: { remainingPercent: 58 } } },
            providers: { claude: { status: "Pro · usage unknown" } }
          };
        }
      };
    }
  });

  assert.equal(snapshotCalls, 1, "one snapshot() call serves both team availability and subscription usage — no second probe");
  assert.deepEqual(liveData, {
    eligibility: { codex: { ok: true } },
    claudeEntitlement: { x: { status: "denied" } },
    cursorAccess: {},
    usage: { codex: { primary: { remainingPercent: 58 } } },
    providers: { claude: { status: "Pro · usage unknown" } }
  });
});

test("loadKairoLiveData never reports available when the service throws", async () => {
  const liveData = await loadKairoLiveData({ cwd: "/repo" }, {
    createConversationService: () => ({ snapshot: async () => { throw new Error("provider probe failed"); } })
  });

  assert.equal(liveData, null);
});

test("loadKairoLiveData never reports available when the snapshot has no real eligibility data", async () => {
  const liveData = await loadKairoLiveData({ cwd: "/repo" }, {
    createConversationService: () => ({ snapshot: async () => ({ modelIntelligence: { eligibility: {} } }) })
  });

  assert.equal(liveData, null);
});

test("workspace snapshot subscriptions default to checking, then real segments, then unknown on failure", () => {
  const checking = buildKairoWorkspaceSnapshot({ projectRoot: "/work/agentic-harness", strategy: FULL_STRATEGY });
  assert.deepEqual(checking.subscriptions, { state: "checking", segments: [], usageModel: [] });

  const ready = buildKairoWorkspaceSnapshot({
    projectRoot: "/work/agentic-harness",
    strategy: FULL_STRATEGY,
    intelligence: {
      eligibility: {},
      usage: { codex: { primary: { remainingPercent: 58 }, secondary: { remainingPercent: 86 } } },
      providers: { claude: { status: "Pro · usage unknown" } }
    }
  });
  assert.equal(ready.subscriptions.state, "ready");
  assert.deepEqual(ready.subscriptions.segments, [
    "Codex 5h 58% / W 86%",
    "Claude Pro · usage unknown",
    "Go usage unknown"
  ]);
  // Same structured model formatSubscriptionUsageSegments builds its text
  // from (see usage-summary.js) — the widget bar-renders this directly
  // instead of re-parsing the text segments above.
  assert.deepEqual(ready.subscriptions.usageModel[0], {
    name: "Codex",
    windows: [
      { label: "5h", remainingPercent: 58, level: "normal" },
      { label: "W", remainingPercent: 86, level: "normal" }
    ],
    fallbackStatus: "usage unknown"
  });

  const failed = buildKairoWorkspaceSnapshot({ projectRoot: "/work/agentic-harness", strategy: FULL_STRATEGY, intelligence: null });
  assert.deepEqual(failed.subscriptions, { state: "unknown", segments: [], usageModel: [] });
});

test("workspace snapshot computes team availability and subscription usage from INDEPENDENT sources (P01.2 split), never waiting on each other", () => {
  const usageOnly = buildKairoWorkspaceSnapshot({
    projectRoot: "/work/agentic-harness",
    strategy: FULL_STRATEGY,
    usageIntelligence: { usage: { codex: { primary: { remainingPercent: 58 } } }, providers: {} },
    availabilityIntelligence: undefined
  });
  assert.equal(usageOnly.subscriptions.state, "ready");
  for (const row of usageOnly.team.rows) assert.equal(row.availability.state, "checking");

  const availabilityOnly = buildKairoWorkspaceSnapshot({
    projectRoot: "/work/agentic-harness",
    strategy: FULL_STRATEGY,
    usageIntelligence: undefined,
    availabilityIntelligence: { eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {} }
  });
  assert.deepEqual(availabilityOnly.subscriptions, { state: "checking", segments: [], usageModel: [] });
  assert.equal(availabilityOnly.team.rows[2].availability.state, "available");
});

test("workspace snapshot falls back to the single `intelligence` field for both team and subscriptions when usageIntelligence/availabilityIntelligence are not explicitly given (back-compat)", () => {
  const snapshot = buildKairoWorkspaceSnapshot({
    projectRoot: "/work/agentic-harness",
    strategy: FULL_STRATEGY,
    intelligence: { eligibility: { codex: { ok: true } }, usage: { codex: { primary: { remainingPercent: 58 } } }, providers: {} }
  });
  assert.equal(snapshot.subscriptions.state, "ready");
  assert.equal(snapshot.team.rows[2].availability.state, "available");
});

test("loadKairoUsageData runs Codex/Claude/OpenCode usage readers in parallel with the same call shapes service.js uses, and never throws", async () => {
  const calls = [];
  const usageData = await loadKairoUsageData({ cwd: "/repo/project" }, {
    readCodexUsage: async (args) => { calls.push(["codex", args]); return { status: "measured", primary: { remainingPercent: 58 } }; },
    readClaudeUsage: async (args) => { calls.push(["claude", args]); return { status: "measured", primary: { remainingPercent: 34 } }; },
    readOpenCodeUsage: async (args) => { calls.push(["opencode", args]); return { go: { windows: [] }, zen: null }; }
  });

  assert.deepEqual(calls, [
    ["codex", { cwd: "/repo/project" }],
    ["claude", {}],
    ["opencode", {}]
  ]);
  assert.deepEqual(usageData, {
    usage: {
      codex: { status: "measured", primary: { remainingPercent: 58 } },
      claude: { status: "measured", primary: { remainingPercent: 34 } },
      opencode: { go: { windows: [] }, zen: null }
    },
    providers: {}
  });
});

test("loadKairoUsageData never throws even when a reader rejects — a failed reader resolves to null, the others still report", async () => {
  const usageData = await loadKairoUsageData({ cwd: "/repo" }, {
    readCodexUsage: async () => { throw new Error("codex spawn failed"); },
    readClaudeUsage: async () => ({ status: "measured", primary: { remainingPercent: 34 } }),
    readOpenCodeUsage: async () => ({ go: { windows: [] }, zen: null })
  });

  assert.equal(usageData.usage.codex, null);
  assert.deepEqual(usageData.usage.claude, { status: "measured", primary: { remainingPercent: 34 } });
});
