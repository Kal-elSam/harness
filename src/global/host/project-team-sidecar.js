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

import { MIN_RECOMMENDATION_CONFIDENCE, qualifiesForMainView, recommendationQualifies } from "../conversation/analyst-qualification.js";
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

function numericOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Known (measured) fit sorts before unknown fit; both compare high to low. */
function compareFit(a, b) {
  const fitA = typeof a.fit === "number" && Number.isFinite(a.fit) ? a.fit : null;
  const fitB = typeof b.fit === "number" && Number.isFinite(b.fit) ? b.fit : null;
  if (fitA === null || fitB === null) return Number(fitA === null) - Number(fitB === null);
  return fitB - fitA;
}

/** Access is explicitly UNVERIFIED (catalog `accessVerified: false`); absent field = verified/legacy. */
function isAccessUnverified(model) {
  return model?.accessVerified === false;
}

/** Usable now (`available`) or selectable with revalidation (`selectable`, unverified access). */
function isPickerSelectable(model) {
  return model?.available === true || model?.selectable === true;
}

function compareRows(a, b) {
  const byFit = compareFit(a, b);
  if (byFit !== 0) return byFit;
  const byConfidence = numericOr(b.confidence, 0) - numericOr(a.confidence, 0);
  if (byConfidence !== 0) return byConfidence;
  const nameA = String(a.displayName ?? a.modelId ?? "");
  const nameB = String(b.displayName ?? b.modelId ?? "");
  return nameA.localeCompare(nameB);
}

const score = (value) => (typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "?");

/** One short Spanish line per row, from the row's own real evidence only. */
function explainRow(model, listing) {
  if (listing === "main") {
    return `razonamiento ${score(model.evidence?.reasoning)} · código ${score(model.evidence?.coding)} · confianza ${score(model.confidence)}`;
  }
  const reasons = [];
  if (isAccessUnverified(model)) reasons.push("acceso sin verificar");
  const { reasoning, coding } = model.evidence ?? {};
  if (model.evidenceStatus === "unscored") reasons.push("sin benchmark");
  else if (typeof reasoning !== "number" || typeof coding !== "number") reasons.push("benchmark incompleto");
  return `${reasons.join(" · ") || "selección manual"} · solo manual`;
}

/**
 * Curate the full analyst catalog for the ratatui picker into two explicit
 * views. Identity is the candidateKey (adapterId + modelId), never the
 * display name: the same model through two subscriptions keeps both rows,
 * and there is no row cap (the modal scrolls).
 *
 * - `models` (MAIN view): only candidates that pass `qualifiesForMainView`
 *   (available, access verified, reasoning AND coding evidence, confidence
 *   >= MIN_RECOMMENDATION_CONFIDENCE). No extra fit threshold. Sorted by fit
 *   (unknown fit last), then confidence, then name.
 * - `alternatives` (MANUAL view): every other still-selectable candidate —
 *   no (or partial) benchmark, unknown access, or both. Never starred, never
 *   tagged, never auto-selected; confirming an unknown-access row revalidates
 *   it behind an explicit second confirmation (see `analyzeProjectTeam`).
 *   Exhausted / denied / unavailable candidates are in neither view.
 *
 * `recommendedModel` survives only when its candidateKey is in the MAIN list
 * and its confidence reaches MIN_RECOMMENDATION_CONFIDENCE.
 * Each row gains additive `listing` ("main"|"manual") and a short
 * `explanation`. Never invents models.
 *
 * @param {{recommendedModel?: object|null, models?: object[]}|null|undefined} analystCatalog
 * @returns {{recommendedModel: object|null, models: object[], alternatives: object[]}}
 */
