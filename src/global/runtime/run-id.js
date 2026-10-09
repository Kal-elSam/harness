/**
 * A run id is joined straight into the runs directory (`runPaths`), so it must be a plain
 * file-name-like token: no separators, no dot-dot, bounded length.
 */
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function isSafeRunId(runId) {
  return typeof runId === "string" && SAFE_RUN_ID.test(runId) && !runId.includes("..");
}
