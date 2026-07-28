import { createHash, randomBytes } from "node:crypto";
export const RUN_STRATEGIES = Object.freeze({ DIRECT: "direct", ORCHESTRATED: "orchestrated" });
export const DAG_NODE_STATES = Object.freeze({
  PENDING: "pending", READY: "ready", RUNNING: "running", COMPACTING: "compacting",
  COMPLETED: "completed", FAILED: "failed", CANCELLED: "cancelled", BLOCKED: "blocked"
});
export const DAG_TERMINAL_STATES = new Set([
  DAG_NODE_STATES.COMPLETED, DAG_NODE_STATES.FAILED, DAG_NODE_STATES.CANCELLED
]);
export const ORCH_LIMITS = Object.freeze({
  MAX_DEPTH: 1, DEFAULT_CONCURRENCY: 2, MAX_ATTEMPTS: 2, COMPACT_RATIO: 0.7, STOP_RATIO: 0.9
});
export const ORCH_ERROR_CODES = Object.freeze({
  INVALID_STRATEGY: "invalid_strategy", INVALID_DEPTH: "invalid_depth",
  INVALID_LINEAGE: "invalid_lineage", INVALID_HANDOFF: "invalid_handoff",
  INVALID_NODE: "invalid_node", LIMIT_EXCEEDED: "limit_exceeded",
  FORBIDDEN_FIELD: "forbidden_field", RECEIPT_EXISTS: "receipt_exists"
});
export class OrchContractError extends Error {
  constructor(message, { code, details = null } = {}) {
    super(message);
    this.name = "OrchContractError";
    this.code = code;
    this.details = details;
  }
}
export function createTaskId() {
  return `task_${randomBytes(8).toString("hex")}`;
}
export function isTerminalDagState(state) {
  return DAG_TERMINAL_STATES.has(state);
}

function assertDepth(depth) {
  const d = Number(depth);
  if (!Number.isInteger(d) || d < 0) {
    throw new OrchContractError(`Invalid depth "${depth}".`, {
      code: ORCH_ERROR_CODES.INVALID_DEPTH, details: { depth }
    });
  }
  if (d > ORCH_LIMITS.MAX_DEPTH) {
    throw new OrchContractError(`Orchestration depth ${d} exceeds max ${ORCH_LIMITS.MAX_DEPTH}.`, {
      code: ORCH_ERROR_CODES.INVALID_DEPTH, details: { depth: d }
    });
  }
  return d;
}

function assertParentForDepth(depth, parentId, { rootMsg, minionMsg, code }) {
  if (depth === 0 && parentId != null) {
    throw new OrchContractError(rootMsg, { code });
  }
  if (depth > 0 && !parentId) {
    throw new OrchContractError(minionMsg, { code });
  }
}

export function normalizeRunStrategy(value = RUN_STRATEGIES.DIRECT) {
  const strategy = String(value ?? RUN_STRATEGIES.DIRECT).trim().toLowerCase();
  if (!Object.values(RUN_STRATEGIES).includes(strategy)) {
    throw new OrchContractError(`Invalid run strategy "${value}". Use direct or orchestrated.`, {
      code: ORCH_ERROR_CODES.INVALID_STRATEGY, details: { value }
    });
  }
  return strategy;
}

/** Lineage: max depth 1 (root=0, minion=1). */
export function createOrchLineage({ rootRunId, parentRunId = null, taskId = null, depth = 0 } = {}) {
  if (typeof rootRunId !== "string" || !rootRunId) {
    throw new OrchContractError("rootRunId is required.", { code: ORCH_ERROR_CODES.INVALID_LINEAGE });
  }
  const d = assertDepth(depth);
  assertParentForDepth(d, parentRunId, {
    rootMsg: "Root nodes must not set parentRunId.",
    minionMsg: "Minion nodes require parentRunId.",
    code: ORCH_ERROR_CODES.INVALID_LINEAGE
  });
  return { rootRunId, parentRunId: parentRunId ?? null, taskId: taskId ?? createTaskId(), depth: d };
}

