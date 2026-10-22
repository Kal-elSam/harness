// Derived, presentation-only team state. Decides whether a surface may list
// the team's roles. It reads the persisted strategy and the projected rows
// and NEVER writes: saved assignments are not deleted or changed by hiding.
//
// Rules (first match wins):
//   incomplete       - no strategy (`not_analyzed`), or a required role
//                      (Project Analyst, Orchestrator, every projectTeam
//                      entry) has no saved model (`missing_assignment`).
//                      Stale (not suggested/active) also lands here as
//                      `not_approved`.
//   pending_approval - SUGGESTED draft with every required model present;
//                      roles are visible for review. Probe still pending
//                      keeps this state (`availability_pending`).
//   ready_to_approve - SUGGESTED and every operational assignment is
//                      currently usable (live probe all `available`, and
//                      no `assignmentState: "blocked"`).
//   verifying        - ACTIVE team whose availability probe is still
//                      pending (`availability_pending`), including a
//                      last-known cache shown while it runs. Never reported
//                      as missing quota.
//   blocked          - any role is blocked (`availability_blocked` /
//                      `assignment_blocked`), or the probe failed so
//                      nothing was validated (`availability_unverified`).
//                      Suggested drafts stay rolesVisible so the human can
//                      review/edit blocked roles.
//   complete         - assigned + ACTIVE + every role validated `available`.
//
// `rolesVisible` is true for complete, pending_approval, ready_to_approve,
// and for blocked/verifying SUGGESTED drafts (reviewable). ACTIVE verifying
// / blocked keep roles hidden (same as T16 for an approved team).

function hasModel(model) {
  return Boolean(model && (model.modelId || model.displayName) && model.adapterId);
}

function result(state, reason, rolesVisible) {
  return { state, rolesVisible, reason };
}

function requiredModels(strategy) {
  return [strategy.bootstrapAnalyst, strategy.orchestrator, ...(strategy.projectTeam ?? []).map((entry) => entry?.model)];
}

function hasBlockedAssignment(strategy) {
  return (strategy.projectTeam ?? []).some((entry) => entry?.assignmentState === "blocked");
}

/**
 * @param {object|null|undefined} strategy - persisted ProjectStrategy
 * @param {{rows?: Array<{availability?: {state?: string}}>, probe?: "pending"|"failed"|"live"}} [facts]
 *   `probe` is how the availability intelligence arrived for this render.
 */
export function deriveTeamPresentation(strategy, { rows = [], probe = "pending" } = {}) {
  if (!strategy) return result("incomplete", "not_analyzed", false);
  if (!requiredModels(strategy).every(hasModel)) {
    return result("incomplete", "missing_assignment", false);
  }

  if (strategy.status === "suggested") {
    if (hasBlockedAssignment(strategy)) {
      return result("blocked", "assignment_blocked", true);
    }
    if (probe === "pending") return result("pending_approval", "availability_pending", true);
    if (probe === "failed") return result("blocked", "availability_unverified", true);
    const states = rows.map((row) => row?.availability?.state);
    if (states.includes("checking")) return result("pending_approval", "availability_pending", true);
    if (states.includes("blocked")) return result("blocked", "availability_blocked", true);
    if (states.some((state) => state !== "available")) {
      return result("blocked", "availability_unverified", true);
    }
    return result("ready_to_approve", null, true);
  }

  if (strategy.status !== "active") return result("incomplete", "not_approved", false);

  if (probe === "pending") return result("verifying", "availability_pending", false);
  if (probe === "failed") return result("blocked", "availability_unverified", false);
  const states = rows.map((row) => row?.availability?.state);
  if (states.includes("checking")) return result("verifying", "availability_pending", false);
  if (states.includes("blocked")) return result("blocked", "availability_blocked", false);
  if (states.some((state) => state !== "available")) return result("blocked", "availability_unverified", false);
  return result("complete", null, true);
}
