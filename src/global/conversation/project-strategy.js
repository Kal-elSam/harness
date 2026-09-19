// Combines a real ProjectProfile (project-profile.js), a real, already-
// validated ProjectAnalysis from the Bootstrap Analyst (project-analysis.js
// — which the analyst produced by actually reading the project, not a
// fixed mechanical checklist), and the real candidate pool (scoreAvailableModels
// output, eligibility, and the Model Intelligence Foundation registry —
// exactly what buildAiTeam/buildEfficientTeam already need) into a
// ProjectStrategy: which roles THIS project actually needs, AND which
// real model wins each one — genuinely re-scored against the project's
// own real, analyst-derived capabilities per role, never just the generic
// global team filtered down to a subset of role names.
//
// bootstrapAnalyst is NOT decided in this module — by the time
// buildProjectStrategy runs, the human has already chosen and confirmed a
// real model (see computeBootstrapAnalystAlternatives + the
// LOCAL_PREFLIGHT/AWAITING_ANALYST/ANALYZING flow in conversation/service.js),
// and that model has already produced the real analysis this module
// consumes. The analyst never picks the team; it only investigates.

import { buildAiTeam, buildEfficientTeam, ensureRegistry } from "../intelligence/model-intelligence.js";
import { ROLE_CAPABILITIES } from "../intelligence/role-profiles.js";
import { computeRoleEvaluations } from "../intelligence/capability-scoring.js";

// The Bootstrap Analyst investigates read-only via askProvider
// (intelligence/quick-ask.js), which only actually supports these
// providers today — offering any other real candidate as an "alternative"
// here would be a menu item Kairo can't actually run. Exported: ASK mode's
// own real-time routing (service.js's planAsk) needs this exact same real
// constraint when it tries to route a plain question through a PROJECT
// TEAM role.
//
// Pure CAPABILITY (can askProvider invoke this adapter's CLI at all?),
// never a cost-risk judgment — OpenCode Zen's real PAYG billing risk is
// deliberately NOT re-litigated here; that's checkCandidate's own job
// (it hard-excludes opencode-zen unconditionally), and the real
// eligibility this module receives already reflects that exclusion. Both
// opencode-go and opencode-zen genuinely run through the same real
// askOpencode call (Kairo's own read-only agent — see
// intelligence/opencode-ask-agent.js), same as real execution routing
// already treats capability and cost-risk as two separate layers.
export const ASK_SUPPORTED_ADAPTERS = new Set(["codex", "claude", "cursor", "opencode-go", "opencode-zen"]);

/**
 * The Bootstrap Analyst as a temporary, read-only WORKFLOW — deliberately
 * NOT a RoleProfile (see role-profiles.js's ROLE_PROFILES/ROLE_CAPABILITIES,
 * the six real team roles): the analyst never joins the team, never
 * writes anything, and only exists for the duration of one real /project
 * analyze run. Shaped like a RoleProfile (same fields) purely so this
 * codebase's one established "what does doing this job actually mean"
 * shape gets reused instead of inventing a second one — capabilities is
 * the SAME required-reasoning/optional-instructionFollowing baseline the
 * old ANALYST_CAPABILITIES constant hardcoded, now declared once here and
 * consumed everywhere the analyst's own capability floor matters.
 * @type {{role: string, objective: string, responsibility: string, capabilities: {required: string[], optional: string[]}, allowedActions: string[], allowedActionIds: string[], deliverable: string, completionCriteria: string}}
 */
export const BOOTSTRAP_ANALYST_PROFILE = {
  role: "BootstrapAnalyst",
  objective: "Investigate a real, not-yet-analyzed project read-only and return a structured, evidence-backed ProjectAnalysis Kairo can trust to derive this project's real role requirements from.",
  responsibility: "Read the real project (files, history, workflow docs already collected by project-profile.js, plus anything else it reads on its own) and report real architecture traits, real risks, and which of Kairo's six roles this specific project actually needs — never a boilerplate or generic answer.",
  capabilities: { required: ["reasoning"], optional: ["instructionFollowing"] },
  allowedActions: ["read files", "search/grep the repository", "run read-only inspection commands (e.g. git log, git blame)"],
  allowedActionIds: ["repo.read", "repo.search", "repo.inspect_history"],
  deliverable: "A valid ProjectAnalysis (see project-analysis.js's PROJECT_ANALYSIS_SCHEMA) — every field backed by a real file the analyst actually read, never an invented finding.",
  completionCriteria: "The analysis identifies this project's real architecture, its real risks, and which roles it actually needs, each with real supporting evidence — not just a subset copied from a generic checklist."
};

