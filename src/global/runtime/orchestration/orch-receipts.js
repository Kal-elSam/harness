import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runPaths } from "../../paths.js";
import { writeAtomicJson } from "../write-atomic-json.js";
import {
  DAG_NODE_STATES, ORCH_ERROR_CODES, OrchContractError, RUN_STRATEGIES,
  createBudgetUsage, createDagNode, createMinionResult, createOrchLineage,
  digestAllowlisted, isTerminalDagState, normalizeRunStrategy
} from "./orch-types.js";
import { assertOrchReceiptSecretFree, walkForbiddenKeys } from "./orch-validate.js";

export function orchPaths(homeDir, rootRunId) {
  if (typeof rootRunId !== "string" || !rootRunId) {
    throw new OrchContractError("rootRunId is required for orchestration paths.", {
      code: ORCH_ERROR_CODES.INVALID_LINEAGE
    });
  }
  const { runDir } = runPaths(homeDir, rootRunId);
  const orchDir = join(runDir, "orchestration");
  return {
    runDir, orchDir,
    receiptPath: join(orchDir, "receipt.json"),
    statePath: join(orchDir, "state.json")
  };
}

function normalizeNodes(nodes = []) {
  return nodes.map((node) => {
    const { objective, ...rest } = node;
    return createDagNode({
      ...rest,
      budget: createBudgetUsage(rest.budget ?? {}),
      objectiveDigest: rest.objectiveDigest
        ?? (objective ? digestAllowlisted({ objective }) : null)
    });
  });
}

export function buildOrchReceipt({
  rootRunId, strategy = RUN_STRATEGIES.ORCHESTRATED, lineage = null,
  nodes = [], results = [], cliVersion = null, createdAt = null, recovered = false
} = {}) {
  const normalizedStrategy = normalizeRunStrategy(strategy);
  const normalizedLineage = createOrchLineage(lineage ?? { rootRunId, parentRunId: null, depth: 0 });
  if (normalizedLineage.rootRunId !== rootRunId) {
    throw new OrchContractError("lineage.rootRunId must match receipt rootRunId.", {
      code: ORCH_ERROR_CODES.INVALID_LINEAGE
    });
  }
  return assertOrchReceiptSecretFree({
    version: 1, strategy: normalizedStrategy, rootRunId, lineage: normalizedLineage,
    nodes: normalizeNodes(nodes),
    results: results.map((entry) => createMinionResult(entry)),
    createdAt: createdAt ?? new Date().toISOString(),
    cliVersion,
    recovered: Boolean(recovered)
  });
}

export async function saveOrchReceipt(receipt, { homeDir } = {}) {
  const sanitized = assertOrchReceiptSecretFree(receipt);
  const { orchDir, receiptPath } = orchPaths(homeDir, sanitized.rootRunId);
  await mkdir(orchDir, { recursive: true });
  try {
    await writeAtomicJson(receiptPath, sanitized, { createExclusive: true });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new OrchContractError(`Orchestration receipt already exists: ${sanitized.rootRunId}`, {
        code: ORCH_ERROR_CODES.RECEIPT_EXISTS,
        details: { rootRunId: sanitized.rootRunId, path: receiptPath }
      });
    }
    throw error;
  }
  return { path: receiptPath, receipt: sanitized };
}

export async function loadOrchReceipt(rootRunId, { homeDir } = {}) {
  const { receiptPath } = orchPaths(homeDir, rootRunId);
  if (!existsSync(receiptPath)) {
    throw new OrchContractError(`Orchestration receipt not found: ${rootRunId}`, {
      code: ORCH_ERROR_CODES.INVALID_LINEAGE, details: { rootRunId }
    });
  }
  return assertOrchReceiptSecretFree(JSON.parse(await readFile(receiptPath, "utf8")));
}

export function createOrchState({
  rootRunId, strategy = RUN_STRATEGIES.ORCHESTRATED, lineage = null,
  nodes = [], results = [], cliVersion = null, updatedAt = null
} = {}) {
  const normalizedStrategy = normalizeRunStrategy(strategy);
  if (normalizedStrategy !== RUN_STRATEGIES.ORCHESTRATED) {
    throw new OrchContractError("Orchestration state requires strategy orchestrated.", {
      code: ORCH_ERROR_CODES.INVALID_STRATEGY
    });
  }
  const normalizedLineage = createOrchLineage(lineage ?? { rootRunId, parentRunId: null, depth: 0 });
  if (normalizedLineage.rootRunId !== rootRunId) {
    throw new OrchContractError("lineage.rootRunId must match state rootRunId.", {
      code: ORCH_ERROR_CODES.INVALID_LINEAGE
    });
  }
  const state = {
    version: 1, strategy: normalizedStrategy, rootRunId, lineage: normalizedLineage,
    nodes: normalizeNodes(nodes),
    results: (results ?? []).map((entry) => createMinionResult(entry)),
    cliVersion: cliVersion ?? null,
    updatedAt: updatedAt ?? new Date().toISOString()
  };
  walkForbiddenKeys(state);
  return state;
}

