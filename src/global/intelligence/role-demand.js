import { currentRegistry, roleView, rolesWhere, isBuildRole, ROLE_REGISTRY } from "./role-registry.js";

// Selection policy, not adapter availability or ask-routing policy. Callers may
// override this single default through the builders' `teamProviders` option.
export const TEAM_PROVIDERS = Object.freeze(["claude", "codex"]);

// Existing normalized required-capability gapValue, never pool percentiles.
// Calibration (2026-10-15): live Architect/Reviewer gap values .6415 and
// .6595 straddle .65 by margins inside evidence noise. Demanding .60 admits
// both, plus .6135, while excluding .58. This avoids defeating quota balance
// before cost selection. Builder (standard) is .55 (S34, provisional until
// own runs in C8): at .60 only the most expensive Codex model cleared it, so
// the highest-volume role defaulted to frontier pricing; project risk raises
// apply only to analysis and decision roles. Light .35 admits cheap .392 Tester evidence. Thresholds are
// policy, not task-success probabilities.
export const ROLE_DEMAND_FLOORS = Object.freeze({ demanding: .60, standard: .55, light: .35 });
function tierFloor(role) {
  if (isBuildRole(role)) return ROLE_DEMAND_FLOORS[ROLE_REGISTRY[role]?.tier ?? "standard"];
  const explicit = currentRegistry()[role]?.floor;
  return typeof explicit === "number" ? explicit : ROLE_DEMAND_FLOORS[roleTier(role)];
}
/**
 * Project raises apply only to analysis and decision roles in the demanding tier. requiredCapabilities is accepted for
 * call-site compatibility; the S26 coding-only Builder discount is superseded
 * by the S34 standard floor, which applies to every Builder capability mix.
 */
// eslint-disable-next-line no-unused-vars
export function roleDemandFloor(role, projectDemand = null, requiredCapabilities = null) {
  return Math.round(((roleTier(role) === "demanding" && !isBuildRole(role) ? projectDemand?.floors?.[role] : null) ?? tierFloor(role)) * 1e6) / 1e6;
}

