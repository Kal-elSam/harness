// Deterministic role -> real model resolver for Kairo's approved
// ProjectStrategy.projectTeam. This is pure routing logic over already-
// decided data (the human-approved team + current provider eligibility) —
// it never spends another model call, never ranks anything itself, and
// never reclassifies a task into a role from keywords: the caller (the
// future Builder/Debugger/Tester orchestrator) always hands in an explicit
// role. Execution itself — actually launching a run against the resolved
// model, worktrees, checkpoints — is a separate, later increment; this
// module only ever decides WHAT would run, never runs it.

// Providers Kairo can't launch an automatic run against today (see
// execution-adapters/index.js) — a real model assigned to one of these
// is honestly reported as a manual handoff, never silently substituted or
// silently executed anyway.
const MANUAL_ONLY_ADAPTERS = new Set(["cursor", "opencode-go"]);

export const PROJECT_ROUTE_DECISION = {
  ROUTED: "ROUTED",
  MANUAL_HANDOFF: "MANUAL_HANDOFF",
  WAIT_FOR_PROJECT_TEAM: "WAIT_FOR_PROJECT_TEAM"
};

function blocked(role, strategyFingerprint, why, { provider = null, model = null, assignmentSource = null } = {}) {
  return { decision: PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM, role, provider, model, assignmentSource, strategyFingerprint, why };
}

/**
 * Resolves one role to the real model Kairo would delegate to right now,
 * strictly from the approved ProjectStrategy — never the global QUALITY/
 * EFFICIENT team, and never a fabricated fallback.
 *
 * Blocking rules, checked in order:
 * 1. No strategy, or not ACTIVE (suggested/stale), or missing `projectTeam`
 *    entirely (an old strategy built before projectTeam existed) ->
 *    WAIT_FOR_PROJECT_TEAM. No silent migration — a pre-projectTeam
 *    strategy must be re-analyzed and re-approved.
 * 2. The role has no real projectTeam entry, or that entry's model is
 *    null (no real eligible candidate was ever found for it) ->
 *    WAIT_FOR_PROJECT_TEAM.
 * 3. The assigned model's provider can't run an automatic Kairo execution
 *    (Cursor, OpenCode today — see MANUAL_ONLY_ADAPTERS) -> MANUAL_HANDOFF,
 *    still naming the real model/provider so the caller can show a
 *    concrete handoff ("Continue in Cursor with <model>"), never a bare
 *    "not supported".
 * 4. The assigned provider isn't currently eligible (quota/availability
 *    changed since the strategy was approved) -> WAIT_FOR_PROJECT_TEAM,
 *    naming the real unavailable model/reason — never a silent automatic
 *    substitution. Presenting a same-role alternative before the human
 *    confirms is a confirmation-flow concern (cockpit), not this router's
 *    job; this router only ever reports the real, current state.
 * 5. Otherwise -> ROUTED, with the real provider/model/assignmentSource
 *    this role delegates to.
 * @param {object} args
 * @param {string} args.role - given explicitly by the caller, never
 *   inferred from task text.
 * @param {object|null} args.strategy - the persisted ProjectStrategy, or
 *   null when none exists yet.
 * @param {Record<string, {ok: boolean, reason?: string}>} [args.eligibility] -
 *   CURRENT provider eligibility — may have changed since the strategy was
 *   built/approved.
 * @returns {{decision: "ROUTED"|"MANUAL_HANDOFF"|"WAIT_FOR_PROJECT_TEAM", role: string, provider: string|null, model: object|null, assignmentSource: string|null, strategyFingerprint: string|null, why: string}}
 */
export function resolveProjectRoute({ role, strategy, eligibility = {} }) {
  const strategyFingerprint = strategy?.profileFingerprint ?? null;

  if (!strategy) {
    return blocked(role, strategyFingerprint, "No project strategy exists yet — run /project to analyze and approve one.");
  }
  if (strategy.status !== "active") {
    return blocked(role, strategyFingerprint, `Project strategy is ${strategy.status?.toUpperCase() ?? "UNKNOWN"}, not ACTIVE — approve it before Kairo can delegate automatically.`);
  }
  if (!Array.isArray(strategy.projectTeam)) {
    return blocked(role, strategyFingerprint, "This project strategy was approved before projectTeam existed — re-analyze and approve to enable automatic delegation.");
  }

  const entry = strategy.projectTeam.find((e) => e.role === role);
  if (!entry || !entry.model) {
    return blocked(role, strategyFingerprint, `No real eligible model was assigned to ${role} in this project's team.`, { assignmentSource: entry?.assignmentSource ?? null });
  }

  const { model, assignmentSource } = entry;

  if (MANUAL_ONLY_ADAPTERS.has(model.adapterId)) {
    return {
      decision: PROJECT_ROUTE_DECISION.MANUAL_HANDOFF, role, provider: model.adapterId, model, assignmentSource, strategyFingerprint,
      why: `${model.adapterId} isn't executable by Kairo automatically — continue manually with ${model.displayName ?? model.modelId}.`
    };
  }

  if (eligibility[model.adapterId]?.ok !== true) {
    const reason = eligibility[model.adapterId]?.reason ?? "unknown reason";
    return blocked(role, strategyFingerprint, `${model.adapterId} is not currently eligible (${reason}) — no automatic substitution; confirm an alternative for ${role} before proceeding.`, { provider: model.adapterId, model, assignmentSource });
  }

  return {
    decision: PROJECT_ROUTE_DECISION.ROUTED, role, provider: model.adapterId, model, assignmentSource, strategyFingerprint,
    why: `${role} delegates to ${model.displayName ?? model.modelId} per the approved project team.`
  };
}
