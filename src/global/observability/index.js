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
  PASSIVE_SNAPSHOT_TTL_MS,
  PASSIVE_SNAPSHOT_MAX_ENTRIES,
  buildPassiveSnapshotKey,
  resetPassiveSnapshotFlightForTests,
  passiveSnapshotInFlightSizeForTests,
  runPassiveObservabilitySnapshot
} from "./passive-snapshot-flight.js";
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
export {
  GRAPHIFY_PARSE_TTL_MS,
  GRAPHIFY_PARSE_MAX_ENTRIES,
  buildGraphifyParseIdentity,
  resetGraphifyParseCacheForTests,
  inspectGraphArtifactCached
} from "./graphify-parse-cache.js";
export { runGraphifyOp, runGraphifyCli } from "./graphify-ops.js";
export {
  SYSTEM_RESOURCES_TIMEOUT_MS, PROCESS_ALLOWLIST,
  parseProcessTable, loadSystemResources
} from "./system-resources.js";
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
