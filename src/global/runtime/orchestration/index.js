import { join } from "node:path";
import { harnessHomePaths } from "../../paths.js";

export {
  RUN_STRATEGIES, DAG_NODE_STATES, DAG_TERMINAL_STATES, ORCH_LIMITS, ORCH_ERROR_CODES,
  OrchContractError, createTaskId, isTerminalDagState, normalizeRunStrategy,
  createOrchLineage, createBudgetUsage, createDagNode, createMinionBrief,
  createMinionResult, digestAllowlisted
} from "./orch-types.js";
export { assertOrchReceiptSecretFree, FORBIDDEN_KEYS, walkForbiddenKeys } from "./orch-validate.js";
export {
  orchPaths, buildOrchReceipt, saveOrchReceipt, loadOrchReceipt,
  createOrchState, saveOrchState, loadOrchState, terminalizeOrchNodes,
  finalizeOrchState, reconcileOrchState
} from "./orch-receipts.js";

export const KAIRO_MINION_RELATIVE_ASSET =
  "components/orchestrator/extensions/pi/kairo-minion.js";

/** Materialized extension path under ~/.harness (never Pi global auto-discover). */
export function resolveKairoMinionExtensionPath(homeDir) {
  return join(harnessHomePaths(homeDir).root, KAIRO_MINION_RELATIVE_ASSET);
}
