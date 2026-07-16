import { inspectEngramIntegration } from "./engram-evidence.js";
import { planEngramConfigure } from "./engram-plan.js";

const NOT_READY = "Engram provider method is not implemented yet.";

export function createEngramProvider({
  inspect = inspectEngramIntegration,
  plan = planEngramConfigure
} = {}) {
  return {
    id: "engram",
    async inspect(context = {}) {
      return inspect(context);
    },
    async plan(context = {}) {
      return plan(context);
    },
    async apply() {
      throw new Error(NOT_READY);
    },
    async verify() {
      throw new Error(NOT_READY);
    },
    async rollback() {
      throw new Error(NOT_READY);
    }
  };
}