export function curateAnalystCatalogForPicker(analystCatalog) {
  const incoming = Array.isArray(analystCatalog?.models) ? analystCatalog.models : [];
  const seen = new Set();
  const main = [];
  const manual = [];
  for (const model of incoming) {
    if (!isPickerSelectable(model)) continue;
    const key = model.candidateKey ?? `${model.adapterId}::${model.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (qualifiesForMainView(model)) main.push({ ...model, listing: "main", explanation: explainRow(model, "main") });
    else manual.push({ ...model, recommendationTags: [], listing: "manual", explanation: explainRow(model, "manual") });
  }
  const models = main.sort(compareRows);
  const alternatives = manual.sort(compareRows);

  const incomingRecommended = analystCatalog?.recommendedModel ?? null;
  const survivor = incomingRecommended
    ? models.find((model) => model.candidateKey === incomingRecommended.candidateKey)
    : null;
  const recommendedModel = survivor && recommendationQualifies(survivor, incomingRecommended)
    ? incomingRecommended
    : null;
  return { recommendedModel, models, alternatives };
}

// Verifiable cause -> Spanish picker copy. Only causes backed by real
// evidence; never funds/credits/billing. `unscored` and `access_unknown`
// are deliberately NOT worded as unavailability.
const CAUSE_ORDER = ["quota_exhausted", "unavailable_verified", "policy_excluded", "access_unknown", "unscored"];
const CAUSE_COPY = Object.freeze({
  quota_exhausted: "cuota agotada",
  unavailable_verified: "no disponible para análisis ahora",
  policy_excluded: "excluido por política",
  access_unknown: "acceso sin verificar",
  unscored: "sin benchmark (solo selección manual)"
});

/**
 * Machine-readable, per-provider exclusion causes for providers that
 * contributed ZERO usable picker rows (the same set the notice names).
 * One row per (provider, cause): `{adapterId, provider, cause, models, reason}`.
 * Sources, all real evidence only: per-model `cause` on unavailable/unscored
 * raw models, `rawCatalog.exclusions` (blocked-entitlement models that are
 * absent from `models` by design), and the Claude unverified-access notice.
 * A provider absent from the curated list for a reason with no evidence
 * (e.g. deduped by display name) gets no row — never an invented cause.
 *
 * @param {{models?: object[], exclusions?: object[]}|null|undefined} rawCatalog
 * @param {{models?: object[]}|null|undefined} curatedCatalog
 * @param {string|null|undefined} unverifiedClaudeNotice
 * @returns {Array<{adapterId: string, provider: string, cause: string, models: number, reason: string|null}>}
 */
export function buildAnalystExclusionCauses(rawCatalog, curatedCatalog, unverifiedClaudeNotice = null) {
  // A provider "contributes" when it has a row in EITHER picker view.
  const curatedRows = [
    ...(Array.isArray(curatedCatalog?.models) ? curatedCatalog.models : []),
    ...(Array.isArray(curatedCatalog?.alternatives) ? curatedCatalog.alternatives : [])
  ];
  const curatedAdapters = new Set(curatedRows.map((m) => m?.adapterId).filter(Boolean));
  const rows = new Map();
  const add = (adapterId, cause, reason = null) => {
    if (!adapterId || !CAUSE_COPY[cause] || curatedAdapters.has(adapterId)) return;
    const key = `${adapterId}\u0000${cause}`;
    const row = rows.get(key) ?? { adapterId, provider: providerPickerLabel(adapterId), cause, models: 0, reason: null };
    row.models += 1;
    row.reason = row.reason ?? reason;
    rows.set(key, row);
  };
  for (const model of Array.isArray(rawCatalog?.models) ? rawCatalog.models : []) {
    if (model?.selectable === true && model?.available !== true) continue; // selectable (unverified access): not an exclusion
    if (model?.available !== true) add(model?.adapterId, model?.cause ?? "unavailable_verified");
    else if (model?.evidenceStatus === "unscored" && !(model.recommendationTags ?? []).length) add(model.adapterId, "unscored");
  }
  for (const exclusion of Array.isArray(rawCatalog?.exclusions) ? rawCatalog.exclusions : []) {
    add(exclusion?.adapterId, exclusion?.cause, exclusion?.reason ?? null);
  }
  if (unverifiedClaudeNotice && !curatedAdapters.has("claude") && ![...rows.values()].some((r) => r.adapterId === "claude" && r.cause === "access_unknown")) {
    add("claude", "access_unknown", String(unverifiedClaudeNotice));
  }
  return [...rows.values()].sort((a, b) =>
    a.provider.localeCompare(b.provider) || CAUSE_ORDER.indexOf(a.cause) - CAUSE_ORDER.indexOf(b.cause)
  );
}

/**
 * Compact honest notice when a known provider contributed zero usable
 * picker rows, stating the verifiable cause per provider (see
 * buildAnalystExclusionCauses). Never invents billing / out-of-funds /
 * credits causes, and never words unscored or unverified access as
 * unavailability.
 *
 * @param {{models?: object[], exclusions?: object[]}|null|undefined} rawCatalog
 * @param {{models?: object[]}|null|undefined} curatedCatalog
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
  return {
    analystCatalog,
    profile: toSerializable(preflight.profile),
    candidates: toSerializable(preflight.candidates),
    projectRoot: preflight.projectRoot ?? null,
    unverifiedClaudeNotice,
    pickerNotice: buildAnalystPickerNotice(rawCatalog, analystCatalog, unverifiedClaudeNotice),
    // Additive (T10/T11): machine-readable cause rows behind `pickerNotice`.
    exclusionCauses: buildAnalystExclusionCauses(rawCatalog, analystCatalog, unverifiedClaudeNotice)
  };
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
