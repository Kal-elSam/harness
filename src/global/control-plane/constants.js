/**
 * kairo.control-plane/v1 — atomic panel report (work + workflow + team + attention).
 */
export const CONTROL_PLANE_SCHEMA = "kairo.control-plane/v1";

export const WORKFLOW_KIND = Object.freeze({
  SDD: "sdd",
  REVIEW: "review",
  DIRECT: "direct",
  DELEGATED: "delegated",
  NONE: "none"
});

export const HONESTY = Object.freeze({
  LIVE: "live",
  DECLARED: "declared",
  OPAQUE: "opaque"
});

export const NO_ACTIVE_WORKFLOW = "No active workflow";

/** Control-plane Gentle provider — distinct from observability probe states. */
export const PROVIDER = Object.freeze({
  CONNECTED: "connected",
  UPGRADE_REQUIRED: "upgrade_required",
  UNAVAILABLE: "unavailable",
  INCOMPATIBLE: "incompatible"
});

export const PROVIDER_ERROR = Object.freeze({
  [PROVIDER.UPGRADE_REQUIRED]: "gentle_upgrade_required",
  [PROVIDER.UNAVAILABLE]: "gentle_unavailable",
  [PROVIDER.INCOMPATIBLE]: "gentle_incompatible"
});

export const GENTLE_INSTALL_HINT = "Install gentle-ai separately, then Refresh.";
export const GENTLE_UPGRADE_LABEL = "Upgrade Gentle";
export const GENTLE_DOCTOR_COMMAND = "gentle-ai doctor";
