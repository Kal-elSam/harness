import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import registerKairoMinion, {
  BUDGET_EXCEEDED, createConcurrencyGate, createProcessRegistry
} from "../global-template/components/orchestrator/extensions/pi/kairo-minion.js";
import {
  DAG_NODE_STATES, createDagNode, createOrchState, finalizeOrchState,
  loadOrchReceipt, loadOrchState, orchPaths, saveOrchState
} from "../src/global/runtime/orchestration/index.js";
import { ORCH_RUNTIME_ENV } from "../src/global/runtime/run-strategy.js";
import { recoverRuns } from "../src/global/runtime/run-manager.js";
import { createRunMetadata, RUN_STATES } from "../src/global/runtime/run-types.js";
import { createRunRecord, readRunState, writeRunState } from "../src/global/runtime/run-store.js";

const ORCH_MODULE = fileURLToPath(new URL("../src/global/runtime/orchestration/index.js", import.meta.url));

function handoffLine(payload) {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(payload) }] }
  });
}

function okLine(taskId) {
  return handoffLine({
    taskId, summary: "done", decisions: [], files: [], risks: [], evidence: ["e"]
  });
}

function stubSpawn({ lines = [], failOnce = false } = {}) {
  let calls = 0;
  return () => {
    calls += 1;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig) => child.emit("close", null, sig);
    queueMicrotask(() => {
      if (failOnce && calls === 1) return child.emit("close", 2, null);
      for (const line of lines) child.stdout.emit("data", `${line}\n`);
      child.emit("close", 0, null);
    });
    return child;
  };
}

function fakePi() {
  const tools = [];
  return { tools, on() {}, registerTool(t) { tools.push(t); } };
}

async function withOrch(fn) {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-minion-dag-"));
  try {
    const rootRunId = "run_dag_root";
    const rootTaskId = "task_root";
    await saveOrchState(createOrchState({
      rootRunId, lineage: { rootRunId, depth: 0, taskId: rootTaskId }, cliVersion: "0.8.0",
      nodes: [createDagNode({
        taskId: rootTaskId, runId: rootRunId, depth: 0, state: DAG_NODE_STATES.RUNNING
      })]
    }), { homeDir });
    const env = {
      [ORCH_RUNTIME_ENV.HOME]: homeDir,
      [ORCH_RUNTIME_ENV.ROOT_RUN_ID]: rootRunId,
      [ORCH_RUNTIME_ENV.ROOT_TASK_ID]: rootTaskId,
      [ORCH_RUNTIME_ENV.CLI_VERSION]: "0.8.0",
      [ORCH_RUNTIME_ENV.MODULE]: ORCH_MODULE
    };
    await fn({ homeDir, rootRunId, rootTaskId, env });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

function toolFor(env, opts = {}) {
  const pi = fakePi();
  const gate = opts.gate ?? createConcurrencyGate();
  const registry = opts.registry ?? createProcessRegistry({ abortGraceMs: 0 });
  registerKairoMinion(pi, env, {
    gate, registry, spawnImpl: opts.spawnImpl, readStatus: opts.readStatus
  });
  return pi.tools[0];
}

test("execute persists depth-1 node and result; state stays secret-free", async () => {
  await withOrch(async ({ homeDir, rootRunId, rootTaskId, env }) => {
    const taskId = "task_child";
    await toolFor(env, { spawnImpl: stubSpawn({ lines: [okLine(taskId)] }) })
      .execute("1", { taskId, parentTaskId: rootTaskId, objective: "secret objective text" });
    const state = await loadOrchState(rootRunId, { homeDir });
    const child = state.nodes.find((n) => n.taskId === taskId);
    assert.equal(child.depth, 1);
    assert.equal(child.state, DAG_NODE_STATES.COMPLETED);
    assert.equal(state.results[0].summary, "done");
    assert.doesNotMatch(await readFile(orchPaths(homeDir, rootRunId).statePath, "utf8"),
      /secret objective|"prompt"|"stdout"/);
  });
});

test("concurrent execute calls preserve both nodes", async () => {
  await withOrch(async ({ homeDir, rootRunId, rootTaskId, env }) => {
    const gate = createConcurrencyGate(2);
    const registry = createProcessRegistry({ abortGraceMs: 0 });
    await Promise.all(["task_a", "task_b"].map((taskId) => toolFor(env, {
      gate, registry, spawnImpl: stubSpawn({ lines: [okLine(taskId)] })
    }).execute("1", { taskId, parentTaskId: rootTaskId, objective: `o-${taskId}` })));
    const state = await loadOrchState(rootRunId, { homeDir });
    assert.equal(state.nodes.filter((n) => n.depth === 1).length, 2);
    assert.equal(state.results.length, 2);
  });
});

test("retry updates attempt without duplicating task", async () => {
  await withOrch(async ({ homeDir, rootRunId, rootTaskId, env }) => {
    const taskId = "task_retry";
    await toolFor(env, { spawnImpl: stubSpawn({ lines: [okLine(taskId)], failOnce: true }) })
      .execute("1", { taskId, parentTaskId: rootTaskId, objective: "retry" });
    const nodes = (await loadOrchState(rootRunId, { homeDir })).nodes.filter((n) => n.taskId === taskId);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].attempt, 2);
    assert.equal(nodes[0].state, DAG_NODE_STATES.COMPLETED);
  });
});