export async function saveOrchState(state, { homeDir } = {}) {
  const sanitized = createOrchState(state);
  const { orchDir, statePath } = orchPaths(homeDir, sanitized.rootRunId);
  await mkdir(orchDir, { recursive: true });
  await writeAtomicJson(statePath, sanitized);
  return { path: statePath, state: sanitized };
}

export async function loadOrchState(rootRunId, { homeDir } = {}) {
  const { statePath } = orchPaths(homeDir, rootRunId);
  if (!existsSync(statePath)) {
    throw new OrchContractError(`Orchestration state not found: ${rootRunId}`, {
      code: ORCH_ERROR_CODES.INVALID_NODE, details: { rootRunId }
    });
  }
  try {
    return createOrchState(JSON.parse(await readFile(statePath, "utf8")));
  } catch {
    throw new OrchContractError(`Corrupt orchestration state: ${rootRunId}`, {
      code: ORCH_ERROR_CODES.INVALID_NODE, details: { rootRunId }
    });
  }
}

export function terminalizeOrchNodes(nodes, { recovered = false } = {}) {
  return (nodes ?? []).map((node) => {
    if (isTerminalDagState(node.state)) return createDagNode(node);
    return createDagNode({
      ...node,
      state: recovered ? DAG_NODE_STATES.CANCELLED : DAG_NODE_STATES.COMPLETED,
      error: recovered ? (node.error ?? { code: "interrupted" }) : node.error
    });
  });
}

const orchWriteLocks = new Map();

function withOrchWriteLock(rootRunId, work) {
  const previous = orchWriteLocks.get(rootRunId) ?? Promise.resolve();
  const next = previous.then(work);
  orchWriteLocks.set(rootRunId, next.catch(() => {}));
  return next;
}

/** Serialized load → mutate → save for concurrent minion DAG updates. */
export async function updateOrchState(rootRunId, mutator, { homeDir } = {}) {
  return withOrchWriteLock(rootRunId, async () => {
    const current = await loadOrchState(rootRunId, { homeDir });
    return saveOrchState(await mutator(current), { homeDir });
  });
}

/** Upsert one depth-1 node by taskId; append/replace MinionResult on completed. */
export async function applyMinionDagUpdate(rootRunId, {
  homeDir, taskId, parentTaskId, rootTaskId, attempt = 0, state,
  objectiveDigest = null, result = null, error = null
} = {}) {
  if (!rootTaskId || taskId === rootTaskId || parentTaskId !== rootTaskId) {
    throw new OrchContractError("Minion taskId/parentTaskId must honor supervisor rootTaskId.", {
      code: ORCH_ERROR_CODES.INVALID_NODE, details: { taskId, parentTaskId, rootTaskId }
    });
  }
  return updateOrchState(rootRunId, (current) => {
    const node = createDagNode({
      taskId, parentTaskId, depth: 1, state, attempt,
      objectiveDigest: objectiveDigest ?? null, error: error ?? null
    });
    const nodes = [...current.nodes];
    const idx = nodes.findIndex((entry) => entry.taskId === taskId);
    if (idx >= 0) {
      nodes[idx] = createDagNode({
        ...nodes[idx], ...node,
        objectiveDigest: node.objectiveDigest ?? nodes[idx].objectiveDigest
      });
    } else {
      nodes.push(node);
    }
    let results = current.results;
    if (state === DAG_NODE_STATES.COMPLETED && result) {
      const sealed = createMinionResult(result);
      results = [...results.filter((entry) => entry.taskId !== taskId), sealed];
    }
    return { ...current, nodes, results, updatedAt: new Date().toISOString() };
  }, { homeDir });
}

export async function finalizeOrchState(rootRunId, { homeDir, recovered = false } = {}) {
  return withOrchWriteLock(rootRunId, async () => {
    const { receiptPath } = orchPaths(homeDir, rootRunId);
    if (existsSync(receiptPath)) {
      return { path: receiptPath, receipt: await loadOrchReceipt(rootRunId, { homeDir }), idempotent: true };
    }
    const state = await loadOrchState(rootRunId, { homeDir });
    const nodes = terminalizeOrchNodes(state.nodes, { recovered });
    await saveOrchState({ ...state, nodes, updatedAt: new Date().toISOString() }, { homeDir });
    try {
      const saved = await saveOrchReceipt(buildOrchReceipt({
        rootRunId: state.rootRunId, strategy: state.strategy, lineage: state.lineage,
        nodes, results: state.results, cliVersion: state.cliVersion, recovered
      }), { homeDir });
      return { ...saved, idempotent: false };
    } catch (error) {
      if (error?.code === ORCH_ERROR_CODES.RECEIPT_EXISTS) {
        return { path: receiptPath, receipt: await loadOrchReceipt(rootRunId, { homeDir }), idempotent: true };
      }
      throw error;
    }
  });
}

export async function reconcileOrchState(rootRunId, { homeDir } = {}) {
  const { statePath, receiptPath } = orchPaths(homeDir, rootRunId);
  if (existsSync(receiptPath)) {
    return { rootRunId, path: receiptPath, receipt: await loadOrchReceipt(rootRunId, { homeDir }), idempotent: true };
  }
  if (!existsSync(statePath)) return null;
  return finalizeOrchState(rootRunId, { homeDir, recovered: true });
}
