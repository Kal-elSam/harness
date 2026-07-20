import { ensureIntegrationProvidersRegistered } from "./index.js";
import { requireIntegrationProvider } from "./provider-registry.js";
import { SDD_MANAGED_AGENT_IDS } from "./sdd-destinations.js";
import { normalizeSddState, recordSddMaterialization } from "./sdd-state.js";

function skipped(reason) {
  return {
    status: "skipped",
    reason,
    partial: false,
    conflicts: [],
    receipt: null,
    sessionRefreshRequired: false,
    applied: false,
    cancelled: false,
    dryRun: false
  };
}

/** Lifecycle materialization via sdd-core.apply; persona frozen; no second consent prompt. */
export async function applySddLifecycle({
  homeDir,
  packageRoot,
  agentIds = [],
  componentIds = [],
  dryRun = false,
  priorSdd = null,
  yes = true
} = {}) {
  if (!componentIds.includes("sdd-core")) return skipped("sdd-core not selected");
  const managed = agentIds.filter((id) => SDD_MANAGED_AGENT_IDS.includes(id));
  if (!managed.length) return skipped("no managed target agents");

  ensureIntegrationProvidersRegistered();
  const provider = requireIntegrationProvider("sdd-core");
  const sdd = normalizeSddState(priorSdd);
  const trackedFiles = Object.fromEntries(sdd.files.map((file) => [file.destinationPath, file.hash]));
  const result = await provider.apply({
    requestedAgentIds: managed,
    detectedAgentIds: managed,
    homeDir,
    packageRoot,
    persona: sdd.persona,
    personaAgentIds: sdd.personaAgentIds,
    preservePersona: true,
    trackedFiles,
    dryRun,
    yes: dryRun ? false : yes,
    json: true
  });

  const receipt = result.receipt ?? null;
  return {
    status: dryRun
      ? "planned"
      : (receipt?.partial ? "partial" : (result.applied ? "applied" : (receipt ? "failed" : "skipped"))),
    reason: result.cancelled ? "cancelled" : undefined,
    partial: Boolean(receipt?.partial),
    conflicts: result.conflicts ?? receipt?.conflicts ?? [],
    receipt,
    sessionRefreshRequired: Boolean(result.sessionRefreshRequired),
    summary: result.summary ?? null,
    persona: result.persona ?? sdd.persona,
    personaAgentIds: result.personaTransition?.after ?? sdd.personaAgentIds,
    applied: Boolean(result.applied),
    cancelled: Boolean(result.cancelled),
    dryRun: Boolean(dryRun)
  };
}

/** Persist receipt into SDD state only for ok/partial; otherwise keep prior block. */
export function nextSddState(priorSdd, lifecycle) {
  const prior = normalizeSddState(priorSdd);
  if (!lifecycle?.receipt || lifecycle.dryRun) return prior;
  if (!lifecycle.receipt.ok && !lifecycle.receipt.partial) return prior;
  return recordSddMaterialization({ sdd: prior }, { receipt: lifecycle.receipt }).sdd;
}

export function aggregateSessionRefreshRequired(result, sdd) {
  const managedChanged = (result.configsCreated?.length ?? 0)
    + (result.configsUpdated?.length ?? 0)
    + (result.configsRepaired?.length ?? 0) > 0;
  return Boolean(sdd?.sessionRefreshRequired) || managedChanged;
}