function modelRef(teamModel) {
  if (!teamModel) return null;
  return { adapterId: teamModel.adapterId, modelId: teamModel.modelId, displayName: teamModel.displayName ?? null };
}

/**
 * The richer model reference `projectTeam` entries carry — adds
 * `candidateKey` (the identity/scoring join key) and `accessMode`
 * (subscription/API/manual — see model-candidate-catalog.js) on top of
 * `modelRef`'s plain adapterId/modelId/displayName, since projectTeam is
 * the OPERATIONAL team a real router resolves against, not just
 * comparative evidence — it needs enough to actually route and launch.
 */
function projectModelRef(teamModel) {
  if (!teamModel) return null;
  return {
    candidateKey: teamModel.candidateKey ?? null, adapterId: teamModel.adapterId, modelId: teamModel.modelId,
    displayName: teamModel.displayName ?? null, accessMode: teamModel.accessMode ?? null
  };
}

/**
 * The project's own real role->capabilities map, straight from its (by
 * now analyst-derived) roleRequirements — never the generic global
 * table's OWN capability set. But whether a project-derived capability
 * is required or merely optional still comes from the global table's own
 * measured required/optional split (ROLE_CAPABILITIES[role].optional) —
 * `requirement.capabilities` itself is a flat array (project-analysis.js's
 * deriveRoleRequirements never distinguishes required from optional; the
 * Bootstrap Analyst's own schema doesn't ask for that distinction
 * either), and passing a flat array straight through would hit
 * normalizeRoleCapabilities' legacy branch — "every entry required" —
 * silently reintroducing the exact scarce-evidence problem the required/
 * optional split fixed globally (e.g. a project need citing
 * softwareExecution would make it a hard requirement again, per
 * role-profiles.js's own measured ~2-3-candidates-system-wide finding).
 * A capability the project cites that ALSO appears in the role's global
 * optional list stays optional here; everything else (the role's own
 * global-required capabilities, plus anything project-specific the
 * analyst found real evidence for that isn't in the global optional
 * list) stays required — the project's own real evidence is still
 * trusted, just not blindly promoted past what's already known to be
 * thin evidence system-wide.
 */
function projectRoleCapabilities(profile) {
  return Object.fromEntries(profile.roleRequirements.map((requirement) => {
    const globalOptional = new Set(ROLE_CAPABILITIES[requirement.role]?.optional ?? []);
    const required = requirement.capabilities.filter((capability) => !globalOptional.has(capability));
    const optional = requirement.capabilities.filter((capability) => globalOptional.has(capability));
    return [requirement.role, { required, optional }];
  }));
}

function candidateKeyOf(model) {
  return model.candidateKey ?? `${model.adapterId}::${model.modelId}`;
}

function quotaFor(providerCapacity, adapterId) {
  return providerCapacity?.[adapterId]?.quotaRemainingPercent ?? null;
}

/**
 * The full real Bootstrap Analyst catalog — every real, ask-supported
 * (see ASK_SUPPORTED_ADAPTERS) Codex/Claude candidate askProvider could
 * actually run, scored AND unscored, not just the top Quality/Efficient
 * picks. A real, unscored model (no Artificial Analysis match) is still
 * included — honestly marked `evidenceStatus: "unscored"` — so a human
 * can still pick it manually; Kairo just never recommends one on its own.
 * Ranking itself is the SAME real Pareto/risk-floor machinery every other
 * role uses (BOOTSTRAP_ANALYST_PROFILE.capabilities, under the "Explorer"
 * role bucket — see this module's own history for why that bucket name
 * is reused rather than a new one) — this function never invents a
 * second ranking formula, it only projects the real result into a richer
 * catalog shape and tags each real candidate that happens to be the
 * Quality and/or Efficient winner.
 * @param {object} args - `scoredAll`, `eligibility`, `registry`,
 *   `providerCapacity` (as computeBootstrapAnalystAlternatives), plus
 *   `unscoredModels` (real catalog models with no AA match — see
 *   conversation/service.js's own `unscoredModels`).
 * @returns {{recommendedModel: object|null, models: Array<{candidateKey: string, adapterId: string, modelId: string, displayName: string, evidenceStatus: string, available: boolean, quota: number|null, recommendationTags: string[]}>}}
 */
