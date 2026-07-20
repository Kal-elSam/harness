import { planSddConfigure } from "./sdd-plan.js";
import { applySddConfigure } from "./sdd-apply.js";
import { verifySddConfigure } from "./sdd-verify.js";
import { rollbackSddReceipt } from "./sdd-rollback.js";

export function createSddCoreProvider({
  inspect = verifySddConfigure,
  plan = planSddConfigure,
  apply = applySddConfigure,
  verify = verifySddConfigure,
  rollback = rollbackSddReceipt
} = {}) {
  return {
    id: "sdd-core",
    async inspect(context = {}) { return inspect(context); },
    async plan(context = {}) { return plan(context); },
    async apply(context = {}) { return apply(context); },
    async verify(context = {}) { return verify(context); },
    async rollback(context = {}) { return rollback(context); }
  };
}
