// Derived, presentation-only team state. Decides whether a surface may list
// the team's roles. It reads the persisted strategy and the projected rows
// and NEVER writes: saved assignments are not deleted or changed by hiding.
//
// Rules (first match wins):
//   incomplete - no strategy (`not_analyzed`), status is not `active`
//                (`not_approved`), or a required role (Project Analyst,
//                Orchestrator, every projectTeam entry) has no saved model
//                (`missing_assignment`).
//   verifying  - availability probe still pending (`availability_pending`),
//                including a last-known cache shown while it runs. This is
//                never reported as missing quota.
//   blocked    - any role is blocked (`availability_blocked`), or the probe
//                failed so nothing was validated (`availability_unverified`).
//   complete   - assigned + ACTIVE + every role validated `available`.
// `rolesVisible` is true only for `complete`.

function hasModel(model) {
  return Boolean(model && (model.modelId || model.displayName) && model.adapterId);
}

function result(state, reason) {
  return { state, rolesVisible: state === "complete", reason };
}

/**
 * @param {object|null|undefined} strategy - persisted ProjectStrategy
 * @param {{rows?: Array<{availability?: {state?: string}}>, probe?: "pending"|"failed"|"live"}} [facts]
 *   `probe` is how the availability intelligence arrived for this render.
 */
export function deriveTeamPresentation(strategy, { rows = [], probe = "pending" } = {}) {
  if (!strategy) return result("incomplete", "not_analyzed");
  if (strategy.status !== "active") return result("incomplete", "not_approved");
  const required = [strategy.bootstrapAnalyst, strategy.orchestrator, ...(strategy.projectTeam ?? []).map((entry) => entry?.model)];
  if (!required.every(hasModel)) return result("incomplete", "missing_assignment");
  if (probe === "pending") return result("verifying", "availability_pending");
  if (probe === "failed") return result("blocked", "availability_unverified");
  const states = rows.map((row) => row?.availability?.state);
  if (states.includes("checking")) return result("verifying", "availability_pending");
  if (states.includes("blocked")) return result("blocked", "availability_blocked");
  if (states.some((state) => state !== "available")) return result("blocked", "availability_unverified");
  return result("complete", null);
}
