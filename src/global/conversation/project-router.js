// Deterministic role -> real model resolver for Kairo's approved
// ProjectStrategy.projectTeam. This is pure routing logic over already-
// decided data (the human-approved team + current provider capacity) —
// it never spends another model call, never ranks anything itself, and
// never reclassifies a task into a role from keywords: the caller (the
// future Builder/Debugger/Tester orchestrator) always hands in an explicit
// role. Execution itself — actually launching a run against the resolved
// model, worktrees, checkpoints — is a separate, later increment; this
// module only ever decides WHAT would run, never runs it.
//
// Alternative selection is DOMAIN policy, not UI policy: when a role's
// approved assignment becomes unroutable, this module is also the one
// place that decides what real alternative (if any) to suggest — never
// the cockpit, the CLI, or an execution layer independently re-deriving
// one, which would risk three different answers for the same real state.
// Availability fallback remains the persisted projectTeam.fallback. Quota
// pressure additionally permits live re-routing through the shared team
// selection helpers: qualify against the full evidence pool, then choose
// the cheapest executable, entitled alternative outside pressured providers.

import { cheapestQualifiedAlternative } from "../intelligence/model-intelligence.js";

import { ENTITLEMENT } from "../observability/claude-model-entitlement.js";

/**
 * Whether Kairo can launch an automatic run against this real candidate
 * right now — reads model-candidate-catalog.js's own `accessMode`
 * ("automatic"|"manual"), the canonical source, never a hardcoded
 * adapterId list. Cursor/OpenCode Go are "manual" today because
 * resolveAccessMode says so, not because this module knows their names —
 * if OpenCode Go ever gets real, proven automatic execution, that change
 * lands once in resolveAccessMode and this router picks it up for free,
 * with no adapter-list edit needed here.
 */
function isAutomatic(model) {
  return model?.accessMode === "automatic";
}

export const PROJECT_ROUTE_DECISION = {
  ROUTED: "ROUTED",
  MANUAL_HANDOFF: "MANUAL_HANDOFF",
  WAIT_FOR_PROJECT_TEAM: "WAIT_FOR_PROJECT_TEAM"
};

const ROUTABLE_ENTITLEMENTS = new Set([ENTITLEMENT.ALLOWED, ENTITLEMENT.NOT_APPLICABLE]);

function assignmentRef(model, assignmentSource) {
  if (!model) return null;
  return { provider: model.adapterId, model, assignmentSource };
}

/**
 * Live entitlement gate: only when `modelEntitlement[model.adapterId][model.modelId]`
 * is PRESENT and status is denied or unverified. Missing key (empty `{}`,
 * or the adapter/model absent) keeps existing callers/tests green — no
 * gate. Namespaced by adapterId so two adapters that happen to share a raw
 * modelId (e.g. Cursor proxying a Claude model under the same id) never
 * collide.
 * @param {object} model
 * @param {Record<string, Record<string, {status?: string, reason?: string|null}>>} modelEntitlement - adapterId -> modelId -> entitlement
 * @returns {{status: string, reason: string|null}|null}
 */
function blockingEntitlement(model, modelEntitlement) {
  const entry = modelEntitlement?.[model?.adapterId]?.[model?.modelId];
  if (!entry || typeof entry !== "object") return null;
  if (entry.status === ENTITLEMENT.DENIED || entry.status === ENTITLEMENT.UNVERIFIED) {
    return {
      status: entry.status,
      reason: entry.reason == null ? null : String(entry.reason)
    };
  }
  return null;
}

/**
 * Fallback may only be suggested when it is currently automatically
 * executable AND its entitlement is allowed/not_applicable — or the key
 * is missing (default ok). Denied/unverified fallbacks stay null.
 */
function routableAlternative(model, eligibility, modelEntitlement = {}) {
  if (!model) return null;
  if (!isAutomatic(model)) return null;
  if (eligibility[model.adapterId]?.ok !== true) return null;
  const entry = modelEntitlement?.[model.adapterId]?.[model.modelId];
  if (entry && typeof entry === "object" && !ROUTABLE_ENTITLEMENTS.has(entry.status)) {
    return null;
  }
  return { provider: model.adapterId, model };
}

function blocked(role, strategyFingerprint, why, { blockedAssignment = null, suggestedAlternative = null } = {}) {
  return {
    decision: PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM, role, strategyFingerprint, why,
    provider: null, model: null, assignmentSource: null,
    blockedAssignment, suggestedAlternative
  };
}

