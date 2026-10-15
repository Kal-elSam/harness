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
export function roleDemandFloor(role) {
  if (["Architect", "Debugger", "Reviewer"].includes(role)) return ROLE_DEMAND_FLOORS.demanding;
  if (["Explorer", "Tester"].includes(role)) return ROLE_DEMAND_FLOORS.light;
  return ROLE_DEMAND_FLOORS.standard;
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
