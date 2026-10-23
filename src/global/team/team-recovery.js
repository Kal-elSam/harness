// Team recovery after a provider-availability change.
//
// Recovery never picks an analyst on its own: it suggests one and waits for
// the human's explicit choice (runTeamRecovery's `analystChoice`).
//
// When a provider is limited, the ACTIVE team keeps working through
// resolveProjectRoute's availability fallback. This module rebuilds the team
// itself: once per availability fingerprint (with bounded retries on
// failure), under the project
// analysis lock, with an analyst that is available right now. The rebuilt
// team becomes ACTIVE only if the analysis succeeds, availability is still
// the one it was built for, and at least one role is routable. Otherwise
// the previous team stays exactly as it was. Every step's I/O is injected,
// so the decision logic has no hidden dependencies.

import { recommendationQualifies } from "./analyst-qualification.js";
import { availabilityFingerprint } from "./availability-fingerprint.js";
import { computeProposalId } from "./pending-team-proposal-store.js";
import { applyProjectTeamOverride } from "./project-strategy.js";

const BLOCKED_ENTITLEMENTS = new Set(["denied", "unverified"]);

// Only these outcomes close a fingerprint. Every other one (a failed or
// crashed analysis, no analyst, no usable provider, availability moving
// mid-analysis) is retried on a later refresh, at most this many attempts
// per fingerprint, waiting 10 min then 20 min between them. A transient
// failure never leaves the team without another try; a persistent one
// stops at retries-exhausted instead of re-analyzing on every refresh.
// "activated" stays terminal for records written before proposals
// replaced auto-activation (see runTeamRecovery's own doc).
const TERMINAL_OUTCOMES = new Set(["activated", "baseline", "proposed", "approved", "rejected"]);
export const MAX_RECOVERY_ATTEMPTS = 3;
export const RECOVERY_RETRY_BACKOFF_MS = 10 * 60_000;

/**
 * The id a human approves by: stored on new records, derived from the
 * proposal and its base for records written before ids existed — the same
 * value either way, so a restart never changes what "the viewed proposal" is.
 */
export function recoveryProposalId(record) {
  if (!record?.proposal) return null;
  return record.proposalId ?? computeProposalId(record.proposal, record.basedOn ?? null);
}

function assertViewedProposal(record, proposalId) {
  // `undefined` is the legacy Pi command, which never carried an id; every
  // id that IS supplied must be the pending proposal's.
  if (proposalId !== undefined && proposalId !== recoveryProposalId(record)) {
    throw new Error("That is not the pending proposal you viewed — review the current proposal again.");
  }
}

function retryBackoffMs(attempts) {
  return RECOVERY_RETRY_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
}

function isRoutableNow(model, eligibility) {
  return model?.accessMode === "automatic" && eligibility?.[model.adapterId]?.ok === true;
}

/**
 * `manual` (D4): a fresh human analyst choice bypasses ONLY the internal
 * retry-later / retries-exhausted throttle. Terminal outcomes, a missing
 * active team and everything the caller revalidates stay in force.
 * @param {{strategy: object|null, fingerprint: {key: string}, record: {fingerprint: string, outcome?: string, attempts?: number|null, updatedAt?: string}|null, eligibility: object, now?: number, manual?: boolean}} input
 * @returns {{action: "skip", reason: string, lastOutcome?: string} | {action: "baseline"} | {action: "recover"}}
 */
export function decideTeamRecovery({ strategy, fingerprint, record, eligibility, now = Date.now(), manual = false }) {
  if (strategy?.status !== "active" || !Array.isArray(strategy.projectTeam)) return { action: "skip", reason: "no-active-team" };
  if (record?.fingerprint === fingerprint.key) {
    if (TERMINAL_OUTCOMES.has(record.outcome)) return { action: "skip", reason: "already-handled" };
    if (manual) return { action: "recover" };
    const attempts = record.attempts ?? 1;
    if (attempts >= MAX_RECOVERY_ATTEMPTS) return { action: "skip", reason: "retries-exhausted", lastOutcome: record.outcome };
    const lastAttemptAt = Date.parse(record.updatedAt);
    if (Number.isFinite(lastAttemptAt) && now - lastAttemptAt < retryBackoffMs(attempts)) return { action: "skip", reason: "retry-later" };
    return { action: "recover" };
  }
  const affected = strategy.projectTeam.some((entry) => (
    entry.model?.accessMode === "automatic" && !isRoutableNow(entry.model, eligibility)
  ));
  // First sight with a healthy team: remember this availability without
  // analyzing, so upgrading Kairo never re-analyzes every project once.
  if (!record && !affected) return { action: "baseline" };
  return { action: "recover" };
}

