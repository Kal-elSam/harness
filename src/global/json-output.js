/**
 * Stable control-plane JSON envelope for CI, tooling, and debugging.
 * Field order and names are part of the public contract.
 */
export function buildControlPlaneJson(report, { cliVersion, extras = {} } = {}) {
  return {
    ok: report.ok,
    overall: report.overall,
    agents: report.agents,
    components: report.components,
    componentHealth: report.componentHealth ?? report.components,
    checks: report.checks,
    backups: report.backups,
    nextAction: report.nextAction,
    policy: report.policy,
    cliVersion,
    ...extras
  };
}

export function printJson(payload) {
  console.log(JSON.stringify(payload));
}
