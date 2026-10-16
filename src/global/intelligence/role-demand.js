// Selection policy, not adapter availability or ask-routing policy. Callers may
// override this single default through the builders' `teamProviders` option.
export const TEAM_PROVIDERS = Object.freeze(["claude", "codex"]);

// Existing normalized required-capability gapValue, never pool percentiles.
// Calibration (2026-10-15): live Architect/Reviewer gap values .6415 and
// .6595 straddle .65 by margins inside evidence noise. Demanding .60 admits
// both, plus .6135, while excluding .58. This avoids defeating quota balance
// before cost selection. Builder remains .60; light .35 admits cheap .392
// Tester evidence. Thresholds are policy, not task-success probabilities.
export const ROLE_DEMAND_FLOORS = Object.freeze({ demanding: .60, standard: .60, light: .35 });
function tierFloor(role) {
  if (["Architect", "Debugger", "Reviewer"].includes(role)) return ROLE_DEMAND_FLOORS.demanding;
  if (["Explorer", "Tester"].includes(role)) return ROLE_DEMAND_FLOORS.light;
  return ROLE_DEMAND_FLOORS.standard;
}
/** `projectDemand` is projectDemand(profile) or null; null keeps the global tier floor. */
export function roleDemandFloor(role, projectDemand = null) {
  return projectDemand?.floors?.[role] ?? tierFloor(role);
}

// S14: the project profile (project-profile.js computeProjectProfile) changes
// per-role demand for THAT project. The profile exposes no complexity enum, so
// only fields it really carries are mapped: risks[].kind and architecture.pattern.
// Each matched signal raises the floors of the roles that guard it by one fixed
// step (never stacked per role). Light roles are never touched, and nothing
// relaxes a floor: unknown/absent values leave today's tier floors exactly.
export const PROJECT_FLOOR_RAISE = .05;
export const MAX_PROJECT_FLOOR = .95;
export const PROJECT_DEMAND_SIGNALS = Object.freeze({
  risk: Object.freeze({
    "no-test-command": ["Reviewer", "Debugger"], // no tests: review and debugging are the only guard
    "no-static-checks": ["Reviewer"], // no lint/typecheck: review is the only static check
    "env-file-present": ["Architect", "Reviewer"] // secrets handling needs design and review care
  }),
  architecture: Object.freeze({
    "Layered or Clean Architecture": ["Architect", "Builder", "Reviewer"] // boundaries to design, respect and review
  })
});
/**
 * @param {object|null} profile - computeProjectProfile() result (or any object with the same fields)
 * @returns {{floors: Record<string, number>, reasons: Record<string, string>}|null} null when nothing applies
 */
export function projectDemand(profile) {
  if (!profile || typeof profile !== "object") return null;
  const causes = new Map();
  const add = (roles, cause) => { for (const role of roles ?? []) causes.set(role, [...(causes.get(role) ?? []), cause]); };
  for (const risk of Array.isArray(profile.risks) ? profile.risks : []) {
    add(Object.hasOwn(PROJECT_DEMAND_SIGNALS.risk, risk?.kind) ? PROJECT_DEMAND_SIGNALS.risk[risk.kind] : null, `project risk ${risk.kind}`);
  }
  const pattern = profile.architecture?.pattern;
  if (typeof pattern === "string" && Object.hasOwn(PROJECT_DEMAND_SIGNALS.architecture, pattern)) {
    add(PROJECT_DEMAND_SIGNALS.architecture[pattern], `project architecture ${pattern}`);
  }
  if (!causes.size) return null;
  const floors = {};
  const reasons = {};
  for (const [role, list] of causes) {
    const base = tierFloor(role);
    floors[role] = Math.min(MAX_PROJECT_FLOOR, Math.round((base + PROJECT_FLOOR_RAISE) * 100) / 100);
    reasons[role] = `Raised demand floor ${base} to ${floors[role]}: ${[...new Set(list)].join("; ")}.`;
  }
  return { floors, reasons };
}
export function withProjectReason(entries, projectDemand) {
  if (!projectDemand) return entries;
  return entries.map(entry => projectDemand.reasons[entry.role]
    ? { ...entry, reason: `${entry.reason ? `${entry.reason} ` : ""}${projectDemand.reasons[entry.role]}` } : entry);
}