/**
 * The analyst for an automatic re-analysis: available right now, scored,
 * entitled (unknown access is never an automatic choice, T20), and tagged
 * quality or efficient with evidence that passes the SAME qualification rule
 * as the picker and the default pick (T21a). Prefers quality, then efficient.
 * There is no blind "first usable" fallback: when nothing qualifies this
 * returns null and the caller must NOT choose or analyze. Isolation is still
 * verified by the analyzer adapter itself before any provider call.
 * @param {{recommendedModel: object|null, models: object[]}} analystCatalog
 */
export function pickRecoveryAnalyst(analystCatalog) {
  const usable = recoveryAnalystOptions(analystCatalog);
  const picked = usable.find((model) => model.recommendationTags?.includes("quality"))
    ?? usable.find((model) => model.recommendationTags?.includes("efficient"))
    ?? null;
  if (!picked) return null;
  return analystFromRow(picked, "automatic-recovery");
}

/**
 * Every catalog row a recovery analysis may run on: available right now,
 * verified, scored, entitled, and passing the shared qualification rule. The
 * list the human chooses from AND the check their choice is revalidated
 * against — one rule, never relaxed to fill an empty list.
 */
export function recoveryAnalystOptions(analystCatalog) {
  const recommended = analystCatalog?.recommendedModel ?? null;
  return (analystCatalog?.models ?? []).filter((model) => (
    model.available === true && model.accessVerified !== false && model.evidenceStatus !== "unscored"
    && !BLOCKED_ENTITLEMENTS.has(model.entitlement)
    && recommendationQualifies(model, recommended?.candidateKey === model.candidateKey ? recommended : null)
  ));
}

function analystFromRow(row, selectionSource) {
  const tags = row.recommendationTags ?? [];
  return {
    model: { adapterId: row.adapterId, modelId: row.modelId, displayName: row.displayName },
    selectionSource,
    recommendationTags: tags,
    choice: tags.includes("quality") ? "quality" : tags.includes("efficient") ? "efficient" : null,
    available: row.available, evidenceStatus: row.evidenceStatus,
    entitlement: row.entitlement ?? null, entitlementReason: row.entitlementReason ?? null
  };
}

/** The catalog row a human's pick refers to, or null when it is no longer an option. */
function resolveChosenAnalyst(choice, analystCatalog) {
  const wanted = choice?.model;
  if (!wanted?.adapterId || !wanted?.modelId) return null;
  const row = recoveryAnalystOptions(analystCatalog)
    .find((model) => model.adapterId === wanted.adapterId && model.modelId === wanted.modelId);
  return row ? analystFromRow(row, "manual") : null;
}

/** Re-applies every human override from the previous team onto the rebuilt one. */
function carryOverOverrides(rebuilt, previous) {
  let result = rebuilt;
  for (const entry of previous?.projectTeam ?? []) {
    if (entry.assignmentSource !== "override" || !entry.model) continue;
    if (!result.projectTeam?.some((candidate) => candidate.role === entry.role)) continue;
    result = applyProjectTeamOverride(result, entry.role, { ...(entry.overrideEvidence ?? {}), ...entry.model });
  }
  return result;
}

/**
 * The team rows that lost access under `eligibility` — role, model name,
 * and the proven reason. This is the cause a proposal carries: real
 * per-adapter reasons, never a generic "blocked" word.
 */
