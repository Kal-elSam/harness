/** Observability probe contract — read-only; no lifecycle mutations. */

export const OBSERVABILITY_PROBE_STATES = Object.freeze([
  "missing", "available", "incompatible", "error"
]);

export function assertObservabilityProbeContract(probe) {
  if (probe == null || typeof probe !== "object" || Array.isArray(probe)) {
    throw new Error("Observability probe must be an object.");
  }
  if (typeof probe.id !== "string" || !probe.id) {
    throw new Error("Observability probe id must be a non-empty string.");
  }
  if (typeof probe.probe !== "function") {
    throw new Error(`Observability probe "${probe.id}" is missing probe().`);
  }
  if (!Array.isArray(probe.declaredEvents)) {
    throw new Error(`Observability probe "${probe.id}" declaredEvents must be an array.`);
  }
  if (!Array.isArray(probe.declaredActions)) {
    throw new Error(`Observability probe "${probe.id}" declaredActions must be an array.`);
  }
  return probe;
}

export function normalizeProbeResult(raw, fallbackId) {
  const id = typeof raw?.id === "string" && raw.id ? raw.id : fallbackId;
  const state = OBSERVABILITY_PROBE_STATES.includes(raw?.state) ? raw.state : "error";
  return {
    id,
    state,
    version: raw?.version ?? null,
    contractCompatible: typeof raw?.contractCompatible === "boolean" ? raw.contractCompatible : null,
    diagnostics: Array.isArray(raw?.diagnostics) ? raw.diagnostics.map(String) : [],
    evidence: Array.isArray(raw?.evidence) ? raw.evidence : [],
    error: raw?.error == null ? null : String(raw.error)
  };
}
