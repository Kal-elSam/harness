import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runPaths } from "../../paths.js";
import { writeAtomicJson } from "../write-atomic-json.js";
import {
  ORCH_ERROR_CODES, OrchContractError, RUN_STRATEGIES, createBudgetUsage, createDagNode,
  createMinionResult, createOrchLineage, digestAllowlisted, normalizeRunStrategy
} from "./orch-types.js";
import { assertOrchReceiptSecretFree } from "./orch-validate.js";
export function orchPaths(homeDir, rootRunId) {
  if (typeof rootRunId !== "string" || !rootRunId) {
    throw new OrchContractError("rootRunId is required for orchestration paths.", {
      code: ORCH_ERROR_CODES.INVALID_LINEAGE
    });
  }
  const { runDir } = runPaths(homeDir, rootRunId);
  const orchDir = join(runDir, "orchestration");
  return { runDir, orchDir, receiptPath: join(orchDir, "receipt.json") };
}
export function buildOrchReceipt({
  rootRunId, strategy = RUN_STRATEGIES.ORCHESTRATED, lineage = null,
  nodes = [], results = [], cliVersion = null, createdAt = null
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
    nodes: nodes.map((node) => {
      const { objective, ...rest } = node;
      return createDagNode({
        ...rest, budget: createBudgetUsage(rest.budget ?? {}),
        objectiveDigest: rest.objectiveDigest
          ?? (objective ? digestAllowlisted({ objective }) : null)
      });
    }),
    results: results.map((entry) => createMinionResult(entry)),
    createdAt: createdAt ?? new Date().toISOString(), cliVersion
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
