/**
 * Official `sdd-status --json` projection. No inferred phase/route/next.
 */
import { NO_ACTIVE_WORKFLOW, WORKFLOW_KIND } from "./constants.js";

export const SDD_STATUS_SCHEMA_PREFIX = "gentle-ai.sdd-status";
export const SDD_STATUS_ARGS = Object.freeze(["sdd-status", "--json"]);

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function mapOfficialSddStatus(payload) {
  if (!isObject(payload)) {
    return { ok: false, error: "gentle_incompatible", projection: null };
  }
  const schemaName = typeof payload.schemaName === "string"
    ? payload.schemaName
    : (typeof payload.schema === "string" ? payload.schema : null);
  if (!schemaName || !schemaName.startsWith(SDD_STATUS_SCHEMA_PREFIX)) {
    return { ok: false, error: "gentle_incompatible", projection: null };
  }
  const changeName = typeof payload.changeName === "string" && payload.changeName
    ? payload.changeName
    : null;
  const nextRecommended = typeof payload.nextRecommended === "string" && payload.nextRecommended
    ? payload.nextRecommended
    : null;
  return {
    ok: true,
    error: null,
    projection: { schemaName, changeName, nextRecommended }
  };
}

export function applySddProjection(workflow, projection) {
  workflow.sdd = projection;
  workflow.changeName = projection.changeName;
  workflow.phase = null;
  if (projection.changeName) {
    workflow.kind = WORKFLOW_KIND.SDD;
    workflow.active = true;
    workflow.label = "SDD";
  } else if (workflow.kind !== WORKFLOW_KIND.REVIEW) {
    workflow.kind = WORKFLOW_KIND.NONE;
    workflow.active = false;
    workflow.label = NO_ACTIVE_WORKFLOW;
  }
}
