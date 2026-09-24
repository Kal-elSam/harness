// Automatic team recovery after a provider-availability change.
//
// When a provider is limited, the ACTIVE team keeps working through
// resolveProjectRoute's availability fallback. This module rebuilds the team
// itself: at most once per availability fingerprint, under the project
// analysis lock, with an analyst that is available right now. The rebuilt
// team becomes ACTIVE only if the analysis succeeds, availability is still
// the one it was built for, and at least one role is routable. Otherwise
// the previous team stays exactly as it was. Every step's I/O is injected,
// so the decision logic has no hidden dependencies.

import { availabilityFingerprint } from "./availability-fingerprint.js";
import { applyProjectTeamOverride } from "./project-strategy.js";

const BLOCKED_ENTITLEMENTS = new Set(["denied", "unverified"]);

function isRoutableNow(model, eligibility) {
  return model?.accessMode === "automatic" && eligibility?.[model.adapterId]?.ok === true;
}

/**
 * @param {{strategy: object|null, fingerprint: {key: string}, record: {fingerprint: string}|null, eligibility: object}} input
 * @returns {{action: "skip", reason: string} | {action: "baseline"} | {action: "recover"}}
 */
export function decideTeamRecovery({ strategy, fingerprint, record, eligibility }) {
  if (strategy?.status !== "active" || !Array.isArray(strategy.projectTeam)) return { action: "skip", reason: "no-active-team" };
  if (record?.fingerprint === fingerprint.key) return { action: "skip", reason: "already-handled" };
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
 * and entitled. Prefers the quality pick, then the efficient pick, then any
 * other candidate; never an unavailable one. Isolation is still verified by
 * the analyzer adapter itself before any provider call.
 * @param {{recommendedModel: object|null, models: object[]}} analystCatalog
 */
export function pickRecoveryAnalyst(analystCatalog) {
  const usable = (analystCatalog?.models ?? []).filter((model) => (
    model.available === true && model.evidenceStatus !== "unscored" && !BLOCKED_ENTITLEMENTS.has(model.entitlement)
  ));
  const picked = usable.find((model) => model.recommendationTags?.includes("quality"))
    ?? usable.find((model) => model.recommendationTags?.includes("efficient"))
    ?? usable[0]
    ?? null;
  if (!picked) return null;
  const tags = picked.recommendationTags ?? [];
  return {
    model: { adapterId: picked.adapterId, modelId: picked.modelId, displayName: picked.displayName },
    selectionSource: "automatic-recovery",
    recommendationTags: tags,
    choice: tags.includes("quality") ? "quality" : tags.includes("efficient") ? "efficient" : null,
    available: picked.available, evidenceStatus: picked.evidenceStatus,
    entitlement: picked.entitlement ?? null, entitlementReason: picked.entitlementReason ?? null
  };
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
 * @param {() => number} [context.now]
 * @returns {Promise<{outcome: "skipped"|"baseline"|"activated"|"kept-previous", reason?: string, fingerprint: string, strategy?: object, analyst?: object}>}
 */
export async function runTeamRecovery(context) {
  const now = context.now ?? (() => Date.now());
  const strategy = await context.readStrategy();
  const eligibility = await context.currentEligibility();
  const fingerprint = availabilityFingerprint(eligibility);
  const record = await context.readRecord();
  const decision = decideTeamRecovery({ strategy, fingerprint, record, eligibility });

  if (decision.action === "baseline") {
    await context.writeRecord({ fingerprint: fingerprint.key, outcome: "baseline" });
    return { outcome: "baseline", fingerprint: fingerprint.key };
  }
  if (decision.action === "skip") return { outcome: "skipped", reason: decision.reason, fingerprint: fingerprint.key };

  const lock = await context.acquireLock();
  if (!lock.acquired) return { outcome: "skipped", reason: "analysis-in-progress", fingerprint: fingerprint.key };

  const keepPrevious = async (reason, detail = reason) => {
    await context.writeRecord({ fingerprint: fingerprint.key, outcome: reason });
    return { outcome: "kept-previous", reason: detail, fingerprint: fingerprint.key };
  };

  try {
    // Another process may have handled this fingerprint while we waited.
    if ((await context.readRecord())?.fingerprint === fingerprint.key) {
      return { outcome: "skipped", reason: "already-handled", fingerprint: fingerprint.key };
    }
    // Claim the fingerprint before the analysis: at most one attempt each,
    // even if this process dies mid-analysis.
    await context.writeRecord({ fingerprint: fingerprint.key, outcome: "started" });

    const preflight = await context.preflight();
    if (availabilityFingerprint(preflight.candidates?.eligibility).key !== fingerprint.key) return keepPrevious("availability-changed");

    const analyst = pickRecoveryAnalyst(preflight.analystCatalog);
    if (!analyst) return keepPrevious("no-analyst");

    let rebuilt;
    try {
      rebuilt = await context.analyze({ profile: preflight.profile, candidates: preflight.candidates, analyst });
    } catch (error) {
      return keepPrevious("analysis-failed", error?.message ?? String(error));
    }

    const eligibilityAfter = await context.currentEligibility();
    if (availabilityFingerprint(eligibilityAfter).key !== fingerprint.key) return keepPrevious("availability-changed");
    if (!rebuilt?.projectTeam?.some((entry) => isRoutableNow(entry.model, eligibilityAfter))) return keepPrevious("no-usable-provider");

    const activated = {
      ...carryOverOverrides(rebuilt, strategy),
      status: "active",
      approvedAt: new Date(now()).toISOString(),
      activation: { source: "automatic-recovery", fingerprint: fingerprint.key }
    };
    await context.writeStrategy(activated);
    await context.writeRecord({ fingerprint: fingerprint.key, outcome: "activated" });
    return { outcome: "activated", fingerprint: fingerprint.key, strategy: activated, analyst };
  } finally {
    await lock.release();
  }
}
