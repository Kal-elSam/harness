/**
 * Headless project-team analyze + approve for the ratatui host.
 *
 * The ratatui UI owns team setup end to end: no cockpit, no Pi slash
 * command. This module is the thin, non-interactive equivalent of the
 * cockpit's ProjectOverlay flow (preflight -> analyst -> analyze ->
 * approve), reusing conversation/service.js verbatim. It decides exactly
 * one thing the overlay asked a human for: which Bootstrap Analyst to
 * use (the catalog's own recommendation, see `pickDefaultAnalyst`).
 *
 * Fail-closed: an empty or fully unavailable analyst catalog throws with a
 * concrete reason instead of falling back to another provider, and no role
 * or model is ever synthesized here — every row comes from the real
 * ProjectStrategy the service persisted.
 */

import {
  MIN_RECOMMENDATION_CONFIDENCE, compareAnalystRows, qualifiesForMainView, recommendationQualifies
} from "../conversation/analyst-qualification.js";
import { createConversationService } from "../conversation/service.js";

/** Short provider labels for compact absence notices — never invent causes. */
const PROVIDER_PICKER_LABELS = Object.freeze({
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  "opencode-go": "OpenCode Go",
  "opencode-zen": "OpenCode Zen",
  opencode: "OpenCode",
  pi: "Pi"
});

function providerPickerLabel(adapterId) {
  return PROVIDER_PICKER_LABELS[adapterId] ?? String(adapterId);
}

export { MIN_RECOMMENDATION_CONFIDENCE };

const EMPTY_VERIFICATION_PLAN = Object.freeze({
  pendingCount: 0, reusableCount: 0, mayConsumeQuota: false, subscriptions: [], costStatement: null
});

/** Access is explicitly UNVERIFIED (catalog `accessVerified: false`); absent field = verified/legacy. */
function isAccessUnverified(model) {
  return model?.accessVerified === false;
}

/** Usable now (`available`) or selectable with revalidation (`selectable`, unverified access). */
function isPickerSelectable(model) {
  return model?.available === true || model?.selectable === true;
}

/** Usable now AND access verified: the only kind of row the picker lists (T23). */
function isVerifiedAvailable(model) {
  return model?.available === true && !isAccessUnverified(model);
}

/** Main view size: the top three qualified options, never padded. */
export const MAIN_VIEW_LIMIT = 3;

const isMeasured = (value) => typeof value === "number" && Number.isFinite(value);

// Plain-language strength bands. The numeric fit/evidence stay internal (they
// drive ranking); the picker only ever shows these words.
function strengthWord(value) {
  if (value >= 0.75) return "excelente";
  if (value >= 0.55) return "sólido";
  if (value >= 0.35) return "moderado";
  return "limitado";
}

function confidenceWord(value) {
  if (value >= 0.75) return "alta";
  if (value >= 0.6) return "media";
  return "baja";
}

/** One short Spanish line per row, from the row's own real evidence only — words, never numbers. */
function explainRow(model, listing) {
  const { reasoning, coding } = model.evidence ?? {};
  const hasBoth = isMeasured(reasoning) && isMeasured(coding);
  const evidenceWords = hasBoth
    ? `razonamiento ${strengthWord(reasoning)} · código ${strengthWord(coding)} · confianza ${confidenceWord(model.confidence)}`
    : null;
  if (listing === "main") return evidenceWords ?? "evidencia de razonamiento y código incompleta";
  if (model.evidenceStatus === "unscored") return "sin benchmark · solo manual";
  if (!hasBoth) return "benchmark incompleto · solo manual";
  return `${evidenceWords} · ${qualifiesForMainView(model) ? "fuera del top tres" : "evidencia insuficiente para el top"} · solo manual`;
}

function subscriptionOf(model) {
  return providerPickerLabel(model.adapterId);
}

/** Model AND subscription, so near-identical rows on two subscriptions stay distinguishable. */
function decorate(model, listing, tags) {
  const subscription = subscriptionOf(model);
  return {
    ...model,
    recommendationTags: tags,
    listing,
    subscription,
    label: `${model.displayName ?? model.modelId} · ${subscription}`,
    explanation: explainRow(model, listing)
  };
}

