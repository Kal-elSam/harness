import { assertObservabilityProbeContract } from "./probe-contract.js";

const probes = new Map();

export function registerObservabilityProbe(probe) {
  assertObservabilityProbeContract(probe);
  if (probes.has(probe.id)) {
    throw new Error(`Observability probe "${probe.id}" is already registered.`);
  }
  const frozen = Object.freeze({
    id: probe.id,
    probe: probe.probe.bind(probe),
    declaredEvents: Object.freeze([...(probe.declaredEvents ?? [])]),
    declaredActions: Object.freeze([...(probe.declaredActions ?? [])])
  });
  probes.set(probe.id, frozen);
  return frozen;
}

export function getObservabilityProbe(id) {
  return probes.get(id) ?? null;
}

export function listObservabilityProbes() {
  return [...probes.values()];
}

export function resetObservabilityProbesForTests() {
  probes.clear();
}