test("cancel and budget_exceeded produce correct terminal states", async () => {
  await withOrch(async ({ homeDir, rootRunId, rootTaskId, env }) => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(() => toolFor(env, { spawnImpl: stubSpawn({ lines: [] }) })
      .execute("1", { taskId: "task_cancel", parentTaskId: rootTaskId, objective: "c" }, ac.signal));
    assert.equal(
      (await loadOrchState(rootRunId, { homeDir })).nodes.find((n) => n.taskId === "task_cancel").state,
      DAG_NODE_STATES.CANCELLED
    );
    await assert.rejects(() => toolFor(env, {
      spawnImpl: stubSpawn({ lines: [] }),
      readStatus: async () => ({ code: BUDGET_EXCEEDED, compact: true })
    }).execute("1", { taskId: "task_budget", parentTaskId: rootTaskId, objective: "b" }));
    const budget = (await loadOrchState(rootRunId, { homeDir })).nodes.find((n) => n.taskId === "task_budget");
    assert.equal(budget.state, DAG_NODE_STATES.FAILED);
    assert.equal(budget.error.code, BUDGET_EXCEEDED);
  });
});

test("finalize seals root+children+results; recovery consumes persisted DAG", async () => {
  await withOrch(async ({ homeDir, rootRunId, rootTaskId, env }) => {
    const taskId = "task_seal";
    await toolFor(env, { spawnImpl: stubSpawn({ lines: [okLine(taskId)] }) })
      .execute("1", { taskId, parentTaskId: rootTaskId, objective: "seal" });
    const sealed = await finalizeOrchState(rootRunId, { homeDir, recovered: false });
    assert.equal(sealed.receipt.recovered, false);
    assert.ok(sealed.receipt.nodes.some((n) => n.taskId === taskId));
    assert.equal(sealed.receipt.results[0].taskId, taskId);

    const rid = "run_recover_dag";
    const tid = "task_root2";
    await createRunRecord(homeDir, createRunMetadata({
      runId: rid, agentId: "pi", provider: "Pi", task: "x", cwd: homeDir,
      cliVersion: "0.8.0", strategy: "orchestrated",
      lineage: { rootRunId: rid, parentRunId: null, depth: 0, taskId: tid }
    }));
    await writeRunState(homeDir, { ...(await readRunState(homeDir, rid)), state: RUN_STATES.INTERRUPTED });
    await saveOrchState(createOrchState({
      rootRunId: rid, lineage: { rootRunId: rid, depth: 0, taskId: tid }, cliVersion: "0.8.0",
      nodes: [createDagNode({ taskId: tid, runId: rid, depth: 0, state: DAG_NODE_STATES.RUNNING })]
    }), { homeDir });
    const env2 = {
      ...env,
      [ORCH_RUNTIME_ENV.ROOT_RUN_ID]: rid,
      [ORCH_RUNTIME_ENV.ROOT_TASK_ID]: tid
    };
    await toolFor(env2, { spawnImpl: stubSpawn({ lines: [okLine("task_live_child")] }) })
      .execute("1", { taskId: "task_live_child", parentTaskId: tid, objective: "persist" });
    await recoverRuns(homeDir);
    const receipt = await loadOrchReceipt(rid, { homeDir });
    assert.equal(receipt.recovered, true);
    assert.ok(receipt.nodes.some((n) => n.taskId === "task_live_child"));
    assert.equal(receipt.results[0].taskId, "task_live_child");
  });
});