function affectedEntries(strategy, eligibility) {
  return (strategy?.projectTeam ?? [])
    .filter((entry) => entry.model?.accessMode === "automatic" && !isRoutableNow(entry.model, eligibility))
    .map((entry) => ({
      role: entry.role ?? "Unknown role",
      model: entry.model?.displayName ?? entry.model?.modelId ?? "unknown",
      reason: eligibility?.[entry.model?.adapterId]?.reason ?? "not eligible"
    }));
}

/**
 * @param {object} context
 * @param {() => Promise<object|null>} context.readStrategy
 * @param {(strategy: object) => Promise<void>} context.writeStrategy
 * @param {() => Promise<object|null>} context.readRecord
 * @param {(record: {fingerprint: string, outcome: string}) => Promise<void>} context.writeRecord
 * @param {() => Promise<{acquired: boolean, release?: () => Promise<void>, holder?: object}>} context.acquireLock
 * @param {() => Promise<object>} context.currentEligibility
 * @param {() => Promise<{profile: object, candidates: object, analystCatalog: object}>} context.preflight
 * @param {(input: {profile: object, candidates: object, analyst: object}) => Promise<object>} context.analyze -
 *   returns a SUGGESTED strategy WITHOUT persisting it.
 * @param {object|null} [context.analystChoice] - the human's own pick (a
 *   fresh Enter in the picker). Without it recovery only reports
 *   `analyst_selection_required` (suggestion + eligible catalog) and runs
 *   nothing: no lock, no record, no retry consumed. With it, the pick is
 *   revalidated against a fresh catalog, and ONLY THEN is the attempt
 *   recorded (under the lock), right before the analysis starts.
 * @param {boolean} [context.explicit] - D5: the human explicitly asked for
 *   recovery (`R`). Only then does recovery prepare the selection step, and
 *   it does so even while the fingerprint is throttled (retry-later /
 *   retries-exhausted; the payload's `throttled` says which). Reading is
 *   still free: no lock, no `started` record, no attempt. Without it (and
 *   without `analystChoice`) the call is an AUTOMATIC refresh: it updates
 *   state only (baseline) and never returns picker data or analyzes.
 * @param {() => number} [context.now]
 * @returns {Promise<{outcome: "skipped"|"baseline"|"proposed"|"kept-previous"|"analyst_selection_required", reason?: string, lastOutcome?: string, throttled?: "retry-later"|"retries-exhausted", fingerprint: string, proposal?: object, affected?: object[], analyst?: object, suggestedAnalyst?: object|null, analystCatalog?: object}>}
 *
 * A recovery NEVER activates: the rebuilt team is stored as a SUGGESTED
 * proposal on the fingerprint record, and the active strategy file is not
 * touched. Approval is an explicit, separate act (see
 * approveRecoveryProposal); rejection likewise (see
 * rejectRecoveryProposal). The previous team keeps serving until a human
 * approves its replacement.
 */
