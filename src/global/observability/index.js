import { createGentleProbe } from "./gentle-probe.js";
import { getObservabilityProbe, registerObservabilityProbe } from "./probe-registry.js";

export {
  OBSERVABILITY_PROBE_STATES,
  assertObservabilityProbeContract,
  normalizeProbeResult
} from "./probe-contract.js";
export {
  registerObservabilityProbe,
  getObservabilityProbe,
  listObservabilityProbes,
  resetObservabilityProbesForTests
} from "./probe-registry.js";
export { buildObservabilitySnapshot } from "./build-observability-snapshot.js";
export {
  SUPPORTED_PROTOCOL, SUPPORTED_SCHEMA, SUPPORTED_CONTRACT,
  SUPPORTED_MANDATORY_FEATURES, evaluateGentleCapabilities, probeGentle, createGentleProbe
} from "./gentle-probe.js";

export { exportGentleReviewBundle } from "./gentle-bundle-export.js";

export function ensureObservabilityProbesRegistered() {
  if (!getObservabilityProbe("gentle")) registerObservabilityProbe(createGentleProbe());
}
