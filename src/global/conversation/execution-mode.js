/**
 * Execution mode bound into a delegated run's confirmation. `standard` is the
 * historical behavior (no extra permission tokens); `read-only` requests the
 * `read-only` permission token. A target with no mode IS standard, so older
 * confirmations keep validating. Propagation only: whether an adapter can
 * actually contain a read-only run is decided by run-permissions.
 */
export const EXECUTION_MODES = Object.freeze(["standard", "read-only"]);
export const READ_ONLY_MODE = "read-only";

/** Absent => "standard"; unknown values => null (callers treat as refusal). */
export function normalizeExecutionMode(mode) {
  if (mode === undefined || mode === null) return "standard";
  return EXECUTION_MODES.includes(mode) ? mode : null;
}

export class ExecutionModeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExecutionModeError";
    this.code = code;
  }
}