export async function runTeamRecovery(context) {
  const now = context.now ?? (() => Date.now());
  const strategy = await context.readStrategy();
  const eligibility = await context.currentEligibility();
  const fingerprint = availabilityFingerprint(eligibility);
  const record = await context.readRecord();
  const manual = Boolean(context.analystChoice);
  const explicit = context.explicit === true;
  // D5: an explicit request or a deliberate pick passes the internal
  // throttle; an automatic refresh never does.
  const decide = (bypass) => decideTeamRecovery({ strategy, fingerprint, record, eligibility, now: now(), manual: bypass });
  const decision = decide(manual || explicit);

  if (decision.action === "baseline") {
    await context.writeRecord({ fingerprint: fingerprint.key, outcome: "baseline" });
    return { outcome: "baseline", fingerprint: fingerprint.key };
  }
  const skipped = ({ reason, lastOutcome }) => ({
    outcome: "skipped", reason, fingerprint: fingerprint.key, ...(lastOutcome ? { lastOutcome } : {})
  });
  if (decision.action === "skip") return skipped(decision);

  if (!context.analystChoice) {
    // D5: an automatic refresh updates state only (the baseline above). It
    // never prepares picker data and never analyzes: the human's explicit
    // request (R) is what opens the selection.
    if (!explicit) return skipped({ reason: "awaiting-explicit-request" });
    // The throttle that WOULD have applied, so the host can say the
    // selection is available while throttled. Informational only.
    const throttle = decide(false);
    const throttled = throttle.action === "skip" ? throttle.reason : null;
    // D3: recovery never analyzes on its own. It only reads the catalog,
    // highlights an eligible suggestion (or says why there is none) and
    // waits for the human's own Enter. Reading is not an attempt: nothing is
    // locked or recorded, so opening/cancelling any number of times is free.
    const preflight = await context.preflight();
    const options = recoveryAnalystOptions(preflight.analystCatalog);
    const suggested = pickRecoveryAnalyst(preflight.analystCatalog);
    return {
      outcome: "analyst_selection_required", fingerprint: fingerprint.key,
      ...(throttled ? { throttled } : {}),
      suggestedAnalyst: suggested?.model ?? null,
      analystCatalog: { recommendedModel: null, models: options },
      affected: affectedEntries(strategy, eligibility),
      reason: (throttled ? "Automatic retries are paused for this availability change; your Enter starts exactly one analysis. " : "")
        + (suggested
          ? "Choose the analyst for the recovery analysis. Nothing runs until you press Enter."
          : "No analyst is available and verified right now, so none can be suggested. Nothing was run; access requirements were not relaxed.")
    };
  }

  const lock = await context.acquireLock();
  if (!lock.acquired) return { outcome: "skipped", reason: "analysis-in-progress", fingerprint: fingerprint.key };

  let attempts = 1;
  // Failures BEFORE the analysis starts record nothing: no retry is spent
  // on something that never ran.
  // A human-started attempt is tagged so the history shows who spent it.
  const origin = manual ? { origin: "manual" } : {};
  const notStarted = (reason) => ({ outcome: "kept-previous", reason, fingerprint: fingerprint.key });
  const keepPrevious = async (reason, detail = reason) => {
    await context.writeRecord({ fingerprint: fingerprint.key, outcome: reason, attempts, ...origin });
    return { outcome: "kept-previous", reason: detail, fingerprint: fingerprint.key };
  };

  try {
    // Another process may have handled (or be backing off) this
    // fingerprint while we waited for the lock: decide again on the fresh
    // record.
    const fresh = await context.readRecord();
    const recheck = decideTeamRecovery({ strategy, fingerprint, record: fresh, eligibility, now: now(), manual });
    if (recheck.action === "skip") return skipped(recheck);
    attempts = fresh?.fingerprint === fingerprint.key ? (fresh.attempts ?? 1) + 1 : 1;

    // Revalidate everything the human's Enter relied on: availability, and
    // that the chosen analyst is still a qualifying, available option.
    const preflight = await context.preflight();
    if (availabilityFingerprint(preflight.candidates?.eligibility).key !== fingerprint.key) return notStarted("availability-changed");
    const analyst = resolveChosenAnalyst(context.analystChoice, preflight.analystCatalog);
    if (!analyst) return notStarted("analyst-unavailable");

    // The attempt is claimed only now, right before the analysis starts and
    // under the lock: a process that dies mid-analysis still counts toward
    // the retry bound.
    await context.writeRecord({ fingerprint: fingerprint.key, outcome: "started", attempts, ...origin });

    let rebuilt;
    try {
      rebuilt = await context.analyze({ profile: preflight.profile, candidates: preflight.candidates, analyst });
    } catch (error) {
      return keepPrevious("analysis-failed", error?.message ?? String(error));
    }

    const eligibilityAfter = await context.currentEligibility();
    if (availabilityFingerprint(eligibilityAfter).key !== fingerprint.key) return keepPrevious("availability-changed");
    if (!rebuilt?.projectTeam?.some((entry) => isRoutableNow(entry.model, eligibilityAfter))) return keepPrevious("no-usable-provider");

    const proposal = {
      ...carryOverOverrides(rebuilt, strategy),
      status: "suggested",
      proposedAt: new Date(now()).toISOString(),
      proposal: { source: "automatic-recovery", fingerprint: fingerprint.key }
    };
    const affected = affectedEntries(strategy, eligibility);
    // basedOn pins the exact active team this proposal was built against
    // (see approveRecoveryProposal): a late approval after a human edit
    // or a newer approval must refuse instead of overwriting. affected is
    // persisted — not just returned — so the cause still shows after a
    // restart, when only the record (never memory) is left.
    const basedOn = {
      profileFingerprint: strategy?.profileFingerprint ?? null,
      approvedAt: strategy?.approvedAt ?? null
    };
    const proposalId = computeProposalId(proposal, basedOn);
    await context.writeRecord({ fingerprint: fingerprint.key, outcome: "proposed", attempts, proposal, affected, basedOn, proposalId, ...origin });
    return { outcome: "proposed", fingerprint: fingerprint.key, proposal, affected, analyst, proposalId };
  } finally {
    await lock.release();
  }
}