// S19: within the floor-qualified pool the pick is a role-weighted trade-off,
// utility = capability * capabilityWeight - normalizedCost * costWeight, not
// "cheapest qualified wins". Capability is the same absolute score the floors
// use; cost is the quota-adjusted weight (model-cost.js) relative to the pool's
// most expensive candidate. Demanding roles weight capability far above cost,
// light roles weight cost highest, Builder sits between. There is no separate
// orchestrator team role: the project's orchestrator is the Architect assignment.
export const ROLE_TRADEOFF_WEIGHTS = Object.freeze({
  demanding: Object.freeze({ capability: .90, cost: .10 }),
  standard: Object.freeze({ capability: .50, cost: .50 }),
  light: Object.freeze({ capability: .10, cost: .90 })
});
export const PROJECT_WEIGHT_SHIFT = .05; // a raised floor also shifts weight from cost to capability
export const MAX_CAPABILITY_WEIGHT = .95;
function roleTier(role) {
  return ["Architect", "Debugger", "Reviewer"].includes(role) ? "demanding"
    : ["Explorer", "Tester"].includes(role) ? "light" : "standard";
}
export function tradeoffReason(role, projectDemand = null, pressure = 0) {
  const weights = roleTradeoffWeights(role, projectDemand, pressure);
  return `Best capability/cost trade-off for a ${roleTier(role)} role (capability weight ${weights.capability.toFixed(2)}, cost weight ${weights.cost.toFixed(2)}) among models meeting this role's quality floor; unknown cost ranks last.`;
}
// S22 assumption until S16 supplies measured per-role token volumes.
export const ROLE_WORK_VOLUME = Object.freeze({
  Builder: 1, Tester: .6, Explorer: .5, Debugger: .3, Architect: .2, Reviewer: .2
});
export function roleWorkVolume(role) { return ROLE_WORK_VOLUME[role] ?? .2; }
export function roleTradeoffWeights(role, projectDemand = null, pressure = 0) {
  const tier = roleTier(role);
  const base = ROLE_TRADEOFF_WEIGHTS[tier];
  const projectCapability = projectDemand?.floors?.[role]
    ? Math.min(MAX_CAPABILITY_WEIGHT, Math.round((base.capability + PROJECT_WEIGHT_SHIFT) * 100) / 100)
    : base.capability;
  // Volume above a deciding role's small workload increases its cost share.
  // Preserve demanding-role capability dominance at healthy pace.
  const volumeCost = 1 - projectCapability + projectCapability * Math.max(0, roleWorkVolume(role) - .2);
  const cost = volumeCost + (1 - volumeCost) * Math.max(0, Math.min(1, pressure));
  return { capability: Math.round((1 - cost) * 1e12) / 1e12, cost: Math.round(cost * 1e12) / 1e12 };
}

export function demandCandidates(entries, role, explicitFloor = null, { fallback = true } = {}) {
  const floor = explicitFloor ?? roleDemandFloor(role);
  // A validated owned pass is the existing binary aptitude score (1), not
  // an invented public benchmark value or the efficient cost-ordering value.
  const score = entry => entry.ownedEvidence?.verdict === "pass" ? 1 : entry.gapValue;
  const qualified = entries.filter(entry => score(entry) != null && score(entry) >= floor);
  if (qualified.length || !fallback) return { pool: qualified, floorMiss: false, floor };
  const best = [...entries].sort((a, b) => (score(b) ?? -Infinity) - (score(a) ?? -Infinity) || b.value - a.value)[0];
  return { pool: best ? [best] : [], floorMiss: !!best, floor };
}
export function floorMissReason(role, floor) {
  return `No candidate meets the ${role} absolute demand floor (${floor}); using the best-scoring candidate.`;
}

// S20: a model that lacks some (not all) of a role's required benchmark signals
// competes on the signals it has, penalized by this amount times the share of
// required signals missing (1 of 2 missing = -0.05). 0.10 equals the capability
// reference span and exceeds typical same-tier gaps (~0.03-0.05), so partial
// evidence never outranks an equally scored fully-evidenced model, yet a clearly
// stronger partial model still competes. A model with NONE of the signals stays out.
export const INCOMPLETE_EVIDENCE_PENALTY = .10;
export function incompleteEvidencePenalty(missingCount, requiredCount) {
  return requiredCount > 0 ? Math.round(INCOMPLETE_EVIDENCE_PENALTY * missingCount / requiredCount * 1e6) / 1e6 : 0;
}
export function incompleteEvidenceReason({ missing, present, penalty }) {
  return `Missing ${missing.join(", ")} evidence, scored on ${present.join(", ")} only with -${penalty.toFixed(2)} penalty.`;
}
