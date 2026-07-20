import { SDD_MANAGED_AGENT_IDS, SDD_PERSONA_IDS } from "./sdd-destinations.js";
import { SDD_FILE_OUTCOMES, SDD_PLAN_ACTIONS } from "./sdd-evidence.js";

export const SDD_PERSONA_GATE = "sdd.personaAgentIds";
export const SDD_PERSONA_HEALTH = Object.freeze({
  OFF: "off", CONFIGURED: "configured", SYNC_REQUIRED: "sync_required", CONFLICT: "conflict"
});

export function normalizePersonaAgentIds(ids = []) {
  const managed = new Set(SDD_MANAGED_AGENT_IDS);
  return [...new Set((ids ?? []).filter((id) => managed.has(id)))].sort();
}

export function derivePersona(ids) {
  return normalizePersonaAgentIds(ids).length ? "teaching" : "off";
}

export function samePersonaAgentIds(a, b) {
  const left = normalizePersonaAgentIds(a), right = normalizePersonaAgentIds(b);
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

function result(before, after, admitted, rejected) {
  return { before, after, admitted, rejected, persona: derivePersona(after), personaChanged: !samePersonaAgentIds(before, after) };
}

export function planPersonaTransition({
  requestedPersona = "off", selectedAgentIds = [], currentPersonaAgentIds = [], actions = []
} = {}) {
  if (!SDD_PERSONA_IDS.includes(requestedPersona)) {
    throw new Error(`Persona "${requestedPersona}" is invalid. Use: ${SDD_PERSONA_IDS.join(", ")}.`);
  }
  const before = normalizePersonaAgentIds(currentPersonaAgentIds);
  const selected = normalizePersonaAgentIds(selectedAgentIds);
  if (requestedPersona === "off") {
    return result(before, before.filter((id) => !selected.includes(id)), selected.filter((id) => before.includes(id)), []);
  }
  const admitted = selected.filter((id) => {
    const mine = actions.filter((e) => e.agentIds?.includes(id));
    return mine.length && mine.every((e) => e.action !== SDD_PLAN_ACTIONS.CONFLICT);
  });
  const kept = before.filter((id) => !selected.includes(id) || admitted.includes(id));
  return result(before, normalizePersonaAgentIds([...kept, ...admitted]), admitted, selected.filter((id) => !admitted.includes(id)));
}

export function finalizePersonaTransition(planned, files, requestedPersona) {
  if (requestedPersona === "off" || !planned) return planned ?? result([], [], [], []);
  const selected = normalizePersonaAgentIds([...planned.admitted, ...planned.rejected]);
  const admitted = selected.filter((id) => {
    const mine = files.filter((e) => e.agentIds?.includes(id));
    return mine.length && mine.every((e) => e.outcome === SDD_FILE_OUTCOMES.APPLIED || e.outcome === SDD_FILE_OUTCOMES.NOOP);
  });
  const kept = planned.before.filter((id) => !selected.includes(id) || admitted.includes(id));
  return result(planned.before, normalizePersonaAgentIds([...kept, ...admitted]), admitted, selected.filter((id) => !admitted.includes(id)));
}

export function classifyPersonaHealth({
  personaAgentIds = [], assetPresent = false, gatePresent = false, incompleteAgentIds = []
} = {}) {
  if (!normalizePersonaAgentIds(personaAgentIds).length) {
    return { status: SDD_PERSONA_HEALTH.OFF, personaActive: false, reason: "No consumers." };
  }
  if (!assetPresent) return { status: SDD_PERSONA_HEALTH.CONFLICT, personaActive: false, reason: "Asset missing." };
  if (!gatePresent) return { status: SDD_PERSONA_HEALTH.SYNC_REQUIRED, personaActive: false, reason: "Gate missing." };
  if (incompleteAgentIds.length) {
    return { status: SDD_PERSONA_HEALTH.CONFLICT, personaActive: false, reason: `Incomplete: ${incompleteAgentIds.join(", ")}.` };
  }
  return { status: SDD_PERSONA_HEALTH.CONFIGURED, personaActive: true, reason: "Aligned." };
}
