import { isActiveRunState } from "../runtime/run-types.js";

export function isRunCancellable(run) {
  return run && isActiveRunState(run.state);
}
