/**
 * Map Gentle observability probe → control-plane provider.
 * Version is evidence only; v1 contract is upgrade, unknown schema fails closed.
 */
import {
  NO_ACTIVE_WORKFLOW,
  PROVIDER,
  PROVIDER_ERROR,
  WORKFLOW_KIND
} from "./constants.js";

const LEGACY_SCHEMA = "gentle-ai.review-integration.capabilities/v1";
const LEGACY_CONTRACT = "gentle-ai.review-integration/v1";

export function emptyGentleWorkflow({ provider = null } = {}) {
  return {
    kind: WORKFLOW_KIND.NONE,
    active: false,
    label: NO_ACTIVE_WORKFLOW,
    phase: null,
    nextTransition: null,
    changeName: null,
    review: null,
    sdd: null,
    provider
  };
}

export function isRecognizedLegacyContract(probe) {
  const evidenceSchemas = (probe?.evidence ?? [])
    .map((row) => row?.schema)
    .filter(Boolean)
    .join(" ");
  const blob = `${(probe?.diagnostics ?? []).join(" ")} ${evidenceSchemas}`;
  return blob.includes(LEGACY_SCHEMA)
    || blob.includes(LEGACY_CONTRACT)
    || /protocol\.major mismatch: got 1\b/.test(blob);
}

export function mapGentleProviderState(probe) {
  if (probe == null || typeof probe !== "object" || Array.isArray(probe)) {
    return PROVIDER.INCOMPATIBLE;
  }
  if (probe.state === "missing") return PROVIDER.UNAVAILABLE;
  if (probe.state === "available" && probe.contractCompatible === true) {
    return PROVIDER.CONNECTED;
  }
  if (probe.state === "error") {
    const blob = `${probe.error ?? ""} ${(probe.diagnostics ?? []).join(" ")}`;
    if (/parse|not an object|invalid capabilities/i.test(blob)) {
      return PROVIDER.INCOMPATIBLE;
    }
    return PROVIDER.UNAVAILABLE;
  }
  if (probe.state === "incompatible") {
    return isRecognizedLegacyContract(probe)
      ? PROVIDER.UPGRADE_REQUIRED
      : PROVIDER.INCOMPATIBLE;
  }
  return PROVIDER.INCOMPATIBLE;
}

export function providerError(provider, probe = null) {
  if (provider === PROVIDER.CONNECTED) return null;
  if (provider === PROVIDER.UNAVAILABLE && probe?.state === "error") {
    return "gentle_capabilities_failed";
  }
  return PROVIDER_ERROR[provider] ?? "gentle_incompatible";
}