/**
 * Activates a pending recovery proposal — the explicit human act that
 * runTeamRecovery deliberately does NOT perform. Re-verifies every
 * proposed assignment against CURRENT eligibility first: availability may
 * have moved since the proposal was built, and activating a stale
 * proposal would swap in models that are blocked right now.
 * @param {object} context
 * @param {() => Promise<object|null>} context.readRecord
 * @param {(record: {fingerprint: string, outcome: string}) => Promise<void>} context.writeRecord
 * @param {() => Promise<object|null>} context.readStrategy
 * @param {(strategy: object) => Promise<void>} context.writeStrategy
 * @param {() => Promise<object>} context.currentEligibility
 * @param {() => number} [context.now]
 */
export async function approveRecoveryProposal(context) {
  const now = context.now ?? (() => Date.now());
  const record = await context.readRecord();
  if (record?.outcome !== "proposed" || typeof record?.proposal !== "object" || !record.proposal) {
    throw new Error("No proposed recovery to approve — run a recovery analysis first.");
  }
  assertViewedProposal(record, context.proposalId);
  // The proposal was verified against the active team of its own time. A
  // human edit or a newer approval since then (any activation bumps
  // approvedAt; any re-analysis bumps profileFingerprint; only an ACTIVE
  // team is approvable onto) makes this approval late: refuse instead of
  // overwriting a team the human changed meanwhile. readStrategy is not
  // decorative — it is the guard.
  const current = await context.readStrategy();
  if (current?.status !== "active") {
    throw new Error("The active team is no longer active — review the current team before approving a stale proposal.");
  }
  if ((current?.profileFingerprint ?? null) !== (record.basedOn?.profileFingerprint ?? null) ||
      (current?.approvedAt ?? null) !== (record.basedOn?.approvedAt ?? null)) {
    throw new Error("The active team changed since the proposal was built — run a fresh recovery analysis instead of approving.");
  }
  const eligibility = await context.currentEligibility();
  const stale = (record.proposal.projectTeam ?? []).filter((entry) => !isRoutableNow(entry.model, eligibility));
  if (stale.length) {
    const roles = stale.map((entry) => entry.role ?? "Unknown role").join(", ");
    throw new Error(`Recovery proposal is stale (${roles} no longer routable) — run a fresh recovery analysis instead of approving.`);
  }
  const activated = {
    ...record.proposal,
    status: "active",
    approvedAt: new Date(now()).toISOString(),
    activation: { source: "recovery-approved", fingerprint: record.fingerprint }
  };
  await context.writeStrategy(activated);
  await context.writeRecord({ fingerprint: record.fingerprint, outcome: "approved" });
  return { outcome: "approved", fingerprint: record.fingerprint, strategy: activated };
}

/**
 * Dismisses a pending recovery proposal — the previous team was never
 * touched, so rejection only closes the fingerprint. A later
 * availability change (new fingerprint) may propose again.
 */
export async function rejectRecoveryProposal(context) {
  const record = await context.readRecord();
  if (record?.outcome !== "proposed" || typeof record?.proposal !== "object" || !record.proposal) {
    throw new Error("No proposed recovery to reject.");
  }
  assertViewedProposal(record, context.proposalId);
  await context.writeRecord({ fingerprint: record.fingerprint, outcome: "rejected" });
  return { outcome: "rejected", fingerprint: record.fingerprint };
}
