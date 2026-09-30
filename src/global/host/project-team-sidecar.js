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

import { createConversationService } from "../conversation/service.js";

/** After dedupe by displayName, keep at most this many picker rows. */
const ANALYST_PICKER_CAP = 16;

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

/**
 * Minimum evidence confidence for the recommended star. The star is a claim
 * ("Kairo recommends this one"), so it needs real evidence behind it; the
 * row itself stays selectable either way.
 */
export const MIN_RECOMMENDATION_CONFIDENCE = 0.5;

function numericOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Numeric analyst fit (0..1, from computeBootstrapAnalystCatalog).
 * Entries without one (legacy records) count as 0: no evidence, no rank.
 * Tags are informational and never part of the ordering.
 * @param {object} model
 */
function analystFitRank(model) {
  return numericOr(model.fit, 0);
}

/**
 * Curate the full analyst catalog for the ratatui picker:
 * - available only (availability gates usability, nothing else)
 * - scored AND unscored models are kept; unscored carry fit 0 and lower confidence
 * - order: fit desc, then confidence desc, then display name
 * - dedupe by displayName (best fit wins); single global cap
 *
 * Never invents models; never reintroduces unavailable adapters.
 * `recommendedModel` survives only when its candidateKey remains in `models`
 * AND its confidence reaches MIN_RECOMMENDATION_CONFIDENCE (entries with no
 * confidence field are legacy and keep the star).
 *
 * @param {{recommendedModel?: object|null, models?: object[]}|null|undefined} analystCatalog
 * @returns {{recommendedModel: object|null, models: object[]}}
 */
export function curateAnalystCatalogForPicker(analystCatalog) {
  const incoming = Array.isArray(analystCatalog?.models) ? analystCatalog.models : [];
  const available = incoming.filter((model) => model?.available === true);

  const ordered = [...available].sort((a, b) => {
    const byFit = analystFitRank(b) - analystFitRank(a);
    if (byFit !== 0) return byFit;
    const byConfidence = numericOr(b.confidence, 0) - numericOr(a.confidence, 0);
    if (byConfidence !== 0) return byConfidence;
    const nameA = String(a.displayName ?? a.modelId ?? "");
    const nameB = String(b.displayName ?? b.modelId ?? "");
    return nameA.localeCompare(nameB);
  });

  const seenNames = new Set();
  const models = [];
  for (const model of ordered) {
    const nameKey = String(model.displayName ?? model.modelId ?? model.candidateKey ?? "")
      .trim()
      .toLowerCase();
    if (!nameKey || seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);
    models.push(model);
    if (models.length >= ANALYST_PICKER_CAP) break;
  }

  const incomingRecommended = analystCatalog?.recommendedModel ?? null;
  const survivor = incomingRecommended
    ? models.find((model) => model.candidateKey === incomingRecommended.candidateKey)
    : null;
  const confidence = survivor ? (survivor.confidence ?? incomingRecommended.confidence) : null;
  const sufficient = confidence == null || numericOr(confidence, 0) >= MIN_RECOMMENDATION_CONFIDENCE;
  const recommendedModel = survivor && sufficient ? incomingRecommended : null;
  return { recommendedModel, models };
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
  const curatedAdapters = new Set(
    (Array.isArray(curatedCatalog?.models) ? curatedCatalog.models : []).map((m) => m?.adapterId).filter(Boolean)
  );
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
 * The default Bootstrap Analyst: the catalog's own recommended model when
 * it is currently available, otherwise the first available catalog entry
 * (catalog order — the same real ranking the cockpit picker shows). An
 * unavailable-only catalog returns null: an analyst that cannot run is not
 * a default, and the caller fails closed.
 *
 * @param {{recommendedModel?: {candidateKey?: string}|null, models?: object[]}|null|undefined} analystCatalog
 * @returns {{model: {adapterId: string, modelId: string, displayName: string}, selectionSource: "recommended"|"manual", recommendationTags: string[], choice: "quality"|"efficient"|null}|null}
 */
export function pickDefaultAnalyst(analystCatalog) {
  const models = analystCatalog?.models ?? [];
  const recommendedKey = analystCatalog?.recommendedModel?.candidateKey ?? null;
  const available = models.filter((model) => model?.available === true);
  const picked =
    available.find((model) => model.candidateKey === recommendedKey) ?? available[0] ?? null;
  if (!picked) return null;
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
    selectionSource: picked.candidateKey === recommendedKey ? "recommended" : "manual",
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
  if (!match || match.available !== true) return null;
  const recommendedKey = analystCatalog?.recommendedModel?.candidateKey ?? null;
  const recommendationTags = match.recommendationTags ?? [];
  return {
    model: { adapterId: match.adapterId, modelId: match.modelId, displayName: match.displayName },
    selectionSource: match.candidateKey === recommendedKey ? "recommended" : "manual",
    recommendationTags,
    choice: recommendationTags.includes("quality")
      ? "quality"
      : recommendationTags.includes("efficient")
        ? "efficient"
        : null
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
 * @returns {Promise<{analystCatalog: object, profile: object|null, candidates: object|null, projectRoot: string|null, unverifiedClaudeNotice: string|null, pickerNotice: string|null, exclusionCauses: Array<{adapterId: string, provider: string, cause: string, models: number, reason: string|null}>}>}
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
 * default (`pickDefaultAnalyst`), same as before this option existed.
 *
 * @param {{cwd?: string, analyst?: object|null, createConversationService?: typeof createConversationService}} args
 * @returns {Promise<{state: string, teamRows: number, roles: string[], analyst: string|null, projectRoot: string|null, notice: string|null}>}
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
    analyst = resolveRequestedAnalyst(requestedAnalyst, preflight.analystCatalog);
    if (!analyst) throw requestedAnalystError(requestedAnalyst);
  } else {
    analyst = pickDefaultAnalyst(preflight.analystCatalog);
    if (!analyst) throw noAnalystError(preflight.analystCatalog);
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
