import { ROLE_REGISTRY } from "./role-registry.js";

/** Keys are canonical ROLE_REGISTRY IDs, not normalized display labels. */
export const GENTLE_ROLE_MAP = Object.freeze({
  Explorer: "odd-explorer",
  Builder: "odd-worker",
  "Frontend Builder": "odd-worker",
  "Backend Builder": "odd-worker",
  Debugger: "odd-worker",
  Refactorer: "odd-worker",
  Tester: "odd-verify",
  Verifier: "odd-verify"
});

const registryOrder = new Map(Object.keys(ROLE_REGISTRY).map((role, index) => [role, index]));
const preferredRole = { "odd-worker": "Builder", "odd-verify": "Verifier" };

function pickFromAssignment({ role, model }) {
  return {
    role,
    model: model?.modelId ?? null,
    ...(model?.effort == null ? {} : { effort: model.effort })
  };
}

/**
 * Convert an approved strategy's operational projectTeam array without IO.
 * Approval/eligibility validation belongs to the caller, not this projection.
 * Model IDs are preserved verbatim; no provider conversion or fallback choice
 * is inferred. A null assignment remains visible as a null model.
 *
 * Picks carry { role, model, effort? }. Unmapped carries every unsupported
 * assignment in registry order (unknown roles follow in input order).
 * Alternatives records every non-selected candidate, keyed by ODD role.
 * Generic Builder and Verifier win; all remaining ties use registry order.
 * Neither assignments nor their model objects are mutated or returned by reference.
 *
 * @param {Array<{role: string, model: {modelId: string, effort?: string}|null}>} projectTeam
 * @returns {{picks: object, unmapped: Array<object>, alternatives: object}}
 */
export function mapGentleRolePicks(projectTeam = []) {
  const picks = {};
  const unmapped = [];
  const alternatives = {};
  const assignments = [...projectTeam].sort((a, b) => (
    (registryOrder.get(a.role) ?? Infinity) - (registryOrder.get(b.role) ?? Infinity)
  ));

  for (const assignment of assignments) {
    const candidate = pickFromAssignment(assignment);
    if (!Object.hasOwn(GENTLE_ROLE_MAP, assignment.role)) {
      unmapped.push(candidate);
      continue;
    }

    const oddRole = GENTLE_ROLE_MAP[assignment.role];
    if (!picks[oddRole]) {
      picks[oddRole] = candidate;
    } else if (assignment.role === preferredRole[oddRole] && picks[oddRole].role !== assignment.role) {
      // The preferred role may come after another candidate in registry order.
      (alternatives[oddRole] ??= []).unshift(picks[oddRole]);
      picks[oddRole] = candidate;
    } else {
      (alternatives[oddRole] ??= []).push(candidate);
    }
  }

  return { picks, unmapped, alternatives };
}