// S14 (mechanical fallback since S35): the project profile (project-profile.js computeProjectProfile) changes
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
    "Layered or Clean Architecture": ["Architect", "Reviewer"] // boundaries to design and review
  })
});
// S35: the analyst's structured demand assessment (project-analysis.js
// verifyDemandAssessment output) is the primary driver of project demand;
// tooling presence (lint, tests, layered docs) no longer raises floors when a
// valid assessment exists. Levels arrive already capped at 2 when a category has
// no verified citation. Only demanding roles are raised, never above 0.65 (S39).
export const DEMAND_ASSESSMENT_CATEGORIES = Object.freeze(["actionsAndSecurity", "money", "personalData", "realtimeConcurrency", "aiIntegration", "domainComplexity"]);
export const ASSESSMENT_FLOOR_RAISE = Object.freeze({ high: .05, critical: .10 });
export const MAX_ASSESSMENT_FLOOR = .65;
export const ASSESSMENT_RAISED_ROLES = Object.freeze(rolesWhere("assessmentRaised"));
// category -> [min level, role, capability] additions (required capabilities).
export const ASSESSMENT_CAPABILITY_RULES = Object.freeze([
  Object.freeze({ category: "actionsAndSecurity", minLevel: 4, roles: ["Reviewer", "Architect"], capability: "reasoning" }),
  Object.freeze({ category: "aiIntegration", minLevel: 4, roles: ["Architect", "Builder"], capability: "agenticExecution" }),
  Object.freeze({ category: "realtimeConcurrency", minLevel: 4, roles: ["Debugger"], capability: "terminalExecution" })
]);
const round2 = value => Math.round(value * 100) / 100;
/** S42: critical needs a 5 and mean >= 3.5; high needs two 4+ categories or mean >= 3.5. */
export function assessmentDemandLevel(assessment) {
  const levels = Object.fromEntries(DEMAND_ASSESSMENT_CATEGORIES
    .filter(name => Number.isInteger(assessment?.categories?.[name]?.level))
    .map(name => [name, assessment.categories[name].level]));
  const names = Object.keys(levels);
  if (!names.length) return null;
  const max = Math.max(...names.map(name => levels[name]));
  const mean = round2(names.reduce((sum, name) => sum + levels[name], 0) / names.length);
  const maxCategory = names.find(name => levels[name] === max);
  const highCategories = names.filter(name => levels[name] >= 4).length;
  const demandLevel = max === 5 && mean >= 3.5 ? "critical" : highCategories >= 2 || mean >= 3.5 ? "high" : "low";
  return { demandLevel, max, mean, maxCategory, levels };
}
/** Capability additions the verified assessment requires: [{role, capability, category, level}]. */
export function assessmentCapabilityAdditions(assessment) {
  const additions = [];
  for (const rule of ASSESSMENT_CAPABILITY_RULES) {
    const level = assessment?.categories?.[rule.category]?.level;
    if (Number.isInteger(level) && level >= rule.minLevel) {
      for (const role of rule.roles) additions.push({ role, capability: rule.capability, category: rule.category, level });
    }
  }
  return additions;
}
function assessmentDemand(assessment) {
  const summary = assessmentDemandLevel(assessment);
  if (!summary) return null;
  const claimedLevels = Object.fromEntries(Object.keys(summary.levels).map(name => [name, assessment.categories[name].claimedLevel ?? summary.levels[name]]));
  const record = {
    source: "assessment", productPurpose: assessment.productPurpose ?? null, demandLevel: summary.demandLevel,
    max: summary.max, mean: summary.mean, levels: summary.levels, claimedLevels, raises: {},
    ...(typeof assessment.stabilized === "boolean" ? { stabilized: assessment.stabilized, evidence: assessment.evidence } : {})
  };
  const floors = {};
  const reasons = {};
  const raise = ASSESSMENT_FLOOR_RAISE[summary.demandLevel];
  if (raise) {
    const verified = Object.entries(summary.levels).map(([name, level]) => `${name} ${level}`).join(", ");
    for (const role of Object.keys(currentRegistry()).filter(role => roleTier(role) === "demanding" && !isBuildRole(role))) {
      const base = tierFloor(role);
      floors[role] = Math.min(MAX_ASSESSMENT_FLOOR, round2(base + raise));
      record.raises[role] = { from: base, to: floors[role] };
      const security = role === "Reviewer" && (summary.levels.actionsAndSecurity ?? 0) >= 4
        ? ` Security emphasis: actionsAndSecurity level ${summary.levels.actionsAndSecurity} (executes actions, permissions, auth or secrets).` : "";
      reasons[role] = `Raised demand floor ${base} to ${floors[role]}: project demand ${summary.demandLevel} from the analyst assessment (max ${summary.max} ${summary.maxCategory}, mean ${summary.mean}; verified levels ${verified}).${security}`;
    }
  }
  return { floors, reasons, assessment: record };
}
/**
 * @param {object|null} profile - computeProjectProfile() result (or any object with the same fields), optionally carrying `demandAssessment` (verified)
 * @returns {{floors: Record<string, number>, reasons: Record<string, string>, assessment?: object}|null} null when nothing applies
 */
