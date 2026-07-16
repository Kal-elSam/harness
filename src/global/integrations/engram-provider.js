import { inspectEngramIntegration } from "./engram-evidence.js";
import { planEngramConfigure } from "./engram-plan.js";
import { applyEngramConfigure } from "./engram-apply.js";

const NOT_READY = "Engram provider method is not implemented yet.";

export function createEngramProvider({
  inspect = inspectEngramIntegration,
  plan = planEngramConfigure,
  apply = applyEngramConfigure
} = {}) {
  return {
    id: "engram",
    async inspect(context = {}) {
      return inspect(context);
    },
    async plan(context = {}) {
      return plan(context);
    },
    async apply(context = {}) {
      return apply(context);
    },
    async verify() {
      throw new Error(NOT_READY);
    },
    async rollback() {
      throw new Error(NOT_READY);
    }
  };
}
