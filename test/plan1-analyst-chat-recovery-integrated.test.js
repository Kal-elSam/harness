/**
 * Plan 1 P1-T2 — integrated flows through the REAL kairo-ui-rpc-stdio sidecar.
 *
 * Chains (not isolated unit slices):
 *   1) analyst → analyze → proposal → approve → chat (submitTask)
 *   2) access loss → recovery.preview → apply (approve)
 *   3) access loss → recovery.preview → reject
 *   4) draft persist on stop + restore on ready (session continuity)
 *
 * REAL: runKairoUiRpcStdio op loop, NDJSON host↔sidecar protocol.
 * SIMULATED (labeled): Pi child, provider probes/analysis bodies, storage,
 *                      submitTask answer text. No real provider CLIs/accounts.
 *
 * Does not edit Claude-owned implementation files (settings/ops sidecars,
 * kairo-ui-rpc-stdio.js source, setup.js, ops/settings panels).
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  openPiRpcBridge
} from "../src/global/host/pi-rpc-bridge.js";
import { runKairoUiRpcStdio } from "../src/global/host/kairo-ui-rpc-stdio.js";

const ARCHITECT = {
  id: "codex::m1",
  kairoRoute: { role: "Architect", adapterId: "codex", modelId: "m1" }
};

const ANALYST = {
  model: { adapterId: "claude", modelId: "claude-sonnet-sim", displayName: "Claude Sonnet (simulated)" },
  selectionSource: "manual",
  recommendationTags: [],
  choice: null,
  accessCheckConfirmed: true
};

function fakeSnapshot(overrides = {}) {
  return {
    schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
    project: { label: "plan1-integrated" },
    agents: [],
    subscriptions: { state: "checking", segments: [] },
    ...overrides
  };
}

function createFakeRpcChild({ onCommand = () => null } = {}) {
  const child = new EventEmitter();
  let activeModel = null;
  child.stdin = new EventEmitter();
  child.stdin.write = (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      let cmd;
      try {
        cmd = JSON.parse(line);
      } catch {
        continue;
      }
      const response = onCommand(cmd, {
        activeModel,
        setModel: (model) => {
          activeModel = model;
        }
      });
      if (response) {
        const body = { ...response };
        if (cmd.id != null && body.id == null) body.id = cmd.id;
        queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify(body)}\n`)));
      }
    }
    return true;
  };
  child.stdin.end = () => {};
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit("exit", 0, null);
  return child;
}

function defaultPiCommands(cmd, ctx, setModelCalls) {
  if (cmd.type === "get_state") {
    return {
      type: "response",
      command: "get_state",
      success: true,
      data: { sessionId: "s-plan1", model: ctx?.activeModel ?? null }
    };
  }
  if (cmd.type === "set_model") {
    setModelCalls.push(cmd);
    if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
    return {
      type: "response",
      command: "set_model",
      success: true,
      data: { id: cmd.modelId, provider: "kairo" }
    };
  }
  if (cmd.type === "get_messages") {
    return { type: "response", command: "get_messages", success: true, data: { messages: [] } };
  }
  return null;
}

async function pollUntil(pred, ms = 4000) {
  const deadline = Date.now() + ms;
  while (!pred() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  return pred();
}

function collectStdout() {
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  return { out, stdout };
}

test("INTEGRATED (SIMULATED providers/Pi): analyst → analyze → proposal → approve → chat", async () => {
  const { out, stdout } = collectStdout();
  const stdin = new PassThrough();
  const setModelCalls = [];
  const analyzeAnalysts = [];
  const chatTasks = [];
  let routes = [];
  let teamState = "not_analyzed";

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    loadKairoProviderModels: async () => routes,
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => defaultPiCommands(cmd, ctx, setModelCalls)
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot({ team: { state: teamState, rows: [], assignments: [] } }),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => routes,
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    },
    analyzeProjectTeam: async ({ analyst, onProgress }) => {
      analyzeAnalysts.push(analyst);
      // SIMULATED analysis body — no provider CLI.
      onProgress?.({ stage: "preparing", analyst: "Claude Sonnet (simulated)", startedAt: 1, elapsedMs: 0 });
      onProgress?.({ stage: "consulting_analyst", analyst: "Claude Sonnet (simulated)", startedAt: 1, elapsedMs: 10 });
      onProgress?.({ stage: "building_team", analyst: "Claude Sonnet (simulated)", startedAt: 1, elapsedMs: 20 });
      teamState = "pending_approval";
      return {
        state: "suggested",
        teamRows: 1,
        roles: ["Architect"],
        analyst: "claude · Claude Sonnet (simulated)",
        projectRoot: "/project",
        notice: null,
        readyToApprove: true,
        blockedRoles: []
      };
    },
    approveProjectTeam: async ({ cwd }) => {
      assert.equal(cwd, "/project");
      routes = [ARCHITECT];
      teamState = "active";
      return {
        state: "active",
        teamRows: 1,
        roles: ["Architect"],
        analyst: "claude · Claude Sonnet (simulated)",
        projectRoot: cwd,
        notice: null
      };
    },
    submitTask: async ({ task, mode }) => {
      // SIMULATED chat answer — no real provider.
      chatTasks.push({ task, mode });
      return {
        kind: "answer",
        provider: "simulated",
        model: "sim-chat",
        answer: `SIMULATED reply to: ${task}`
      };
    },
    loadSnapshot: async () => fakeSnapshot({ team: { state: teamState, rows: [], assignments: [] } })
  });

  assert.equal(
    await pollUntil(() => out.some((r) => r.type === "ready")),
    true,
    "sidecar ready"
  );
  assert.equal(out.find((r) => r.type === "ready")?.engine?.status, "no_model");

  const beforeAnalyze = out.length;
  stdin.write(`${JSON.stringify({ op: "project.analyze", analyst: ANALYST })}\n`);
  assert.equal(
    await pollUntil(() => out.slice(beforeAnalyze).some((r) => r.type === "team" && r.op === "project.analyze")),
    true
  );

  const progress = out.slice(beforeAnalyze).filter((r) => r.type === "analysis_progress");
  assert.ok(progress.length >= 2, `expected analysis_progress stages, got ${progress.length}`);
  assert.equal(analyzeAnalysts[0]?.model?.modelId, "claude-sonnet-sim");
  assert.equal(analyzeAnalysts[0]?.accessCheckConfirmed, true);

  const teamAnalyze = out.slice(beforeAnalyze).find((r) => r.type === "team" && r.op === "project.analyze");
  assert.equal(teamAnalyze?.ok, true);
  assert.equal(teamAnalyze?.readyToApprove, true);
  assert.equal(teamAnalyze?.state, "suggested");
  assert.ok(
    out.slice(beforeAnalyze).some((r) => r.type === "notice" && /Suggested team ready/.test(r.message)),
    "proposal notice"
  );

  const beforeApprove = out.length;
  const setModelsBefore = setModelCalls.length;
  stdin.write(`${JSON.stringify({ op: "team.approve" })}\n`);
  assert.equal(
    await pollUntil(() => out.slice(beforeApprove).some((r) => r.type === "team" && r.op === "team.approve")),
    true
  );
  assert.ok(setModelCalls.length > setModelsBefore, "approve re-applies Architect via set_model (SIMULATED Pi)");
  assert.equal(setModelCalls.at(-1)?.modelId, ARCHITECT.id);
  const teamApprove = out.slice(beforeApprove).find((r) => r.type === "team" && r.op === "team.approve");
  assert.equal(teamApprove?.state, "active");
  assert.equal(
    [...out].reverse().find((r) => r.type === "engine")?.engine?.status,
    "connected"
  );

  const beforeChat = out.length;
  stdin.write(`${JSON.stringify({ op: "prompt", message: "What is the team status?" })}\n`);
  assert.equal(
    await pollUntil(() => out.slice(beforeChat).some((r) => r.type === "task_result")),
    true
  );
  assert.equal(chatTasks.length, 1);
  assert.equal(chatTasks[0].task, "What is the team status?");
  const result = out.slice(beforeChat).find((r) => r.type === "task_result");
  assert.equal(result?.kind, "answer");
  assert.match(result?.answer ?? "", /^SIMULATED reply to:/);
  assert.equal(result?.provider, "simulated");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("INTEGRATED (SIMULATED eligibility): access loss → recovery.preview → apply activates routes", async () => {
  const { out, stdout } = collectStdout();
  const stdin = new PassThrough();
  const setModelCalls = [];
  let routes = [];
  let teamState = "stale";
  const fingerprints = [];

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    loadKairoProviderModels: async () => routes,
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => defaultPiCommands(cmd, ctx, setModelCalls)
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot({ team: { state: teamState, rows: [], assignments: [] } }),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => routes,
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    },
    recoverProjectTeam: async () => {
      // SIMULATED recovery proposal — no real provider window probe here.
      fingerprints.push("preview");
      return {
        outcome: "proposed",
        fingerprint: "fp-access-loss",
        affected: [{
          role: "Explorer",
          model: "GLM-5.3",
          reason: "OpenCode Go monthly window is rate-limited (simulated)"
        }],
        proposal: {
          projectTeam: [{
            role: "Explorer",
            model: { adapterId: "codex", modelId: "codex-model", displayName: "Codex (simulated)" }
          }]
        }
      };
    },
    approveRecoveryProposal: async () => {
      fingerprints.push("apply");
      routes = [ARCHITECT];
      teamState = "active";
      return { outcome: "approved", fingerprint: "fp-access-loss", strategy: { projectTeam: [] } };
    },
    loadSnapshot: async () => fakeSnapshot({ team: { state: teamState, rows: [], assignments: [] } })
  });

  assert.equal(await pollUntil(() => out.some((r) => r.type === "ready")), true);

  stdin.write(`${JSON.stringify({ op: "team.recovery.preview" })}\n`);
  assert.equal(
    await pollUntil(() => out.some((r) => r.type === "recovery" && r.op === "preview")),
    true
  );
  const preview = out.find((r) => r.type === "recovery" && r.op === "preview");
  assert.equal(preview?.outcome, "proposed");
  assert.match(preview?.affected?.[0]?.reason ?? "", /simulated/);
  assert.equal(setModelCalls.length, 0, "preview never swaps the live model");

  const beforeApply = setModelCalls.length;
  stdin.write(`${JSON.stringify({ op: "team.recovery.apply" })}\n`);
  assert.equal(
    await pollUntil(() => out.some((r) => r.type === "recovery" && r.op === "apply")),
    true
  );
  const applied = [...out].reverse().find((r) => r.type === "recovery" && r.op === "apply");
  assert.equal(applied?.outcome, "approved");
  assert.ok(setModelCalls.length > beforeApply, "apply re-applies Architect");
  assert.deepEqual(fingerprints, ["preview", "apply"]);
  assert.equal([...out].reverse().find((r) => r.type === "snapshot")?.snapshot?.team?.state, "active");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("INTEGRATED (SIMULATED eligibility): access loss → recovery.preview → reject keeps prior team", async () => {
  const { out, stdout } = collectStdout();
  const stdin = new PassThrough();
  const setModelCalls = [];
  let rejectCalls = 0;

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => defaultPiCommands(cmd, ctx, setModelCalls)
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot({ team: { state: "stale", rows: [], assignments: [] } }),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [],
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    },
    recoverProjectTeam: async () => ({
      outcome: "proposed",
      fingerprint: "fp-reject",
      affected: [{ role: "Explorer", model: "Go", reason: "rate-limited (simulated)" }],
      proposal: { projectTeam: [{ role: "Explorer", model: { displayName: "Codex" } }] }
    }),
    rejectRecoveryProposal: async () => {
      rejectCalls += 1;
      return { outcome: "rejected", fingerprint: "fp-reject" };
    },
    approveRecoveryProposal: async () => {
      throw new Error("approve must not run on the reject path");
    },
    loadSnapshot: async () => fakeSnapshot({ team: { state: "active", rows: [], assignments: [] } })
  });

  assert.equal(await pollUntil(() => out.some((r) => r.type === "ready")), true);
  stdin.write(`${JSON.stringify({ op: "team.recovery.preview" })}\n`);
  assert.equal(
    await pollUntil(() => out.some((r) => r.type === "recovery" && r.op === "preview" && r.outcome === "proposed")),
    true
  );

  const modelsBefore = setModelCalls.length;
  stdin.write(`${JSON.stringify({ op: "team.recovery.reject" })}\n`);
  assert.equal(
    await pollUntil(() => out.some((r) => r.type === "recovery" && r.op === "reject")),
    true
  );
  const rejected = [...out].reverse().find((r) => r.type === "recovery" && r.op === "reject");
  assert.equal(rejected?.outcome, "rejected");
  assert.equal(rejectCalls, 1);
  assert.equal(setModelCalls.length, modelsBefore, "reject never touches set_model");
  assert.ok(out.some((r) => r.type === "snapshot"), "reject still refreshes snapshot");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("INTEGRATED (SIMULATED session store): draft survives stop and restores on next ready", async () => {
  const drafts = new Map();
  const KAIRO_ID = "cccccccc-0000-4000-8000-000000000003";

  function openDraftBridge() {
    return async (opts) =>
      openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [ARCHITECT],
        spawnImpl: () =>
          createFakeRpcChild({
            onCommand: (cmd, ctx) => defaultPiCommands(cmd, ctx, [])
          }),
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
  }

  async function bootWithDraft() {
    const { out, stdout } = collectStdout();
    const stdin = new PassThrough();
    const runPromise = runKairoUiRpcStdio({
      stdin,
      stdout,
      cwd: "/project",
      env: { KAIRO_SESSION_ID: KAIRO_ID },
      resolveProjectRoot: async () => "/project",
      listPiSessionFilesForCwd: () => [],
      loadDraft: async (_home, _project, sessionId) => drafts.get(sessionId) ?? null,
      saveDraft: async (_home, _project, sessionId, text) => {
        drafts.set(sessionId, text);
      },
      openBridge: openDraftBridge()
    });
    assert.equal(await pollUntil(() => out.some((r) => r.type === "ready")), true);
    return { out, stdin, runPromise };
  }

  const first = await bootWithDraft();
  first.stdin.write(`${JSON.stringify({ op: "stop", draft: "resume this draft (simulated store)" })}\n`);
  first.stdin.end();
  await first.runPromise;
  assert.equal(drafts.get(KAIRO_ID), "resume this draft (simulated store)");

  const second = await bootWithDraft();
  const ready = second.out.find((r) => r.type === "ready");
  assert.equal(ready?.draft, "resume this draft (simulated store)");
  second.stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  second.stdin.end();
  await second.runPromise;
});
