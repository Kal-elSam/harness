import {
  ORCH_ERROR_CODES, OrchContractError, createBudgetUsage, createDagNode,
  createMinionResult, createOrchLineage, normalizeRunStrategy
} from "./orch-types.js";
export const FORBIDDEN_KEYS = new Set([
  "prompt", "diff", "transcript", "raw", "rawOutput", "stdout", "stderr", "output",
  "message", "messages", "content", "secret", "secrets", "token", "apiKey",
  "conversation", "history", "toolArgs", "arguments", "objective"
]);
function walkForbidden(value, path = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkForbidden(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new OrchContractError(`Forbidden field "${path}${key}" in orchestration receipt.`, {
        code: ORCH_ERROR_CODES.FORBIDDEN_FIELD, details: { key, path }
      });
    }
    walkForbidden(child, `${path}${key}.`);
  }
}
export function assertOrchReceiptSecretFree(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new OrchContractError("Invalid orchestration receipt: expected object.", {
      code: ORCH_ERROR_CODES.FORBIDDEN_FIELD
    });
  }
  walkForbidden(receipt);
  if (receipt.version !== 1) {
    throw new OrchContractError("Orchestration receipt version must be 1.", {
      code: ORCH_ERROR_CODES.FORBIDDEN_FIELD
    });
  }
  normalizeRunStrategy(receipt.strategy);
  if (typeof receipt.rootRunId !== "string" || !receipt.rootRunId) {
    throw new OrchContractError("rootRunId is required on receipt.", {
      code: ORCH_ERROR_CODES.INVALID_LINEAGE
    });
  }
  createOrchLineage(receipt.lineage);
  if (receipt.lineage.rootRunId !== receipt.rootRunId) {
    throw new OrchContractError("lineage.rootRunId must match receipt.rootRunId.", {
      code: ORCH_ERROR_CODES.INVALID_LINEAGE
    });
  }
  if (!Array.isArray(receipt.nodes) || !Array.isArray(receipt.results)) {
    throw new OrchContractError("Receipt requires nodes[] and results[].", {
      code: ORCH_ERROR_CODES.INVALID_NODE
    });
  }
  for (const node of receipt.nodes) {
    createDagNode(node);
    if (node.budget) createBudgetUsage(node.budget);
  }
  for (const result of receipt.results) createMinionResult(result);
  if (typeof receipt.createdAt !== "string" || !receipt.createdAt) {
    throw new OrchContractError("createdAt is required.", { code: ORCH_ERROR_CODES.FORBIDDEN_FIELD });
  }
  return receipt;
}