export function computeBootstrapAnalystCatalog({ scoredAll, eligibility, registry, providerCapacity = null, unscoredModels = [] }) {
  // Restrict the CANDIDATE POOL itself to ask-supported adapters before
  // ranking — not a post-hoc check on the winner — so the real portfolio
  // logic picks the best real candidate among what Kairo can actually
  // invoke, the same way it would for any other real role. Filtering
  // after the fact would silently lose a genuinely real 2nd/3rd-place
  // candidate whenever the unsupported provider happened to rank #1.
  const askSupportedScored = scoredAll.filter((model) => ASK_SUPPORTED_ADAPTERS.has(model.adapterId));
  // scoredAll (the Recommendation Pool) already excludes superseded
  // candidates (buildRecommendationPool); unscoredModels doesn't go
  // through that pool, so the same real "not superseded" rule is applied
  // here too — defense in depth, never trusting the caller alone to have
  // already filtered a real, proven-stale candidate out.
  const askSupportedUnscored = unscoredModels.filter((model) => ASK_SUPPORTED_ADAPTERS.has(model.adapterId) && model.lifecycle !== "superseded");

  const roleCapabilities = { Explorer: BOOTSTRAP_ANALYST_PROFILE.capabilities };
  const aiTeam = buildAiTeam(askSupportedScored, eligibility, registry, roleCapabilities);
  const efficientTeam = buildEfficientTeam(askSupportedScored, eligibility, registry, { providerCapacity, roleCapabilities });
  const quality = aiTeam.find((entry) => entry.role === "Explorer")?.primary ?? null;
  const efficient = efficientTeam.find((entry) => entry.role === "Explorer")?.primary ?? null;
  const qualityKey = quality ? candidateKeyOf(quality) : null;
  const efficientKey = efficient ? candidateKeyOf(efficient) : null;

  const scoredEntries = askSupportedScored.map((model) => {
    const key = candidateKeyOf(model);
    const recommendationTags = [];
    if (key === qualityKey) recommendationTags.push("quality");
    if (key === efficientKey) recommendationTags.push("efficient");
    return {
      candidateKey: key, adapterId: model.adapterId, modelId: model.modelId,
      displayName: model.modelName ?? model.displayName ?? model.modelId,
      evidenceStatus: model.evidenceStatus ?? "scored",
      available: eligibility[model.adapterId]?.ok === true,
      quota: quotaFor(providerCapacity, model.adapterId),
      recommendationTags
    };
  });
  const unscoredEntries = askSupportedUnscored.map((model) => ({
    candidateKey: candidateKeyOf(model), adapterId: model.adapterId, modelId: model.modelId,
    displayName: model.displayName ?? model.modelId,
    evidenceStatus: "unscored",
    available: eligibility[model.adapterId]?.ok === true,
    quota: quotaFor(providerCapacity, model.adapterId),
    recommendationTags: []
  }));

  const models = [...scoredEntries, ...unscoredEntries];
  const recommendedModel = models.find((model) => model.recommendationTags.includes("quality")) ?? null;
  return { recommendedModel, models };
}

/**
 * Real quality/efficiency Bootstrap Analyst alternatives — computed BEFORE
 * any analysis runs (LOCAL_PREFLIGHT/AWAITING_ANALYST), restricted to
 * providers Kairo can actually invoke read-only (see ASK_SUPPORTED_ADAPTERS).
 * A provider that would otherwise win Explorer but can't actually run ASK
 * (e.g. opencode-go today) is honestly excluded here, never offered as a
 * choice Kairo can't follow through on. A thin projection of
 * computeBootstrapAnalystCatalog's own real ranking — never a second,
 * independent ranking computation.
 *
 * Kept in this plain `{choice, model}` shape ONLY for the existing plain-
 * text `/project analyst quality|efficient --confirm` subcommand, which
 * predates the full catalog and can only ever offer these two picks. Each
 * entry also carries the real `selectionSource`/`recommendationTags` the
 * richer picker (the interactive overlay's analyst catalog step) needs —
 * both a recommended catalog pick, by construction — so both callers can
 * pass the exact same `analyst` shape into runBootstrapAnalysis/
 * buildProjectStrategy.
 * @param {object} candidates - `scoredAll`, `eligibility`, `registry`, `providerCapacity`
 * @returns {Array<{choice: "quality"|"efficient", model: object, selectionSource: "recommended", recommendationTags: string[]}>}
 */
