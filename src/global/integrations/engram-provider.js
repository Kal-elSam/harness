import { inspectEngramIntegration } from "./engram-evidence.js";
import { planEngramConfigure } from "./engram-plan.js";
import {
  applyEngramConfigureWithReceipt,
  rollbackEngramReceipt
} from "./engram-rollback.js";

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
    async verify(context = {}) { return inspect(context); },
    async rollback(context = {}) { return rollback(context); }
  };
}
