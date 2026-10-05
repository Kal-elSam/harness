function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function isWorkRequest(value) {
  return value != null
    && typeof value === "object"
    && nonEmptyString(value.role)
    && nonEmptyString(value.task)
    && nonEmptyString(value.projectRoot)
    && nonEmptyString(value.sessionId);
}

export function createWorkRequest({ role, task, projectRoot, sessionId } = {}) {
  const request = { role, task, projectRoot, sessionId };
  if (!isWorkRequest(request)) {
    throw new Error("WorkRequest requires role, task, projectRoot, and sessionId.");
  }
  return request;
}

export function createContextBundle({ sources = [], budgetTokens = 0 } = {}) {
  return { sources, budgetTokens };
}

export function createRouteDecision({ decision, role, provider = null, why }) {
  return { decision, role, provider, why };
}

export function createWorkEvent({ type, workerId, payload = null, at = new Date().toISOString() }) {
  return { type, workerId, payload, at };
}

const WORK_STATUS = new Set(["completed", "failed", "cancelled"]);

function trimmedOrNull(value) {
  return nonEmptyString(value) ? value.trim() : null;
}

function workResultProblem({ ok, workerId, status, summary, error }) {
  if (typeof ok !== "boolean") return "WorkResult requires a boolean ok.";
  if (!nonEmptyString(workerId)) return "WorkResult requires a non-empty workerId.";
  if (!WORK_STATUS.has(status)) return "WorkResult status must be completed, failed, or cancelled.";
  if (status === "completed") {
    if (!ok) return "A completed WorkResult requires ok:true.";
    if (!nonEmptyString(summary)) return "A completed WorkResult requires a non-empty summary.";
    return null;
  }
  if (ok) return `A ${status} WorkResult requires ok:false.`;
  if (status === "failed" && !nonEmptyString(summary) && !nonEmptyString(error)) {
    return "A failed WorkResult requires a summary or a non-empty error.";
  }
  return null;
}

export function createWorkResult(input) {
  const { ok, workerId, status, summary = null, error = null } = input ?? {};
  const result = {
    ok,
    workerId: nonEmptyString(workerId) ? workerId.trim() : workerId,
    status: status ?? (ok === true ? "completed" : ok === false ? "failed" : undefined),
    summary: trimmedOrNull(summary),
    error: trimmedOrNull(error)
  };
  const problem = workResultProblem(result);
  if (problem) throw new Error(problem);
  return result;
}

export function isWorkResult(value) {
  return value != null && typeof value === "object" && workResultProblem(value) === null;
}

export function createExecutionReceipt({ workerId, at = new Date().toISOString(), details = null }) {
  return { workerId, at, details };
}