export function computeBootstrapAnalystAlternatives(candidates) {
  const { models } = computeBootstrapAnalystCatalog(candidates);
  const quality = models.find((model) => model.recommendationTags.includes("quality"));
  const efficient = models.find((model) => model.recommendationTags.includes("efficient"));
  const toAlternativeModel = (model) => (model ? { adapterId: model.adapterId, modelId: model.modelId, displayName: model.displayName } : null);
  return [
    quality ? { choice: "quality", model: toAlternativeModel(quality), selectionSource: "recommended", recommendationTags: quality.recommendationTags } : null,
    efficient ? { choice: "efficient", model: toAlternativeModel(efficient), selectionSource: "recommended", recommendationTags: efficient.recommendationTags } : null
  ].filter(Boolean);
}

/**
 * Builds a "suggested" ProjectStrategy — never "active" (that only happens
 * via explicit human approval, see project-strategy-store.js +
 * conversation/service.js's approveProjectStrategy).
 *
 * orchestrator is the real, project-rescored Architect pick — a decision
 * SEPARATE from bootstrapAnalyst (given in, already confirmed and run by
 * this point), even when they happen to land on the same real model
 * because only one real candidate is accessible right now.
 * @param {object} profile - computeProjectProfile() result, with
 *   roleRequirements already replaced by project-analysis.js's
 *   deriveRoleRequirements() output (real analyst findings + mechanical floor)
 * @param {object} candidates - the real candidate pool: `scoredAll`
 *   (scoreAvailableModels output, every candidate provider), `eligibility`
 *   (checkCandidate results per adapterId), `registry` (Model Intelligence
 *   Foundation registry), `providerCapacity` (optional, for EFFICIENT's
 *   quota tiebreak) — exactly what conversation/service.js's snapshot()
 *   already attaches to modelIntelligence for this purpose.
 * @param {{model: object, choice?: "quality"|"efficient"|null, selectionSource?: "recommended"|"manual", recommendationTags?: string[]}} bootstrapAnalyst -
 *   the real model the human already chose, confirmed, and ran. `choice`
 *   is legacy — only the plain-text `/project analyst quality|efficient`
 *   subcommand still relies on it (see computeBootstrapAnalystAlternatives);
 *   any real catalog pick (including a manual/unscored one that fits
 *   neither bucket) is honestly `choice: null`, never forced into one.
 *   `selectionSource`/`recommendationTags` are the real, current contract —
 *   defaulted to "recommended"/`[bootstrapAnalyst.choice]` when a caller
 *   doesn't supply them, for the legacy path's own backward compatibility.
 * @returns {object} ProjectStrategy (status: "suggested")
 */
