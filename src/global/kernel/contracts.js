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

export function createWorkResult({ ok, workerId, summary = null }) {
  return { ok, workerId, summary };
}

export function createExecutionReceipt({ workerId, at = new Date().toISOString(), details = null }) {
  return { workerId, at, details };
}
