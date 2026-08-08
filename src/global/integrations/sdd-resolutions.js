import { formatCliCommand } from "../brand/cli.js";
import { resolution, RESOLUTION_KIND, RESOLUTION_SAFETY } from "../check-resolutions.js";
import { SDD_HEALTH } from "./sdd-evidence.js";

/**
 * Build panel/CLI resolution buttons for sdd-core:skills from verify findings.
 * Agent list is derived from conflict/drifted findings so buttons scope correctly.
 */
export function buildSddSkillResolutions(verification = {}) {
  const summary = verification.summary ?? {};
  const conflictCount = summary.conflict ?? 0;
  const driftedCount = summary.drifted ?? 0;
  if (conflictCount === 0 && driftedCount === 0) return [];

  const agentIds = conflictAgentIds(verification.findings ?? []);
  const agentsFlag = agentIds.length ? ` --agents ${agentIds.join(",")}` : "";

  return [
    resolution(
      "sdd-diff",
      "Ver diff",
      formatCliCommand(`components diff sdd-core${agentsFlag}`),
      {
        kind: RESOLUTION_KIND.RUN,
        safety: RESOLUTION_SAFETY.READ_ONLY,
        detail: "Read-only: canonical Kairo skills vs disk."
      }
    ),
    resolution(
      "sdd-adopt",
      "Conservar el mío",
      formatCliCommand(`components adopt sdd-core${agentsFlag} --yes`),
      {
        kind: RESOLUTION_KIND.CONFIGURE,
        safety: RESOLUTION_SAFETY.CONSENT,
        detail: "Adopt disk bytes into Kairo state without overwriting files. Button click is consent."
      }
    ),
    resolution(
      "sdd-overwrite",
      "Usar versión Kairo",
      formatCliCommand(`components configure sdd-core${agentsFlag} --overwrite-conflicts --yes`),
      {
        kind: RESOLUTION_KIND.CONFIGURE,
        safety: RESOLUTION_SAFETY.DESTRUCTIVE,
        detail: "Backup then replace conflicting files with canonical Kairo skills."
      }
    ),
    resolution(
      "doctor",
      "Doctor",
      formatCliCommand("doctor"),
      { kind: RESOLUTION_KIND.RUN, safety: RESOLUTION_SAFETY.READ_ONLY }
    ),
    resolution(
      "refresh",
      "Refresh",
      null,
      { kind: RESOLUTION_KIND.REFRESH, safety: RESOLUTION_SAFETY.READ_ONLY }
    )
  ];
}

function conflictAgentIds(findings) {
  const ids = new Set();
  for (const finding of findings) {
    if (finding?.status !== SDD_HEALTH.CONFLICT && finding?.status !== SDD_HEALTH.DRIFTED) {
      continue;
    }
    for (const id of finding.agentIds ?? []) ids.add(id);
  }
  return [...ids].sort();
}
