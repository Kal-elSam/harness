import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DAG_NODE_STATES, ORCH_ERROR_CODES, ORCH_LIMITS, RUN_STRATEGIES,
  assertOrchReceiptSecretFree, buildOrchReceipt, createBudgetUsage, createDagNode,
  createMinionBrief, createMinionResult, createOrchLineage, createTaskId,
  loadOrchReceipt, normalizeRunStrategy, saveOrchReceipt
} from "../src/global/runtime/orchestration/index.js";
test("strategy, lineage, and DAG nodes enforce depth≤1 and parent rules", () => {
  assert.equal(normalizeRunStrategy(), RUN_STRATEGIES.DIRECT);
  assert.throws(() => normalizeRunStrategy("swarm"), (e) => e.code === ORCH_ERROR_CODES.INVALID_STRATEGY);
  assert.equal(createOrchLineage({ rootRunId: "run_root", depth: 0 }).parentRunId, null);
  assert.throws(() => createOrchLineage({ rootRunId: "r", parentRunId: "x", depth: 0 }),
    (e) => e.code === ORCH_ERROR_CODES.INVALID_LINEAGE);
  assert.throws(() => createOrchLineage({ rootRunId: "r", parentRunId: "p", depth: 2 }),
    (e) => e.code === ORCH_ERROR_CODES.INVALID_DEPTH);
  assert.equal(createOrchLineage({
    rootRunId: "r", parentRunId: "r", depth: 1, taskId: createTaskId()
  }).depth, ORCH_LIMITS.MAX_DEPTH);
  for (const depth of [2, -1, 1.5]) {
    assert.throws(() => createDagNode({ depth }), (e) => e.code === ORCH_ERROR_CODES.INVALID_DEPTH);
  }
  assert.throws(() => createDagNode({ depth: 0, parentTaskId: "p" }),
    (e) => e.code === ORCH_ERROR_CODES.INVALID_NODE);
  assert.throws(() => createDagNode({ depth: 1 }), (e) => e.code === ORCH_ERROR_CODES.INVALID_NODE);
  assert.throws(
    () => buildOrchReceipt({
      rootRunId: "run_x", lineage: { rootRunId: "run_x", depth: 0 },
      nodes: [{ taskId: "t", depth: 2, state: DAG_NODE_STATES.PENDING }], results: []
    }),
    (e) => e.code === ORCH_ERROR_CODES.INVALID_DEPTH
  );
});
test("budget thresholds and secret-free minion handoff", () => {
  assert.equal(createBudgetUsage({ contextTokens: 700, contextLimit: 1000 }).shouldCompact, true);
  assert.equal(createBudgetUsage({ contextTokens: 900, contextLimit: 1000 }).shouldStop, true);
  const brief = createMinionBrief({
    objective: "Inspect auth", constraints: ["read-only"], admittedPaths: ["src/a.js"],
    exitCriteria: ["risks"]
  });
  const result = createMinionResult({
    taskId: brief.taskId, summary: "ok", decisions: ["keep"], files: ["src/a.js"],
    risks: [], evidence: ["guard"], usage: { inputTokens: 10, outputTokens: 4 }
  });
  assert.doesNotMatch(JSON.stringify({ brief, result }), /prompt|transcript|conversation|toolArgs/i);
});
test("orchestration receipts are write-once and reject forbidden keys", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-orch-"));
  try {
    const rootRunId = "run_orch_root_1";
    const sealed = buildOrchReceipt({
      rootRunId, lineage: { rootRunId, depth: 0 },
      nodes: [createDagNode({
        taskId: "task_child", runId: "run_child", parentTaskId: "task_root", depth: 1,
        state: DAG_NODE_STATES.COMPLETED, attempt: 1,
        budget: createBudgetUsage({ contextTokens: 50, contextLimit: 200 })
      })],
      results: [createMinionResult({
        taskId: "task_child", summary: "done", decisions: ["ship"], files: ["a.js"],
        risks: [], evidence: ["ok"]
      })],
      cliVersion: "0.8.0"
    });
    await saveOrchReceipt(sealed, { homeDir });
    await assert.rejects(() => saveOrchReceipt(sealed, { homeDir }),
      (e) => e.code === ORCH_ERROR_CODES.RECEIPT_EXISTS);
    assert.equal((await loadOrchReceipt(rootRunId, { homeDir })).nodes[0].state, DAG_NODE_STATES.COMPLETED);
    for (const leak of [{ prompt: "leak" }, { nodes: [{ ...sealed.nodes[0], objective: "secret task" }] }]) {
      assert.throws(() => assertOrchReceiptSecretFree({ ...sealed, ...leak }),
        (e) => e.code === ORCH_ERROR_CODES.FORBIDDEN_FIELD);
    }
    assert.throws(() => assertOrchReceiptSecretFree({
      ...sealed, lineage: { ...sealed.lineage, rootRunId: "run_other" }
    }), (e) => e.code === ORCH_ERROR_CODES.INVALID_LINEAGE);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
