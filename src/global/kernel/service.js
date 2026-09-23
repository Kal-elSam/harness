import { resolveProjectRoute, PROJECT_ROUTE_DECISION } from "../conversation/project-router.js";
import { BLOCKED_ENTITLEMENTS } from "../conversation/project-strategy.js";
import { createWorkEvent } from "./contracts.js";

export function selectableModels(models = []) {
  return models.filter((model) => !BLOCKED_ENTITLEMENTS.has(model.entitlement));
}

export function createKernelService({
  readStrategy = () => null,
  readAvailability = () => ({}),
  routeProject = resolveProjectRoute,
  spawnAdapter = null
} = {}) {
  return {
    snapshot() {
      return {
        strategy: readStrategy(),
        availability: readAvailability()
      };
    },
    route(request) {
      return routeProject({
        role: request.role,
        strategy: readStrategy(),
        eligibility: readAvailability()
      });
    },
    async conversationTurn() {
      return { ok: true };
    },
    async delegate(request) {
      const decision = this.route(request);
      if (decision.decision !== PROJECT_ROUTE_DECISION.ROUTED) return decision;
      if (!spawnAdapter) return decision;
      return spawnAdapter(decision.provider, request);
    }
  };
}

export function normalizeWorkerLine(line, workerId) {
  const raw = String(line ?? "");
  try {
    const parsed = JSON.parse(raw);
    if (parsed != null && typeof parsed === "object" && typeof parsed.type === "string" && parsed.type.trim() !== "") {
      return createWorkEvent({ type: parsed.type, workerId, payload: parsed });
    }
  } catch {
    /* opaque */
  }
  return createWorkEvent({ type: "opaque", workerId, payload: { raw } });
}
