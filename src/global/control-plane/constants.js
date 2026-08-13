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
