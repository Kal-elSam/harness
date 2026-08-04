import { createGentleProbe } from "./gentle-probe.js";
import { createGraphifyProbe } from "./graphify-probe.js";
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
  SUPPORTED_MANDATORY_FEATURES, evaluateGentleCapabilities, probeGentle, createGentleProbe,
  resolveGentleBinaryPath
} from "./gentle-probe.js";
export { exportGentleReviewBundle, resolveNegotiatedGentleBinary } from "./gentle-bundle-export.js";
export { importGentleReviewBundle } from "./gentle-bundle-import.js";
export {
  inspectGraphArtifact, assertGraphInsideWorkspace,
  resolveGraphifyBinaryPath, resolveGitHeadSha, scrubGitOverrideEnv,
  probeGraphify, createGraphifyProbe
} from "./graphify-probe.js";
export { runGraphifyOp, runGraphifyCli } from "./graphify-ops.js";
export {
  SOFT_LINK_WINDOW_MS,
  parseCompanionTimestamp,
  resolveRunTimestamp,
  resolveReviewTimestamp,
  softLinkReviewToRun,
  summarizeCompanionProbes,
  buildCompanionSnapshot
} from "./build-companion-snapshot.js";

export function ensureObservabilityProbesRegistered() {
  if (!getObservabilityProbe("gentle")) registerObservabilityProbe(createGentleProbe());
  if (!getObservabilityProbe("graphify")) registerObservabilityProbe(createGraphifyProbe());
}