export function createBudgetUsage({
  contextTokens = 0, contextLimit = 0,
  compactRatio = ORCH_LIMITS.COMPACT_RATIO, stopRatio = ORCH_LIMITS.STOP_RATIO
} = {}) {
  const tokens = Math.max(0, Number(contextTokens) || 0);
  const limit = Math.max(0, Number(contextLimit) || 0);
  const ratio = limit > 0 ? tokens / limit : 0;
  return {
    contextTokens: tokens, contextLimit: limit, ratio,
    shouldCompact: limit > 0 && ratio >= compactRatio && ratio < stopRatio,
    shouldStop: limit > 0 && ratio >= stopRatio
  };
}

export function createDagNode({
  taskId = null, runId = null, parentTaskId = null, depth = 0,
  state = DAG_NODE_STATES.PENDING, dependsOn = [], attempt = 0,
  objectiveDigest = null, budget = null, resultDigest = null, error = null
} = {}) {
  if (!Object.values(DAG_NODE_STATES).includes(state)) {
    throw new OrchContractError(`Invalid DAG node state "${state}".`, {
      code: ORCH_ERROR_CODES.INVALID_NODE, details: { state }
    });
  }
  const d = assertDepth(depth);
  assertParentForDepth(d, parentTaskId, {
    rootMsg: "Root nodes must not set parentTaskId.",
    minionMsg: "Minion nodes require parentTaskId.",
    code: ORCH_ERROR_CODES.INVALID_NODE
  });
  const attempts = Number(attempt) || 0;
  if (attempts < 0 || attempts > ORCH_LIMITS.MAX_ATTEMPTS) {
    throw new OrchContractError(`Attempt ${attempts} outside 0..${ORCH_LIMITS.MAX_ATTEMPTS}.`, {
      code: ORCH_ERROR_CODES.LIMIT_EXCEEDED, details: { attempt: attempts }
    });
  }
  const deps = [...new Set((dependsOn ?? []).map((id) => {
    if (typeof id !== "string" || !id) {
      throw new OrchContractError("Dependency taskId is required.", { code: ORCH_ERROR_CODES.INVALID_NODE });
    }
    return id;
  }))];
  return {
    taskId: taskId ?? createTaskId(), runId: runId ?? null, parentTaskId: parentTaskId ?? null,
    depth: d, state, dependsOn: deps, attempt: attempts,
    objectiveDigest, budget: budget ?? null, resultDigest, error: error ?? null
  };
}

export function createMinionBrief({
  objective, constraints = [], admittedPaths = [], exitCriteria = [],
  parentTaskId = null, taskId = null
} = {}) {
  if (typeof objective !== "string" || !objective.trim()) {
    throw new OrchContractError("Minion brief requires a non-empty objective.", {
      code: ORCH_ERROR_CODES.INVALID_HANDOFF
    });
  }
  return {
    taskId: taskId ?? createTaskId(), parentTaskId: parentTaskId ?? null,
    objective: objective.trim(), constraints: (constraints ?? []).map(String),
    admittedPaths: (admittedPaths ?? []).map(String), exitCriteria: (exitCriteria ?? []).map(String)
  };
}

export function createMinionResult({
  taskId = null, summary, decisions = [], files = [], risks = [],
  evidence = [], usage = null, compact = false
} = {}) {
  if (typeof taskId !== "string" || !taskId) {
    throw new OrchContractError("Minion result requires taskId.", { code: ORCH_ERROR_CODES.INVALID_HANDOFF });
  }
  if (typeof summary !== "string" || !summary.trim()) {
    throw new OrchContractError("Minion result requires a non-empty summary.", {
      code: ORCH_ERROR_CODES.INVALID_HANDOFF
    });
  }
  return {
    taskId, summary: summary.trim(),
    decisions: (decisions ?? []).map(String), files: (files ?? []).map(String),
    risks: (risks ?? []).map(String), evidence: (evidence ?? []).map(String),
    usage: {
      inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null, cost: usage?.cost ?? null
    },
    compact: Boolean(compact)
  };
}

export function digestAllowlisted(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
