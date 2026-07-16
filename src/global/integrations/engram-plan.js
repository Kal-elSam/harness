import {
  resolveEngramAgentSelection,
  engramSetupSlugForAgent,
  ENGRAM_INTEGRATION_STATUS,
  inspectEngramIntegration
} from "./engram-evidence.js";

/** Dry-run / apply plan. Dry-run never writes or executes setup. */
export function planEngramConfigure({
  requestedAgentIds = null,
  detectedAgentIds = [],
  env = process.env,
  homeDir,
  inspect = inspectEngramIntegration,
  dryRun = true
} = {}) {
  const agentIds = resolveEngramAgentSelection({ requestedIds: requestedAgentIds, detectedIds: detectedAgentIds });
  const inspection = inspect({ env, homeDir, agentIds });
  const { binary } = inspection;
  const canSetup = binary.supported === true && Boolean(binary.path);

  const actions = agentIds.map((agentId) => {
    const agent = inspection.agents.find((entry) => entry.id === agentId) ?? {
      id: agentId,
      slug: engramSetupSlugForAgent(agentId),
      status: ENGRAM_INTEGRATION_STATUS.UNCONFIGURED
    };
    const slug = agent.slug ?? engramSetupSlugForAgent(agentId);
    let action = "setup";
    let reason = "Official `engram setup` required.";
    if (!canSetup) {
      action = "blocked";
      reason = binary.guidance ?? `Engram is ${binary.status}.`;
    } else if (agent.status === ENGRAM_INTEGRATION_STATUS.CONFIGURED) {
      action = "noop";
      reason = "Already configured (idempotent re-setup still available on apply).";
    } else if (agent.status === ENGRAM_INTEGRATION_STATUS.CONFLICT) {
      reason = "Conflict detected; official setup may repair agent config.";
    }
    return {
      agentId, slug, action, reason, status: agent.status,
      command: canSetup ? [binary.path, "setup", slug] : null,
      executes: false, writes: false
    };
  });

  return {
    provider: "engram",
    componentId: "engram-memory",
    dryRun: Boolean(dryRun),
    executes: false,
    writes: false,
    binary,
    agents: inspection.agents,
    actions,
    blocked: !canSetup,
    guidance: binary.guidance,
    nextStatusIfApplied: canSetup ? ENGRAM_INTEGRATION_STATUS.RESTART_REQUIRED : binary.status
  };
}