export function projectDemand(profile) {
  if (!profile || typeof profile !== "object") return null;
  const fromAssessment = assessmentDemand(profile.demandAssessment);
  if (fromAssessment) return fromAssessment;
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
    if (roleTier(role) !== "demanding" || isBuildRole(role)) continue;
    const base = tierFloor(role);
    floors[role] = Math.min(MAX_PROJECT_FLOOR, Math.round((base + PROJECT_FLOOR_RAISE) * 100) / 100);
    reasons[role] = `Raised demand floor ${base} to ${floors[role]}: ${[...new Set(list)].join("; ")}.`;
  }
  return { floors, reasons };
}
export function withProjectReason(entries, projectDemand) {
  if (!projectDemand) return entries;
  return entries.map(entry => {
    const selected = entry.selection?.evaluated.find(candidate => candidate.modelId === entry.primary?.modelId
      && candidate.adapterId === entry.primary?.adapterId);
    const critical = isCriticalDemandingRole(entry.role, projectDemand) && selected
      ? selected.tradeoffWeights?.capability === 1 && selected.gapValue >= roleDemandFloor(entry.role, projectDemand)
        ? "Critical demand selected the strongest available qualified model within provider independence and quota constraints."
        : "Critical demand prioritizes the strongest available model; quota pressure and reserve still apply."
      : null;
    const reason = [entry.reason, projectDemand.reasons[entry.role], critical].filter(Boolean).join(" ");
    return reason ? { ...entry, reason } : entry;
  });
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
export function roleTier(role) {
  if (isBuildRole(role)) return ROLE_REGISTRY[role]?.tier ?? "standard";
  return currentRegistry()[role]?.tier ?? "standard";
}
/** Light-tier roles (Explorer, Tester): thin-but-real evidence competes on cost (S31). */
export function isLightRole(role) { return roleTier(role) === "light"; }
export function tradeoffReason(role, projectDemand = null, pressure = 0, floorMiss = false, measuredVolumes = null) {
  const weights = roleTradeoffWeights(role, projectDemand, pressure, measuredVolumes);
  const pool = floorMiss ? "within the near-equivalence band of the best capability" : "among models meeting this role's quality floor";
  return `Best capability/cost trade-off for a ${roleTier(role)} role (capability weight ${weights.capability.toFixed(2)}, cost weight ${weights.cost.toFixed(2)}) ${pool}; unknown cost ranks last.`;
}
// S22 assumption until S16 supplies measured per-role token volumes.
export const ROLE_WORK_VOLUME = Object.freeze(roleView("workVolume"));
/** S47: a measured relative volume (Builder = 1) replaces the assumed one for that role only. */
export function roleWorkVolume(role, measuredVolumes = null) {
  const measured = measuredVolumes?.[role];
  return typeof measured === "number" && Number.isFinite(measured) && measured >= 0 ? measured : currentRegistry()[role]?.workVolume ?? .2;
}
function isCriticalDemandingRole(role, projectDemand) {
  return roleTier(role) === "demanding" && projectDemand?.assessment?.demandLevel === "critical";
}
export function roleTradeoffWeights(role, projectDemand = null, pressure = 0, measuredVolumes = null) {
  const tier = roleTier(role);
  const base = ROLE_TRADEOFF_WEIGHTS[tier];
  // S39: critical demand maximizes capability before S23 pressure/reserve.
  // High/low retain the existing S19 project shift and S22 volume weights.
  const projectCapability = isCriticalDemandingRole(role, projectDemand) ? 1 : projectDemand?.floors?.[role]
    ? Math.min(MAX_CAPABILITY_WEIGHT, Math.round((base.capability + PROJECT_WEIGHT_SHIFT) * 100) / 100)
    : base.capability;
  // Volume above a deciding role's small workload increases its cost share.
  // Preserve demanding-role capability dominance at healthy pace.
  const volumeCost = isCriticalDemandingRole(role, projectDemand) ? 0
    : 1 - projectCapability + projectCapability * Math.max(0, Math.min(1, roleWorkVolume(role, measuredVolumes)) - .2);
  const cost = Math.max(0, Math.min(1, volumeCost + (1 - volumeCost) * Math.max(0, Math.min(1, pressure))));
  return { capability: Math.round((1 - cost) * 1e12) / 1e12, cost: Math.round(cost * 1e12) / 1e12 };
}

// Per-role near-equivalence tolerance — replaces the single flat 8% band
// this codebase used before. Per explicit decision: capability alone
// isn't the only thing that matters — a model being capable of everything
// doesn't mean it should always be the one doing it, especially when a
// real, meaningfully cheaper alternative is genuinely close enough — but
// how close is "close enough" is NOT the same question for every role.
// Architect decides the whole plan every other role executes against —
// a real requiredRoleFit gap there compounds across the entire team, so
// its tolerance is the tightest. Debugger/Reviewer sit right behind it —
// Debugger needs real reasoning under a live failure, Reviewer is the
// team's only independent check on Builder's own work. Builder/Explorer/
// Tester tolerate more: Builder's real output is still checked by
// Reviewer, Explorer/Tester's mistakes are cheap to catch and retry.
// Two real data points anchored the old flat 8%: Claude Fable 5.1 vs
// OpenCode Go's Kimi K3 sit ~6.6% apart on codingIndex (real GPQA scores
// within 0.2 points of each other) at roughly a third of the price, while
// Fable 5.1 vs Codex GPT-5.6 Sol on coding sit ~5.2% apart with no price
// advantage. Those numbers describe Builder-tier closeness, not
// Architect-tier — kept as this file's Builder/Explorer/Tester tier
// value; Architect/Debugger/Reviewer are deliberately tighter than either
// anchor point. Re-verify against real registry data before changing any
// of these, never assume a ratio holds indefinitely (see this table's own
// review date).
export const ROLE_NEAR_EQUIVALENCE_BAND = roleView("nearEquivalenceBand");
const DEFAULT_NEAR_EQUIVALENCE_BAND = 0.06;

/** The real near-equivalence tolerance for a role — see ROLE_NEAR_EQUIVALENCE_BAND's own doc for why this isn't one flat number. A role missing from the table (e.g. a future addition) falls back to the Builder-tier default rather than crashing. */
export function nearEquivalenceBandFor(role) {
  return currentRegistry()[role]?.nearEquivalenceBand ?? DEFAULT_NEAR_EQUIVALENCE_BAND;
}

/** Measured task quality supersedes a binary aptitude pass and public fit. */
export function roleFitScore(entry) {
  return entry.measuredQuality?.successRate ?? (entry.ownedEvidence?.verdict === "pass" ? 1 : entry.gapValue);
}

export function demandCandidates(entries, role, explicitFloor = null, { fallback = true } = {}) {
  const floor = explicitFloor ?? roleDemandFloor(role);
  // A validated owned pass is the existing binary aptitude score (1), not
  // an invented public benchmark value or the efficient cost-ordering value.
  const score = roleFitScore;
  entries = entries.filter(entry => entry.measuredQuality == null || score(entry) >= floor);
  const qualified = entries.filter(entry => score(entry) != null && score(entry) >= floor);
  if (qualified.length || !fallback) return { pool: qualified, floorMiss: false, floor };
  const best = [...entries].sort((a, b) => (score(b) ?? -Infinity) - (score(a) ?? -Infinity) || b.value - a.value)[0];
  // Missing the floor does not bypass S19/S22/S23. Retain only candidates
  // close to the strongest absolute capability, then let the coordinated
  // selector apply the same volume- and pressure-adjusted cost trade-off.
  const bestScore = best ? score(best) : null;
  const pool = bestScore == null ? (best ? [best] : []) : entries.filter(entry =>
    score(entry) != null && (bestScore - score(entry)) / (Math.abs(bestScore) || 1) <= nearEquivalenceBandFor(role));
  return { pool, floorMiss: !!best, floor };
}
export function floorMissReason(role, floor, projectDemand = null, pressure = 0, independent = false, measuredVolumes = null) {
  return `No candidate meets the ${role} absolute demand floor (${floor})${independent ? " on an independent provider" : ""}; ${tradeoffReason(role, projectDemand, pressure, true, measuredVolumes)}`;
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