// Below half the sustainable reset pace, preserve headroom by re-routing.
export const QUOTA_REROUTE_PACE_THRESHOLD = 0.5;
function underQuotaPressure(capacity) {
  return capacity?.quotaRemainingPercent === 0 || capacity?.quotaWindows?.some(w => w.remainingPercent === 0)
    // Untimed windows retain raw-percent cost weighting, not a burn-pace signal.
    || (capacity?.quotaWindows?.length
      ? capacity.quotaWindows.some(w => Number.isFinite(w.timeLeftFraction) && w.timeLeftFraction > 0
        && w.paceFactor < QUOTA_REROUTE_PACE_THRESHOLD)
      : typeof capacity?.quotaPaceFactor === "number" && capacity.quotaPaceFactor < QUOTA_REROUTE_PACE_THRESHOLD);
}

/**
 * Resolves one role to the real model Kairo would delegate to right now,
 * strictly from the approved ProjectStrategy — never the global QUALITY/
 * EFFICIENT team, and never a fabricated fallback.
 *
 * Blocking rules, checked in order:
 * 1. No strategy, or not ACTIVE (suggested/stale), or missing `projectTeam`
 *    entirely (an old strategy built before projectTeam existed) ->
 *    WAIT_FOR_PROJECT_TEAM, no blockedAssignment/suggestedAlternative
 *    (there's no real known assignment to block or suggest around). No
 *    silent migration — a pre-projectTeam strategy must be re-analyzed
 *    and re-approved.
 * 2. The role has no real projectTeam entry, or that entry's model is
 *    null (no real eligible candidate was ever found for it) ->
 *    WAIT_FOR_PROJECT_TEAM, same as above.
 * 3. The assigned model's own real `accessMode` isn't "automatic" (Cursor/
 *    OpenCode Go today, per resolveAccessMode — see isAutomatic) ->
 *    MANUAL_HANDOFF, still naming the real model/provider so the caller
 *    can show a concrete handoff ("Continue in Cursor with <model>"),
 *    never a bare "not supported".
 * 3.5 Live model entitlement (when `modelEntitlement[adapterId][modelId]`
 *    is present and status is denied or unverified) -> WAIT_FOR_PROJECT_TEAM with
 *    blockedAssignment naming the real CLI reason when available.
 *    Empty `{}` skips this gate.
 * 4. The assigned provider isn't currently eligible (quota/availability
 *    changed since the strategy was approved) -> WAIT_FOR_PROJECT_TEAM,
 *    with `blockedAssignment` naming the real unavailable model/reason and
 *    `suggestedAlternative` set to the strategy's own PERSISTED fallback
 *    for this role (see project-strategy.js) when that fallback is
 *    itself currently real-eligible and automatically executable —
 *    otherwise honestly null. This module never launches anything itself
 *    — it only ever decides what WOULD run — but by explicit, deliberate
 *    product decision the cockpit caller (app.js's onRequestExecute) does
 *    treat a real suggestedAlternative as automatically executable once
 *    the human has already asked for this task to run, narrating the
 *    substitution into the transcript instead of gating it behind an
 *    extra y/n prompt.
 * Quota pressure, after entitlement but before availability handling, can
 * re-route to a cheapest qualified live candidate. Without one, preserve
 * the existing route and availability gates, adding an explanatory notice.
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
 * @param {Record<string, Record<string, {status?: string, reason?: string|null}>>} [args.modelEntitlement] -
 *   live per-model entitlement, namespaced by adapter (adapterId → modelId → {status, reason}).
 *   Empty `{}` (default) does not gate — keeps pre-entitlement callers green.
 * @param {object} [args.providerCapacity] - Live quota %, reset windows and pace by provider.
 * @param {object[]} [args.models] - Real scored candidates, not synthetic fallbacks.
 * @param {object|null} [args.registry] - Shared capability evidence.
 * @param {object} [args.roleCapabilities] - Project aptitude requirements.
 * @param {number} [args.contextRemainingPercent] - Optional authoritative session context, informational only.
 * @returns {{decision: "ROUTED"|"MANUAL_HANDOFF"|"WAIT_FOR_PROJECT_TEAM", role: string, provider: string|null, model: object|null, assignmentSource: string|null, strategyFingerprint: string|null, blockedAssignment: {provider: string, model: object, assignmentSource: string}|null, suggestedAlternative: {provider: string, model: object}|null, why: string}}
 */
export function resolveProjectRoute({ contextRemainingPercent, ...args }) {
  const route = resolveRoute(args);
  if (typeof contextRemainingPercent === "number" && Number.isFinite(contextRemainingPercent)
      && contextRemainingPercent >= 0 && contextRemainingPercent <= 100) {
    return { ...route, contextRemainingPercent, why: `${route.why} Context ${contextRemainingPercent}% left (informational).` };
  }
  return route;
}

