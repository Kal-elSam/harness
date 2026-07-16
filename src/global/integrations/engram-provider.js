import { inspectEngramIntegration } from "./engram-evidence.js";
import { planEngramConfigure } from "./engram-plan.js";
import { applyEngramConfigureWithReceipt } from "./engram-rollback.js";
import { rollbackEngramReceipt } from "./engram-rollback.js";

const NOT_READY = "Engram provider method is not implemented yet.";

export function createEngramProvider({
  inspect = inspectEngramIntegration,
  plan = planEngramConfigure,
  apply = applyEngramConfigureWithReceipt,
  rollback = rollbackEngramReceipt
} = {}) {
  return {
    id: "engram",
    async inspect(context = {}) { return inspect(context); },
    async plan(context = {}) { return plan(context); },
    async apply(context = {}) { return apply(context); },
    async verify() { throw new Error(NOT_READY); },
    async rollback(context = {}) { return rollback(context); }
  };
}