export function buildProjectStrategy(profile, { scoredAll, eligibility, registry, providerCapacity = null }, bootstrapAnalyst) {
  const roleCapabilities = projectRoleCapabilities(profile);
  const aiTeam = buildAiTeam(scoredAll, eligibility, registry, roleCapabilities);
  const efficientTeam = buildEfficientTeam(scoredAll, eligibility, registry, { providerCapacity, roleCapabilities });

  const byRoleCapability = new Map(aiTeam.map((entry) => [entry.role, entry]));
  const byRoleEfficient = new Map(efficientTeam.map((entry) => [entry.role, entry]));

  // Only a role the profile's own real evidence asked for (roleRequirements)
  // AND that has a real pick (against THIS project's own capability mix)
  // is "active" — a required role with no real eligible model is honestly
  // dropped, never filled with a guess.
  const activeRoles = profile.roleRequirements
    .map((requirement) => requirement.role)
    .filter((role) => byRoleCapability.has(role));

  const qualityTeam = activeRoles.map((role) => {
    const entry = byRoleCapability.get(role);
    return { role, model: modelRef(entry.primary), reason: entry.reason ?? null };
  });
  const efficientRoles = activeRoles.map((role) => {
    const entry = byRoleEfficient.get(role);
    return entry ? { role, model: modelRef(entry.primary), reason: entry.reason ?? null } : { role, model: null, reason: null };
  });

  // The OPERATIONAL team a real router resolves against (see
  // project-router.js) — reuses the exact same real Pareto/risk-floor
  // balance already computed above for efficientTeam (byRoleEfficient),
  // never a third selection formula. qualityTeam/efficientTeam remain
  // comparative evidence only; projectTeam is what Kairo actually
  // delegates to. `assignmentSource` is always "recommended" here — a
  // human override (per-role, never touching this computed ranking) is a
  // separate, later cockpit action that sets it to "override".
  //
  // `fallback` persists the SAME real next-best candidate
  // buildEfficientTeam already computed for this role (its own `fallback`
  // field — the next real eligible candidate under a different adapter,
  // see model-intelligence.js) — never a new alternative-ranking formula.
  // The router uses this, PERSISTED here at analysis time, as its own
  // real `suggestedAlternative` when the primary assignment's eligibility
  // is lost later — alternative selection is domain policy, computed
  // once here, never re-derived independently by the UI/CLI/router (which
  // would risk drifting to different answers for the same real state).
  // recommendedAssignment freezes the real original pick (model, fallback,
  // decisionEvidence) — immutable, never touched by a later override. The
  // top-level model/fallback/decisionEvidence fields are the CURRENT
  // OPERATIONAL assignment (what project-router.js actually resolves
  // against) — identical to recommendedAssignment until a human overrides
  // this role (see applyProjectTeamOverride), at which point they diverge
  // and overrideEvidence records the real access/evidence state behind
  // that specific override, never reusing the original recommendation's
  // own evidence as if it justified a different model.
  const projectTeam = activeRoles.map((role) => {
    const entry = byRoleEfficient.get(role);
    const model = entry ? projectModelRef(entry.primary) : null;
    const fallback = entry?.fallback ? projectModelRef(entry.fallback) : null;
    const decisionEvidence = entry?.decisionEvidence ?? null;
    // The same real, human-readable string efficientTeam's own entries
    // already carry (see buildEfficientTeam/describeEfficiencyDecision) —
    // never a new explanation formula, just surfaced here too so the
    // overlay can show WHY this role got this model, not only which one.
    const reason = entry?.reason ?? null;
    return {
      role, model, fallback, decisionEvidence, reason,
      assignmentSource: "recommended",
      recommendedAssignment: { model, fallback, decisionEvidence, reason },
      overrideEvidence: null
    };
  });

  return {
    status: "suggested",
    bootstrapAnalyst: bootstrapAnalyst.model,
    bootstrapAnalystChoice: bootstrapAnalyst.choice ?? null,
    bootstrapAnalystSelectionSource: bootstrapAnalyst.selectionSource ?? "recommended",
    bootstrapAnalystRecommendationTags: bootstrapAnalyst.recommendationTags ?? (bootstrapAnalyst.choice ? [bootstrapAnalyst.choice] : []),
    orchestrator: modelRef(byRoleCapability.get("Architect")?.primary),
    activeRoles,
    qualityTeam,
    efficientTeam: efficientRoles,
    projectTeam,
    profileFingerprint: profile.fingerprint,
    approvedAt: null
  };
}

/**
 * Whether a persisted, previously-approved ProjectStrategy is STALE — its
 * real underlying evidence (the ProjectProfile it was built from) has
 * genuinely changed, not just "some time has passed". A suggested (never
 * approved) strategy is never marked stale — it wasn't a commitment yet.
 * @param {object|null} strategy - the persisted ProjectStrategy, or null (NOT_ANALYZED)
 * @param {object} currentProfile - a freshly computed ProjectProfile
 * @returns {boolean}
 */
export function isStrategyStale(strategy, currentProfile) {
  if (!strategy || strategy.status !== "active") return false;
  return strategy.profileFingerprint !== currentProfile.fingerprint;
}

// projectTeam editing (section 4 — "Edición persistida del PROJECT TEAM").
// A SUGGESTED strategy only, never active/stale (see applyProjectTeamOverride/
// resetProjectTeamAssignment's own guards) — the review-before-approval
// window, not a way to silently mutate an already-running team.

// Every real adapter a projectTeam role can be assigned to for EXECUTION,
// not just the two askProvider-supported ones the Bootstrap Analyst
// catalog uses (computeBootstrapAnalystCatalog) — Cursor/OpenCode Go are
// real, selectable manual-handoff options here.
const TEAM_EDIT_ADAPTERS = new Set(["codex", "claude", "cursor", "opencode-go"]);