/**
 * Curate the full analyst catalog for the ratatui picker into two explicit
 * views of VERIFIED, available options only. Identity is the candidateKey
 * (adapterId + modelId), never the display name: the same model through two
 * subscriptions keeps both rows. One ranking (shared comparator: measured fit,
 * then confidence, then name) spans every subscription.
 *
 * - `models` (MAIN view): the top THREE candidates that pass
 *   `qualifiesForMainView` (available, access verified, reasoning AND coding
 *   evidence, confidence >= MIN_RECOMMENDATION_CONFIDENCE). Never padded with
 *   insufficient candidates.
 * - `alternatives` (MANUAL view): every other verified, available candidate —
 *   qualified ones beyond the top three, plus thin/partial/no-benchmark ones.
 *   Manual no longer means pending access.
 * - Unverified, denied, exhausted and unavailable candidates are in neither
 *   view; `buildAnalystExclusionCauses` reports them by subscription.
 *
 * `recommendedModel` (the star) is the FIRST main row. Each row gains
 * additive `listing`, `subscription`, `label` and a plain-language
 * `explanation` (no decimals). Never invents models.
 *
 * @param {{recommendedModel?: object|null, models?: object[]}|null|undefined} analystCatalog
 * @returns {{recommendedModel: object|null, models: object[], alternatives: object[]}}
 */
