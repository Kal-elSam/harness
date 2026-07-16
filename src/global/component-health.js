/** Public component health states derived from doctor checks. */

export const COMPONENT_HEALTH = Object.freeze({
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  DRIFTED: "drifted",
  MISSING: "missing"
});

const CHECK_TO_HEALTH = Object.freeze({
  missing: COMPONENT_HEALTH.MISSING,
  stale: COMPONENT_HEALTH.DRIFTED,
  warning: COMPONENT_HEALTH.DEGRADED,
  ok: COMPONENT_HEALTH.HEALTHY
});

const HEALTH_RANK = Object.freeze({
  [COMPONENT_HEALTH.MISSING]: 3,
  [COMPONENT_HEALTH.DRIFTED]: 2,
  [COMPONENT_HEALTH.DEGRADED]: 1,
  [COMPONENT_HEALTH.HEALTHY]: 0
});

export function summarizeComponentHealth(checks = []) {
  if (!Array.isArray(checks) || checks.length === 0) {
    return COMPONENT_HEALTH.HEALTHY;
  }

  let worst = COMPONENT_HEALTH.HEALTHY;
  for (const check of checks) {
    const mapped = CHECK_TO_HEALTH[check.status] ?? COMPONENT_HEALTH.DEGRADED;
    if (HEALTH_RANK[mapped] > HEALTH_RANK[worst]) worst = mapped;
  }
  return worst;
}

export function buildComponentHealthEntries(components, checks) {
  return components.map((component) => {
    const related = checks.filter((check) => check.componentId === component.id);
    return {
      id: component.id,
      version: component.version,
      source: component.source ?? "bundled",
      status: summarizeComponentHealth(related),
      checks: related.map((check) => ({
        name: check.name,
        status: check.status,
        type: check.category ?? null
      }))
    };
  });
}

export function doctorAffectedByComponentHealth(health) {
  return health === COMPONENT_HEALTH.MISSING || health === COMPONENT_HEALTH.DRIFTED;
}
