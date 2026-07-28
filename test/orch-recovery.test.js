import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DAG_NODE_STATES, ORCH_ERROR_CODES, assertOrchReceiptSecretFree, buildOrchReceipt,
  createDagNode, createOrchLineage, createOrchState, finalizeOrchState, loadOrchReceipt,
  loadOrchState, orchPaths, reconcileOrchState, saveOrchReceipt, saveOrchState
} from "../src/global/runtime/orchestration/index.js";
import { recoverRuns } from "../src/global/runtime/run-manager.js";
import { createRunMetadata, RUN_STATES } from "../src/global/runtime/run-types.js";
import { createRunRecord, readRunState, writeRunState } from "../src/global/runtime/run-store.js";

test("orch state transitions persist atomically and secret-free", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-orch-state-"));
  try {
    const rootRunId = "run_state_1";
    const lineage = createOrchLineage({ rootRunId, depth: 0, taskId: "task_root" });
    const saved = await saveOrchState(createOrchState({
      rootRunId, lineage, cliVersion: "0.8.0",
      nodes: [createDagNode({
        taskId: "task_root", runId: rootRunId, depth: 0, state: DAG_NODE_STATES.RUNNING
      })]
    }), { homeDir });
    assert.equal(saved.path, orchPaths(homeDir, rootRunId).statePath);
    await saveOrchState({
      ...(await loadOrchState(rootRunId, { homeDir })),
      nodes: [createDagNode({
        taskId: "task_root", runId: rootRunId, depth: 0, state: DAG_NODE_STATES.COMPLETED, attempt: 1
      })]
    }, { homeDir });
    assert.equal((await loadOrchState(rootRunId, { homeDir })).nodes[0].state, DAG_NODE_STATES.COMPLETED);
    assert.doesNotMatch(await readFile(saved.path, "utf8"), /"(objective|prompt|stdout|transcript)"/);
    assert.throws(
      () => assertOrchReceiptSecretFree({
        ...buildOrchReceipt({
          rootRunId, lineage, nodes: [], results: [], cliVersion: "0.8.0"
        }),
        prompt: "leak"
      }),
      (e) => e.code === ORCH_ERROR_CODES.FORBIDDEN_FIELD
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("normal finalize seals one receipt; preexisting never replaced", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-orch-final-"));
  try {
    const rootRunId = "run_final_1";
    await saveOrchState(createOrchState({
      rootRunId, lineage: { rootRunId, depth: 0, taskId: "task_root" },
      nodes: [createDagNode({
        taskId: "task_root", runId: rootRunId, depth: 0, state: DAG_NODE_STATES.RUNNING
      })],
      cliVersion: "0.8.0"
    }), { homeDir });
    const first = await finalizeOrchState(rootRunId, { homeDir, recovered: false });
    assert.equal(first.idempotent, false);
    assert.equal(first.receipt.recovered, false);
    assert.equal(first.receipt.nodes[0].state, DAG_NODE_STATES.COMPLETED);
    const second = await finalizeOrchState(rootRunId, { homeDir, recovered: false });
    assert.equal(second.idempotent, true);
    assert.equal(second.receipt.createdAt, first.receipt.createdAt);
    await assert.rejects(
      () => saveOrchReceipt(first.receipt, { homeDir }),
      (e) => e.code === ORCH_ERROR_CODES.RECEIPT_EXISTS
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("recovery cancels non-terminal nodes, seals recovered receipt, is idempotent", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-orch-recover-"));
  try {
    const rootRunId = "run_recover_1";
    const lineage = { rootRunId, parentRunId: null, depth: 0, taskId: "task_root" };
    await createRunRecord(homeDir, createRunMetadata({
      runId: rootRunId, agentId: "pi", provider: "Pi", task: "x", cwd: homeDir,
      cliVersion: "0.8.0", strategy: "orchestrated", lineage
    }));
    const current = await readRunState(homeDir, rootRunId);
    await writeRunState(homeDir, { ...current, state: RUN_STATES.INTERRUPTED });
    await saveOrchState(createOrchState({
      rootRunId, lineage,
      nodes: [
        createDagNode({
          taskId: "task_root", runId: rootRunId, depth: 0, state: DAG_NODE_STATES.RUNNING
        }),
        createDagNode({
          taskId: "task_child", runId: "run_child", parentTaskId: "task_root", depth: 1,
          state: DAG_NODE_STATES.PENDING
        })
      ],
      cliVersion: "0.8.0"
    }), { homeDir });

    const sealed = await reconcileOrchState(rootRunId, { homeDir });
    assert.equal(sealed.receipt.recovered, true);
    assert.ok(sealed.receipt.nodes.every((n) => n.state === DAG_NODE_STATES.CANCELLED));
    assertOrchReceiptSecretFree(sealed.receipt);

    const again = await reconcileOrchState(rootRunId, { homeDir });
    assert.equal(again.idempotent, true);
    assert.equal(again.receipt.createdAt, sealed.receipt.createdAt);
    await recoverRuns(homeDir);
    assert.equal((await loadOrchReceipt(rootRunId, { homeDir })).createdAt, sealed.receipt.createdAt);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("recoverRuns preserves live orchestrated run without sealing recovered receipt", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-orch-alive-"));
  try {
    const rootRunId = "run_orch_alive";
    const lineage = { rootRunId, parentRunId: null, depth: 0, taskId: "task_root" };
    await createRunRecord(homeDir, createRunMetadata({
      runId: rootRunId, agentId: "pi", provider: "Pi", task: "x", cwd: homeDir,
      cliVersion: "0.8.0", strategy: "orchestrated", lineage
    }));
    const run = await readRunState(homeDir, rootRunId);
    await writeRunState(homeDir, { ...run, state: RUN_STATES.RUNNING, pid: process.pid });
    await saveOrchState(createOrchState({
      rootRunId, lineage, cliVersion: "0.8.0",
      nodes: [
        createDagNode({ taskId: "task_root", runId: rootRunId, depth: 0, state: DAG_NODE_STATES.RUNNING }),
        createDagNode({ taskId: "task_child", runId: "run_child", parentTaskId: "task_root", depth: 1, state: DAG_NODE_STATES.PENDING })
      ]
    }), { homeDir });
    await recoverRuns(homeDir);
    assert.equal((await readRunState(homeDir, rootRunId)).state, RUN_STATES.RUNNING);
    await assert.rejects(() => loadOrchReceipt(rootRunId, { homeDir }));
    assert.equal((await loadOrchState(rootRunId, { homeDir })).nodes[1].state, DAG_NODE_STATES.PENDING);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("corrupt state fails closed without fabricating a receipt", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-orch-corrupt-"));
  try {
    const rootRunId = "run_corrupt_1";
    const { orchDir, statePath, receiptPath } = orchPaths(homeDir, rootRunId);
    await mkdir(orchDir, { recursive: true });
    await writeFile(statePath, "{not-json", "utf8");
    await assert.rejects(() => loadOrchState(rootRunId, { homeDir }),
      (e) => e.code === ORCH_ERROR_CODES.INVALID_NODE);
    await assert.rejects(() => finalizeOrchState(rootRunId, { homeDir }),
      (e) => e.code === ORCH_ERROR_CODES.INVALID_NODE);
    await assert.rejects(() => readFile(receiptPath, "utf8"));
    await assert.rejects(() => reconcileOrchState(rootRunId, { homeDir }),
      (e) => e.code === ORCH_ERROR_CODES.INVALID_NODE);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