export function curateAnalystCatalogForPicker(analystCatalog) {
  const incoming = Array.isArray(analystCatalog?.models) ? analystCatalog.models : [];
  const seen = new Set();
  const verified = [];
  for (const model of incoming) {
    if (!isVerifiedAvailable(model)) continue;
    const key = model.candidateKey ?? `${model.adapterId}::${model.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    verified.push(model);
  }
  const qualified = verified.filter(qualifiesForMainView).sort(compareAnalystRows);
  const others = verified.filter((model) => !qualifiesForMainView(model));
  const mainSource = qualified.slice(0, MAIN_VIEW_LIMIT);
  const manualSource = [...qualified.slice(MAIN_VIEW_LIMIT), ...others].sort(compareAnalystRows);

  const withoutQuality = (model) => (model.recommendationTags ?? []).filter((tag) => tag !== "quality");
  const models = mainSource.map((model, index) => decorate(
    model, "main", index === 0 ? ["quality", ...withoutQuality(model)] : withoutQuality(model)
  ));
  const alternatives = manualSource.map((model) => decorate(model, "manual", []));
  // The star: the first row of the unified ranking (qualifiesForMainView
  // already guarantees enough confidence), never an incoming pointer.
  const first = models[0] ?? null;
  const recommendedModel = first && recommendationQualifies(first, null) ? first : null;
  return { recommendedModel, models, alternatives };
}

// Verifiable cause -> Spanish picker copy. Only causes backed by real
// evidence; never funds/credits/billing. `access_unknown` is worded as an
// explicit partial-comparison acknowledgement (never as unavailability).
const CAUSE_ORDER = ["quota_exhausted", "unavailable_verified", "policy_excluded", "access_unknown", "unscored"];
const CAUSE_COPY = Object.freeze({
  quota_exhausted: "cuota agotada",
  unavailable_verified: "no disponible para análisis ahora",
  policy_excluded: "excluido por política",
  access_unknown: "no verificado — comparación parcial",
  unscored: "sin benchmark (solo selección manual)"
});

const REASON_COPY = Object.freeze({ stale: "evidencia vencida" });

/**
 * Machine-readable, per-subscription exclusion causes for every candidate that
 * is in NEITHER picker view (T23): unverified access, verified-denied,
 * exhausted quota, provider unavailable, policy. One row per (provider,
 * cause): `{adapterId, provider, cause, models, reason}`, reported even when
 * the same subscription still has verified rows (a partial comparison is never
 * presented as complete). Sources are real evidence only: per-model `cause` /
 * `accessVerified` on catalog models, `rawCatalog.exclusions` (denied models
 * absent from `models` by design) and the Claude unverified-access notice.
 * Never an invented cause.
 *
 * @param {{models?: object[], exclusions?: object[]}|null|undefined} rawCatalog
 * @param {{models?: object[], alternatives?: object[]}|null|undefined} curatedCatalog
 * @param {string|null|undefined} unverifiedClaudeNotice
 * @returns {Array<{adapterId: string, provider: string, cause: string, models: number, reason: string|null}>}
 */
export function buildAnalystExclusionCauses(rawCatalog, curatedCatalog, unverifiedClaudeNotice = null) {
  const curatedRows = [
    ...(Array.isArray(curatedCatalog?.models) ? curatedCatalog.models : []),
    ...(Array.isArray(curatedCatalog?.alternatives) ? curatedCatalog.alternatives : [])
  ];
  const curatedKeys = new Set(curatedRows.map((m) => m?.candidateKey ?? `${m?.adapterId}::${m?.modelId}`));
  const curatedAdapters = new Set(curatedRows.map((m) => m?.adapterId).filter(Boolean));
  const rows = new Map();
  const add = (adapterId, cause, candidateKey, reason = null) => {
    if (!adapterId || !CAUSE_COPY[cause]) return;
    const key = `${adapterId}\u0000${cause}`;
    const row = rows.get(key) ?? { adapterId, provider: providerPickerLabel(adapterId), cause, keys: new Set(), reason: null };
    row.keys.add(candidateKey ?? `${adapterId}::${row.keys.size}`);
    row.reason = row.reason ?? reason;
    rows.set(key, row);
  };
  for (const model of Array.isArray(rawCatalog?.models) ? rawCatalog.models : []) {
    const candidateKey = model?.candidateKey ?? `${model?.adapterId}::${model?.modelId}`;
    if (curatedKeys.has(candidateKey)) continue;
    // A provider-level cause (quota, unavailable, policy) wins over unknown
    // access: the model is out because of the provider, not just unverified.
    const providerCause = model?.cause && model.cause !== "access_unknown" && model.cause !== "unscored" ? model.cause : null;
    if (model?.available !== true) {
      if (providerCause) add(model?.adapterId, providerCause, candidateKey);
      else if (isAccessUnverified(model) || model?.cause === "access_unknown") add(model?.adapterId, "access_unknown", candidateKey, model?.entitlementReason ?? null);
      else add(model?.adapterId, "unavailable_verified", candidateKey);
    }
  }
  for (const exclusion of Array.isArray(rawCatalog?.exclusions) ? rawCatalog.exclusions : []) {
    add(exclusion?.adapterId, exclusion?.cause, exclusion?.candidateKey, exclusion?.reason ?? null);
  }
  if (unverifiedClaudeNotice && !curatedAdapters.has("claude") && ![...rows.values()].some((r) => r.adapterId === "claude" && r.cause === "access_unknown")) {
    add("claude", "access_unknown", "claude::notice", String(unverifiedClaudeNotice));
  }
  return [...rows.values()]
    .map(({ keys, reason, ...row }) => ({ ...row, models: keys.size, reason: reason == null ? null : (REASON_COPY[reason] ?? reason) }))
    .sort((a, b) => a.provider.localeCompare(b.provider) || CAUSE_ORDER.indexOf(a.cause) - CAUSE_ORDER.indexOf(b.cause));
}

/**
 * Compact honest notice naming, per subscription, every verifiable cause that
 * keeps candidates out of the picker (see buildAnalystExclusionCauses). Never
 * invents billing / out-of-funds / credits causes, and words unknown access as
 * a partial comparison, never as unavailability.
 *
 * @param {{models?: object[], exclusions?: object[]}|null|undefined} rawCatalog
 * @param {{models?: object[], alternatives?: object[]}|null|undefined} curatedCatalog
 * @param {string|null|undefined} unverifiedClaudeNotice
 * @returns {string|null}
 */
export function buildAnalystPickerNotice(rawCatalog, curatedCatalog, unverifiedClaudeNotice = null) {
  const byProvider = new Map();
  for (const row of buildAnalystExclusionCauses(rawCatalog, curatedCatalog, unverifiedClaudeNotice)) {
    const copies = byProvider.get(row.provider) ?? [];
    copies.push(CAUSE_COPY[row.cause]);
    byProvider.set(row.provider, copies);
  }
  const parts = [...byProvider.entries()].map(([provider, copies]) => `${provider}: ${copies.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The default Bootstrap Analyst: ONLY the catalog's own recommended model,
 * and only when it is currently available and still qualifies as a
 * recommendation (same confidence rule the picker's star uses). Anything
 * else returns null — there is no blind "first available" fallback; the
 * caller must ask the human to choose.
 *
 * @param {{recommendedModel?: {candidateKey?: string}|null, models?: object[]}|null|undefined} analystCatalog
 * @returns {{model: {adapterId: string, modelId: string, displayName: string}, selectionSource: "recommended"|"manual", recommendationTags: string[], choice: "quality"|"efficient"|null}|null}
 */
export function pickDefaultAnalyst(analystCatalog) {
  const models = analystCatalog?.models ?? [];
  const recommendedKey = analystCatalog?.recommendedModel?.candidateKey ?? null;
  const picked = recommendedKey
    ? models.find((model) => model?.available === true && !isAccessUnverified(model) && model.candidateKey === recommendedKey)
    : null;
  if (!picked || !recommendationQualifies(picked, analystCatalog.recommendedModel)) return null;
  const recommendationTags = picked.recommendationTags ?? [];
  return {
    // The same clean modelRef shape the overlay hands to
    // runBootstrapAnalysis — no catalog-only fields leak into what gets
    // persisted as the strategy's own bootstrapAnalyst.
    model: {
      adapterId: picked.adapterId,
      modelId: picked.modelId,
      displayName: picked.displayName
    },
    selectionSource: "recommended",
    recommendationTags,
    choice: recommendationTags.includes("quality")
      ? "quality"
      : recommendationTags.includes("efficient")
        ? "efficient"
        : null
  };
}

/** `adapterId · displayName` for a persisted analyst/model ref (honest when absent). */
function modelLabel(ref) {
  const model = ref?.model ?? ref;
  const name = model?.displayName ?? model?.modelId ?? null;
  const via = model?.adapterId ?? null;
  if (!name) return null;
  return via ? `${via} · ${name}` : name;
}

/**
 * Host-facing summary of a real ProjectStrategy — state, row count, roles
 * and the analyst that produced it. Never a recommendation of its own.
 * @param {object|null} strategy
 */
export function summarizeProjectStrategy(strategy) {
  if (!strategy) return null;
  const team = strategy.projectTeam ?? [];
  return {
    state: strategy.status ?? "unknown",
    teamRows: team.length,
    roles: team.map((entry) => entry?.role).filter(Boolean),
    analyst: modelLabel(strategy.bootstrapAnalyst),
    projectRoot: strategy.projectRoot ?? null
  };
}

function requireCwd(cwd) {
  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new Error("Project team analyze/approve requires a project directory (cwd).");
  }
  return cwd;
}

export const ANALYST_SELECTION_REQUIRED_MESSAGE =
  "No analyst qualifies as a recommendation for this project — open the analyst picker and choose one.";

function noAnalystError(analystCatalog) {
  const total = analystCatalog?.models?.length ?? 0;
  if (total === 0) {
    return new Error(
      "No ask-capable analyst model in this project's catalog — Kairo cannot analyze the project team. " +
        "Authenticate a supported provider CLI (Codex, Claude, Cursor, OpenCode) and try again."
    );
  }
  return new Error(
    `Every analyst candidate (${total}) is not available right now — Kairo will not run a project analysis with an ineligible model. ` +
      "Check provider access (login / quota / entitlement) and try again."
  );
}

/**
 * Re-validates a human's own picked analyst (the ratatui host's picker —
 * see analyst-picker payload shape, matching the cockpit's own
 * ProjectOverlay onSelect) against the FRESH catalog from this call's own
 * preflight, never trusting a stale caller-supplied `available` flag.
 * Returns null (never throws) when the requested candidate isn't in the
 * catalog at all, or is there but not currently available — the caller
 * decides how to fail closed.
 *
 * @param {{model?: {adapterId?: string, modelId?: string}}|null|undefined} requested
 * @param {{recommendedModel?: {candidateKey?: string}|null, models?: object[]}|null|undefined} analystCatalog
 */
function resolveRequestedAnalyst(requested, analystCatalog) {
  const adapterId = requested?.model?.adapterId ?? null;
  const modelId = requested?.model?.modelId ?? null;
  if (!adapterId || !modelId) return null;
  const models = analystCatalog?.models ?? [];
  const match = models.find((model) => model?.adapterId === adapterId && model?.modelId === modelId);
  if (!match || !isPickerSelectable(match)) return null;
  const recommendedKey = analystCatalog?.recommendedModel?.candidateKey ?? null;
  const recommendationTags = match.recommendationTags ?? [];
  return {
    // Internal marker (stripped before the analyst reaches the service).
    needsAccessCheck: isAccessUnverified(match),
    accessCheckConfirmed: requested?.accessCheckConfirmed === true,
    model: { adapterId: match.adapterId, modelId: match.modelId, displayName: match.displayName },
    selectionSource: match.candidateKey === recommendedKey && !isAccessUnverified(match) ? "recommended" : "manual",
    recommendationTags,
    choice: recommendationTags.includes("quality")
      ? "quality"
      : recommendationTags.includes("efficient")
        ? "efficient"
        : null
  };
}

/**
 * Honest result when the on-demand access check for an unverified-access
 * analyst did not pass. Says only what is known: the real reason, never a
 * made-up quota/billing cause. Nothing ran and nothing was substituted.
 */
function accessUnverifiedResult(model, check) {
  const label = model.displayName ?? model.modelId;
  const denied = check.status === "denied";
  const reason = check.reason ?? null;
  const headline = denied
    ? `Access to ${label} was checked and is not available`
    : `Access to ${label} could not be verified`;
  return {
    status: "analyst_access_unverified",
    accessStatus: denied ? "denied" : "unverified",
    analyst: { adapterId: model.adapterId, modelId: model.modelId, displayName: label },
    reason,
    message: `${headline}${reason ? ` (${reason})` : ""} — nothing was analyzed. Pick another analyst or try again.`
  };
}

/**
 * Honest result when an unknown-access analyst is picked without the explicit
 * second confirmation: the provider was NOT called and nothing ran.
 */
function accessConfirmationRequiredResult(model) {
  const label = model.displayName ?? model.modelId;
  return {
    status: "analyst_access_confirmation_required",
    analyst: { adapterId: model.adapterId, modelId: model.modelId, displayName: label },
    message: `Access to ${label} is unverified. Verifying it calls the provider and may consume account — confirm explicitly to continue. Nothing was run.`
  };
}

function requestedAnalystError(requested) {
  const label = requested?.model?.displayName ?? requested?.model?.modelId ?? "The selected analyst";
  return new Error(
    `${label} is not an available analyst for this project right now — pick another model and try again.`
  );
}

/**
 * JSON-safe clone for values that cross the stdio sidecar boundary — drops
 * functions/class methods rather than throwing, and fails to `null` (never
 * a crash) on a genuinely circular value. `undefined` also becomes `null`
 * so a caller always gets a concrete, serializable shape.
 * @param {unknown} value
 */
function toSerializable(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

/**
 * Read-only preflight for the ratatui host's own analyst picker (T2) — the
 * non-interactive equivalent of the cockpit's ProjectOverlay landing on
 * SELECT_ANALYST. Uses `mode: "catalog"` so opening the modal waits on
 * snapshot/probes only (no project-profile scan). Analyze re-runs a full
 * preflight itself, so a serialization miss on profile never blocks the picker.
 *
 * @param {{cwd?: string, createConversationService?: typeof createConversationService}} args
 * @returns {Promise<{analystCatalog: {recommendedModel: object|null, models: object[], alternatives: object[]}, profile: object|null, candidates: object|null, projectRoot: string|null, unverifiedClaudeNotice: string|null, pickerNotice: string|null, exclusionCauses: Array<{adapterId: string, provider: string, cause: string, models: number, reason: string|null}>}>}
 */
export async function preflightProjectTeam({
  cwd,
  createConversationService: createService = createConversationService
} = {}) {
  const projectCwd = requireCwd(cwd);
  const service = createService({ enableProviderProbes: true });
  const preflight = await service.preflightProject({ cwd: projectCwd, mode: "catalog" });
  const rawCatalog = preflight.analystCatalog ?? { recommendedModel: null, models: [] };
  const analystCatalog = curateAnalystCatalogForPicker(rawCatalog);
  const unverifiedClaudeNotice = preflight.unverifiedClaudeNotice ?? null;
  const exclusionCauses = buildAnalystExclusionCauses(rawCatalog, analystCatalog, unverifiedClaudeNotice);
  return {
    analystCatalog,
    profile: toSerializable(preflight.profile),
    candidates: toSerializable(preflight.candidates),
    projectRoot: preflight.projectRoot ?? null,
    unverifiedClaudeNotice,
    pickerNotice: buildAnalystPickerNotice(rawCatalog, analystCatalog, unverifiedClaudeNotice),
    // Additive (T10/T11): machine-readable cause rows behind `pickerNotice`.
    exclusionCauses,
    // Additive (T23): subscriptions whose access could not be verified — the
    // picker must say so, a partial comparison is never presented as complete.
    unverifiedSubscriptions: exclusionCauses
      .filter((row) => row.cause === "access_unknown")
      .map(({ adapterId, provider, models, reason }) => ({ adapterId, provider, models, reason })),
    // Additive (T23): the concrete, never-executed verification plan.
    verificationPlan: toSerializable(preflight.verificationPlan) ?? EMPTY_VERIFICATION_PLAN
  };
}

/**
 * Explicit, consented access verification for the picker (T23). Without
 * `confirmed === true` nothing is asked of the service at all. With consent it
 * runs `service.verifyAccess` (each pending check at most once; only real
 * allowed/denied results are persisted by the service) and returns the
 * per-subscription outcomes. Never touches the project strategy. A failure is
 * reported as `{ran: false, status: "failed", message}` with the real reason.
 *
 * @param {{cwd?: string, confirmed?: boolean, createConversationService?: typeof createConversationService}} args
 * @returns {Promise<{ran: boolean, status: "confirmation_required"|"verified"|"failed"|"unavailable", message?: string, persisted?: boolean, outcomes: object[]}>}
 */
export async function verifyProjectTeamAccess({
  cwd,
  confirmed,
  createConversationService: createService = createConversationService
} = {}) {
  const projectCwd = requireCwd(cwd);
  if (confirmed !== true) {
    return {
      ran: false, status: "confirmation_required", outcomes: [],
      message: "Access verification calls the providers and may consume quota — it only runs after explicit confirmation. Nothing was run."
    };
  }
  try {
    const service = createService({ enableProviderProbes: true });
    if (typeof service.verifyAccess !== "function") {
      return { ran: false, status: "unavailable", outcomes: [], message: "This build has no access verification entry point." };
    }
    const result = await service.verifyAccess({ cwd: projectCwd, confirmed: true });
    return toSerializable(result) ?? { ran: false, status: "failed", outcomes: [], message: "Verification returned no result." };
  } catch (error) {
    return { ran: false, status: "failed", outcomes: [], message: `Access verification failed: ${error?.message ?? String(error)}` };
  }
}

/**
 * Analyze this project's team headlessly. Persists a SUGGESTED
 * ProjectStrategy (the service does) — never active: activation stays an
 * explicit human act (`approveProjectTeam`).
 *
 * `analyst` is an optional human pick from the ratatui host's own picker
 * (T2) — the same clean modelRef shape the cockpit's ProjectOverlay
 * onSelect builds (`{model, selectionSource, recommendationTags, choice}`).
 * It is re-validated against THIS call's own fresh catalog (never trusted
 * verbatim — availability can change between the picker's preflight and
 * this analyze). Omitted or unresolvable → the catalog's own recommended
 * default (`pickDefaultAnalyst`) when it qualifies; otherwise the result is
 * `{status: "analyst_selection_required", message}` and nothing runs.
 *
 * T20: a requested analyst whose access is UNVERIFIED needs the explicit
 * `analyst.accessCheckConfirmed === true` (the probe calls the provider and
 * may consume account); without it the result is `{status:
 * "analyst_access_confirmation_required", analyst, message}` and nothing runs.
 * Once confirmed it is revalidated through
 * `service.verifyAnalystAccess` before anything runs; if that does not pass the
 * result is `{status: "analyst_access_unverified", accessStatus, analyst,
 * reason, message}` — no provider call, no strategy write, no substitution.
 *
 * @param {{cwd?: string, analyst?: object|null, createConversationService?: typeof createConversationService}} args
 * @returns {Promise<{state: string, teamRows: number, roles: string[], analyst: string|null, projectRoot: string|null, notice: string|null}|{status: "analyst_selection_required", message: string}|{status: "analyst_access_confirmation_required", analyst: {adapterId: string, modelId: string, displayName: string}, message: string}|{status: "analyst_access_unverified", accessStatus: "unverified"|"denied", analyst: {adapterId: string, modelId: string, displayName: string}, reason: string|null, message: string}>}
 */
export async function analyzeProjectTeam({
  cwd,
  analyst: requestedAnalyst = null,
  createConversationService: createService = createConversationService
} = {}) {
  const projectCwd = requireCwd(cwd);
  const service = createService({ enableProviderProbes: true });
  const preflight = await service.preflightProject({ cwd: projectCwd });
  let analyst;
  if (requestedAnalyst) {
    const resolved = resolveRequestedAnalyst(requestedAnalyst, preflight.analystCatalog);
    if (!resolved) throw requestedAnalystError(requestedAnalyst);
    const { needsAccessCheck, accessCheckConfirmed, ...resolvedAnalyst } = resolved;
    analyst = resolvedAnalyst;
    if (needsAccessCheck && !accessCheckConfirmed) {
      // The probe calls the provider and may consume account: it only runs
      // after the human's explicit second confirmation. Nothing ran.
      return accessConfirmationRequiredResult(analyst.model);
    }
    if (needsAccessCheck) {
      // T20: unknown access is revalidated on selection, BEFORE any provider
      // analysis or strategy write. Fail-closed: a missing check, a throw,
      // a denial or an undecidable result all stop here with the real reason.
      let check;
      try {
        check = typeof service.verifyAnalystAccess === "function"
          ? await service.verifyAnalystAccess({ cwd: projectCwd, model: analyst.model })
          : { status: "unverified", reason: "no on-demand access check is available for this analyst" };
      } catch (error) {
        check = { status: "unverified", reason: error?.message ?? String(error) };
      }
      if (check?.status !== "allowed" && check?.status !== "not_applicable") {
        return accessUnverifiedResult(analyst.model, check ?? { status: "unverified", reason: null });
      }
    }
  } else {
    analyst = pickDefaultAnalyst(preflight.analystCatalog);
    if (!analyst) {
      const anyAvailable = (preflight.analystCatalog?.models ?? []).some(isPickerSelectable);
      if (!anyAvailable) throw noAnalystError(preflight.analystCatalog);
      // Usable models exist but none qualifies as a recommendation: never
      // pick one silently. No provider call, no strategy mutation.
      return { status: "analyst_selection_required", message: ANALYST_SELECTION_REQUIRED_MESSAGE };
    }
  }
  const strategy = await service.runBootstrapAnalysis({
    cwd: projectCwd,
    profile: preflight.profile,
    candidates: preflight.candidates,
    analyst
  });
  const summary = summarizeProjectStrategy(strategy);
  if (!summary) {
    throw new Error("Project analysis returned no strategy — nothing was suggested.");
  }
  return { ...summary, notice: preflight.unverifiedClaudeNotice ?? null };
}

/**
 * Approve the suggested strategy: SUGGESTED -> ACTIVE. Throws the
 * service's own error when there is nothing to approve.
 *
 * @param {{cwd?: string, createConversationService?: typeof createConversationService}} args
 * @returns {Promise<{state: string, teamRows: number, roles: string[], analyst: string|null, projectRoot: string|null}>}
 */
export async function approveProjectTeam({
  cwd,
  createConversationService: createService = createConversationService
} = {}) {
  const projectCwd = requireCwd(cwd);
  const service = createService({ enableProviderProbes: true });
  const approved = await service.approveProjectStrategy({ cwd: projectCwd });
  const summary = summarizeProjectStrategy(approved);
  if (!summary) {
    throw new Error("Approval returned no strategy — the project team was not activated.");
  }
  return summary;
}