/**
 * The real edit catalog for one role — every real, non-superseded
 * candidate (scored AND unscored) from all four real adapters, each with
 * its own real accessMode/availability/evidenceStatus and (when the
 * registry has real evidence for it) a real RoleEvaluation for this
 * SPECIFIC role — reused via capability-scoring.js's own
 * computeRoleEvaluations, never a new scoring formula. The role's
 * required capabilities come from the GLOBAL role-profiles.js table
 * (ROLE_CAPABILITIES), not the project's own analyst-derived
 * requirements — the persisted ProjectStrategy doesn't carry the full
 * ProjectProfile forward, only its fingerprint, so the project-specific
 * capability mix isn't available again at edit time; the global table is
 * real, existing data, not an invented substitute.
 * @param {string} role
 * @param {object} candidates - `scoredAll`, `eligibility`, `registry`, `unscoredModels`
 * @returns {{role: string, models: Array<{candidateKey: string, adapterId: string, modelId: string, displayName: string, accessMode: string|null, evidenceStatus: string, available: boolean, roleEvaluation: object|null}>}}
 */
export function computeProjectTeamEditCatalog(role, { scoredAll = [], eligibility = {}, registry = null, unscoredModels = [] }) {
  const capabilities = ROLE_CAPABILITIES[role];
  if (!capabilities) return { role, models: [] };

  const teamScored = scoredAll.filter((model) => TEAM_EDIT_ADAPTERS.has(model.adapterId));
  // Same "not superseded" real rule the Recommendation Pool applies to
  // scoredAll — unscoredModels doesn't go through that pool, so it's
  // applied here too, defense in depth, never trusting the caller alone.
  const teamUnscored = unscoredModels.filter((model) => TEAM_EDIT_ADAPTERS.has(model.adapterId) && model.lifecycle !== "superseded");
  // Same real registry-seeding every other role computation relies on
  // (buildAiTeam/buildEfficientTeam's own ensureRegistry) — a caller's
  // real registry might already have richer evidence (Hugging Face,
  // manufacturer snapshots, Kairo's own telemetry); a bare/empty one gets
  // scoreAvailableModels' own AA fields seeded in, never left empty.
  const effectiveRegistry = ensureRegistry(teamScored, registry);
  const evaluations = computeRoleEvaluations(effectiveRegistry, teamScored, role, capabilities.required);

  const scoredEntries = teamScored.map((model) => {
    const key = candidateKeyOf(model);
    return {
      candidateKey: key, adapterId: model.adapterId, modelId: model.modelId,
      displayName: model.modelName ?? model.displayName ?? model.modelId,
      accessMode: model.accessMode ?? null, evidenceStatus: model.evidenceStatus ?? "scored",
      available: eligibility[model.adapterId]?.ok === true,
      roleEvaluation: evaluations.get(`${model.adapterId}::${model.modelId}`) ?? null
    };
  });
  const unscoredEntries = teamUnscored.map((model) => ({
    candidateKey: candidateKeyOf(model), adapterId: model.adapterId, modelId: model.modelId,
    displayName: model.displayName ?? model.modelId,
    accessMode: model.accessMode ?? null, evidenceStatus: "unscored",
    available: eligibility[model.adapterId]?.ok === true,
    roleEvaluation: null
  }));

  return { role, models: [...scoredEntries, ...unscoredEntries] };
}

/**
 * Whether two real model references identify the SAME real candidate —
 * prefers candidateKey (the real identity/scoring join key), but falls
 * back to adapterId+modelId when either side lacks one, so "is this the
 * same real model as the recommendation" stays correct even for a real
 * model reference that predates the candidateKey join.
 */
function sameModel(a, b) {
  if (!a || !b) return false;
  if (a.candidateKey && b.candidateKey) return a.candidateKey === b.candidateKey;
  return a.adapterId === b.adapterId && a.modelId === b.modelId;
}

function findProjectTeamEntry(strategy, role) {
  if (!strategy) throw new Error("No project strategy to edit — run /project analyze first.");
  if (strategy.status !== "suggested") throw new Error(`Cannot edit a ${strategy.status?.toUpperCase() ?? "UNKNOWN"} project strategy — only a SUGGESTED one is editable.`);
  if (!Array.isArray(strategy.projectTeam)) throw new Error("This project strategy was approved before projectTeam existed — re-analyze and approve to enable editing.");
  const index = strategy.projectTeam.findIndex((entry) => entry.role === role);
  if (index === -1) throw new Error(`"${role}" is not part of this project's team.`);
  return index;
}