function resolveRoute({ role, strategy, eligibility = {}, modelEntitlement = {}, providerCapacity = {}, models = [], registry = null, roleCapabilities = strategy?.roleCapabilities }) {
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
    return blocked(role, strategyFingerprint, `No real eligible model was assigned to ${role} in this project's team.`);
  }

  const { model, assignmentSource, fallback = null } = entry;

  if (!isAutomatic(model)) {
    return {
      decision: PROJECT_ROUTE_DECISION.MANUAL_HANDOFF, role, provider: model.adapterId, model, assignmentSource, strategyFingerprint,
      blockedAssignment: null, suggestedAlternative: null,
      why: `${model.adapterId} isn't executable by Kairo automatically — continue manually with ${model.displayName ?? model.modelId}.`
    };
  }

  const entitlementBlock = blockingEntitlement(model, modelEntitlement);
  if (entitlementBlock) {
    const reason = entitlementBlock.reason
      ?? (entitlementBlock.status === ENTITLEMENT.DENIED
        ? "account entitlement denied"
        : "account entitlement unverified");
    const suggestedAlternative = routableAlternative(fallback, eligibility, modelEntitlement);
    const why = suggestedAlternative
      ? `${model.displayName ?? model.modelId} is not currently entitled (${reason}) — no automatic substitution; confirm the suggested alternative for ${role} before proceeding.`
      : `${model.displayName ?? model.modelId} is not currently entitled (${reason}) — no automatic alternative is available for ${role} right now.`;
    return blocked(role, strategyFingerprint, why, {
      blockedAssignment: assignmentRef(model, assignmentSource),
      suggestedAlternative
    });
  }

  let quotaNotice = "";
  const capacity = providerCapacity?.[model.adapterId];
  if (underQuotaPressure(capacity)) {
    const alternative = cheapestQualifiedAlternative(models, eligibility, registry, {
      role, roleCapabilities, providerCapacity,
      accept: candidate => candidate.adapterId !== model.adapterId
        && !!routableAlternative(candidate, eligibility, modelEntitlement)
        && !underQuotaPressure(providerCapacity?.[candidate.adapterId])
    });
    const windows = capacity.quotaWindows ?? [];
    const quota = windows.length ? windows.map(w => `${w.kind ?? "quota"} ${w.remainingPercent}% left, reset ${w.resetsAtIso ?? w.resetsAt ?? "unknown"}`).join("; ")
      : `${capacity.quotaRemainingPercent ?? "unknown"}% left, reset unknown`;
    const pressure = `${quota}; pace ${capacity.quotaPaceFactor ?? "unknown"} (re-route below ${QUOTA_REROUTE_PACE_THRESHOLD})`;
    quotaNotice = ` ${model.adapterId} ${pressure}; no qualified alternative is available.`;
    if (alternative || eligibility[model.adapterId]?.ok === true) return {
      decision: PROJECT_ROUTE_DECISION.ROUTED, role, provider: alternative?.adapterId ?? model.adapterId,
      model: alternative ?? model, assignmentSource: alternative ? "quota-reroute" : assignmentSource, strategyFingerprint,
      blockedAssignment: null, suggestedAlternative: null, rerouted: !!alternative,
      reroutedFrom: model, reroutedTo: alternative,
      why: alternative
        ? `${role} re-routed from ${model.displayName ?? model.modelId} to ${alternative.displayName ?? alternative.modelId}: ${model.adapterId} ${pressure}.`
        : `${role} keeps ${model.displayName ?? model.modelId}: ${model.adapterId} ${pressure}; no qualified alternative is available (not blocked).`
    };
  }

  if (eligibility[model.adapterId]?.ok !== true) {
    const reason = eligibility[model.adapterId]?.reason ?? "unknown reason";
    const alternative = routableAlternative(fallback, eligibility, modelEntitlement);
    // Provider AVAILABILITY (window limits, CLI not ready) is not a verdict
    // on the model: the role's own stored fallback — already vetted by
    // routableAlternative as automatic, eligible, and entitled — takes over
    // until automatic team recovery rebuilds the team. Entitlement blocks
    // above never substitute; a human override has no stored fallback, so
    // it keeps waiting instead of being replaced.
    if (alternative) {
      return {
        decision: PROJECT_ROUTE_DECISION.ROUTED, role, provider: alternative.provider, model: alternative.model,
        assignmentSource: "availability-fallback", strategyFingerprint,
        blockedAssignment: assignmentRef(model, assignmentSource), suggestedAlternative: null,
        why: `${model.displayName ?? model.modelId} is temporarily unavailable (${reason}) — ${role} uses its fallback ${alternative.model.displayName ?? alternative.model.modelId} until the team is recovered.${quotaNotice}`
      };
    }
    return blocked(role, strategyFingerprint,
      `${model.adapterId} is not currently eligible (${reason}) — no automatic alternative is available for ${role} right now.${quotaNotice}`,
      { blockedAssignment: assignmentRef(model, assignmentSource), suggestedAlternative: null });
  }

  return {
    decision: PROJECT_ROUTE_DECISION.ROUTED, role, provider: model.adapterId, model, assignmentSource, strategyFingerprint,
    blockedAssignment: null, suggestedAlternative: null,
    why: `${role} delegates to ${model.displayName ?? model.modelId} per the approved project team.`
  };
}
