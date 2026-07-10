import { RUN_STATES, STARTING_GRACE_MS } from "./run-types.js";

export function isWithinStartingGrace(run, lock, nowMs = Date.now()) {
  if (run?.state !== RUN_STATES.STARTING && run?.state !== RUN_STATES.PENDING) {
    return false;
  }

  const anchor = lock?.startingAt ?? lock?.startedAt ?? run?.startedAt;
  if (!anchor) return false;

  const elapsed = nowMs - new Date(anchor).getTime();
  return elapsed >= 0 && elapsed < STARTING_GRACE_MS;
}