/**
 * Applies a manual override to one role — the real, edit-catalog-sourced
 * `candidate` becomes the role's real operational model. Picking the same
 * candidate as the role's own real recommendation is treated as a reset
 * (see resetProjectTeamAssignment), not a redundant override — the plan's
 * own "choosing the recommended model again removes the override" rule.
 * recommendedAssignment is NEVER touched; a legacy entry that predates
 * this field (recommendedAssignment undefined) has its own current real
 * model/fallback/decisionEvidence captured as the recommendation here,
 * lazily, since that WAS this project's real original recommendation
 * before any override existed — never lost, never guessed.
 * @param {object} strategy - the persisted SUGGESTED ProjectStrategy
 * @param {string} role
 * @param {{candidateKey: string, adapterId: string, modelId: string, displayName: string, accessMode?: string|null, available?: boolean, evidenceStatus?: string, roleEvaluation?: object|null}} candidate -
 *   one real entry from computeProjectTeamEditCatalog's own output.
 * @returns {object} the updated ProjectStrategy (still status: "suggested")
 */
export function applyProjectTeamOverride(strategy, role, candidate) {
  const index = findProjectTeamEntry(strategy, role);
  const entry = strategy.projectTeam[index];
  const recommendedAssignment = entry.recommendedAssignment
    ?? { model: entry.model, fallback: entry.fallback ?? null, decisionEvidence: entry.decisionEvidence ?? null, reason: entry.reason ?? null };

  if (sameModel(recommendedAssignment.model, candidate)) {
    return resetProjectTeamAssignment(strategy, role);
  }

  const updatedEntry = {
    ...entry,
    recommendedAssignment,
    model: {
      candidateKey: candidate.candidateKey ?? null, adapterId: candidate.adapterId, modelId: candidate.modelId,
      displayName: candidate.displayName ?? null, accessMode: candidate.accessMode ?? null
    },
    // The real recommendation's own fallback/decisionEvidence/reason
    // describe THAT candidate's Pareto selection, never a human
    // override's — an override has no real computed fallback, decision
    // receipt, or ranking reason of its own (it wasn't chosen by the
    // ranking at all), so all three are honestly cleared rather than left
    // pointing at evidence for a different model, which would
    // misrepresent it as if it applied here.
    fallback: null,
    decisionEvidence: null,
    reason: null,
    assignmentSource: "override",
    overrideEvidence: {
      accessMode: candidate.accessMode ?? null, available: candidate.available ?? null,
      evidenceStatus: candidate.evidenceStatus ?? null, roleEvaluation: candidate.roleEvaluation ?? null
    }
  };
  const projectTeam = [...strategy.projectTeam];
  projectTeam[index] = updatedEntry;
  return { ...strategy, projectTeam };
}

/**
 * Removes a role's override (if any) and restores its real original
 * recommendation — model, fallback, and decisionEvidence exactly as
 * recommendedAssignment froze them. A no-op-shaped call on a role that
 * was never overridden just re-confirms the same real recommendation.
 * @param {object} strategy - the persisted SUGGESTED ProjectStrategy
 * @param {string} role
 * @returns {object} the updated ProjectStrategy (still status: "suggested")
 */
export function resetProjectTeamAssignment(strategy, role) {
  const index = findProjectTeamEntry(strategy, role);
  const entry = strategy.projectTeam[index];
  const recommendedAssignment = entry.recommendedAssignment
    ?? { model: entry.model, fallback: entry.fallback ?? null, decisionEvidence: entry.decisionEvidence ?? null, reason: entry.reason ?? null };
  const updatedEntry = {
    ...entry,
    recommendedAssignment,
    model: recommendedAssignment.model, fallback: recommendedAssignment.fallback,
    decisionEvidence: recommendedAssignment.decisionEvidence, reason: recommendedAssignment.reason ?? null,
    assignmentSource: "recommended",
    overrideEvidence: null
  };
  const projectTeam = [...strategy.projectTeam];
  projectTeam[index] = updatedEntry;
  return { ...strategy, projectTeam };
}
