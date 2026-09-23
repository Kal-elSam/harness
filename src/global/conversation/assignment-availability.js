import { ENTITLEMENT } from "../observability/claude-model-entitlement.js";
import { CURSOR_ACCESS_STATUS, classifyCursorPool } from "../observability/cursor-entitlement.js";
import { isCursorAutoModel } from "../observability/cursor-models.js";

/**
 * Live availability for a projectTeam model ref (which has no
 * `available` flag). Entitlement beats adapter quota/eligibility.
 *
 * UI-free: this is the single source of truth for whether a model ref is
 * actually usable right now, consumed by both the legacy cockpit widget
 * (cockpit/view.js re-exports it) and the Pi host's team snapshot loader.
 * @param {object|null|undefined} model
 * @param {{eligibility?: Record<string, {ok: boolean, reason?: string}>, claudeEntitlement?: Record<string, {status: string, reason?: string|null}>}} [opts]
 * @returns {{available: boolean, warning: string|null}}
 */
export function resolveAssignmentAvailability(model, { eligibility = {}, claudeEntitlement = {}, cursorAccess = {} } = {}) {
  if (!model) return { available: false, warning: null };

  if (model.adapterId === "claude") {
    const entitlement = claudeEntitlement[model.modelId];
    if (entitlement?.status === ENTITLEMENT.DENIED) {
      const reason = entitlement.reason ?? "denied";
      return {
        available: false,
        warning: `Unavailable — your Claude plan denies this model (${reason})`
      };
    }
    if (entitlement?.status === ENTITLEMENT.UNVERIFIED) {
      return {
        available: false,
        warning: "Unavailable — model entitlement not verified (run /models --verify-access)"
      };
    }
  }

  // Cursor's own real access check (cursor-entitlement.js) — never a
  // human toggle anymore. `auto` is the opaque, manual-only fallback and
  // is never probed/scored (see cursor-models.js's own isCursorAutoModel)
  // — it stays available here so it can still be named as a manual
  // option, never blocked by a pool it was never part of.
  if (model.adapterId === "cursor" && !isCursorAutoModel(model.modelId)) {
    const pool = classifyCursorPool(model);
    const access = cursorAccess[pool];
    if (access?.status === CURSOR_ACCESS_STATUS.EXHAUSTED) {
      return {
        available: false,
        // EXHAUSTED is Cursor's internal status for ANY recognized limit text
        // (rate, usage, or monthly limit), so the visible wording states only
        // what is known — a limit was reached — and quotes Cursor's reason.
        warning: `Unavailable — Cursor ${pool === "cursor_models" ? "Cursor Models" : "Other Models"} limit reached${access.reason ? ` (${access.reason})` : ""}`
      };
    }
    if (access?.status !== CURSOR_ACCESS_STATUS.AVAILABLE) {
      // Kairo can detect a real probe failure (e.g. Cursor isn't
      // authenticated) but cannot fix it automatically — surface the
      // real reason when the probe captured one, never bury it behind a
      // generic message; fall back to the honest generic wording only
      // when no real reason was ever captured (e.g. no pool entry at all).
      return {
        available: false,
        warning: access?.reason
          ? `Unavailable — Cursor access could not be verified automatically (${access.reason})`
          : "Unavailable — Cursor access could not be verified automatically"
      };
    }
  }

  const check = eligibility[model.adapterId];
  if (check && check.ok === false) {
    return {
      available: false,
      warning: `Unavailable — ${check.reason ?? "not eligible"}`
    };
  }
  return { available: true, warning: null };
}
