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
  MAIN_VIEW_LIMIT, compareAnalystRows, recommendationQualifies
} from "../conversation/analyst-qualification.js";
import { computeProjectProfile } from "../conversation/project-profile.js";
import { createConversationService } from "../conversation/service.js";
import { redactText } from "../runtime/run-redact.js";

/**
 * One in-flight team operation per kind and project. The sidecar is driven by concurrent RPC
 * messages, so a double-submitted confirmation must not run provider checks (quota) twice, and an
 * approval must not land while an analysis is still deciding what the suggested team is.
 */
const inFlightOps = new Map();

async function exclusive(kind, cwd, busy, fn) {
  const key = `${kind}:${cwd}`;
  if (inFlightOps.has(key)) return busy();
  inFlightOps.set(key, true);
  try {
    return await fn();
  } finally {
    inFlightOps.delete(key);
  }
}

/** Provider and CLI errors can embed tokens or Authorization headers: scrub every string we hand to the host. */
function redactDeep(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item)]));
  }
  return value;
}

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

export { MAIN_VIEW_LIMIT };

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

function subscriptionOf(model) {
  return providerPickerLabel(model.adapterId);
}

const labelOf = (model) => `${model.displayName ?? model.modelId} · ${subscriptionOf(model)}`;

/**
 * Picker rows are a flat, actionable list: model · subscription only.
 * No aptitude / benchmark prose under each row — that copy never helped pick.
 * Benchmark notes stay out of the primary list (exclusions live behind `d`).
 */
function decorate(model) {
  return {
    ...model,
    recommendationTags: [],
    listing: "main",
    subscription: subscriptionOf(model),
    label: labelOf(model),
    explanation: null,
    detail: null
  };
}

const PROJECT_RISK_WORDS = Object.freeze({
  "no-test-command": "sin script de test",
  "no-static-checks": "sin lint ni typecheck",
  "env-file-present": ".env presente"
});

/**
 * Compact, serializable project context for the picker, from the local
 * ProjectProfile (computeProjectProfile: read-only scan, no provider call).
 * Contextual line only; it never influences picker order or team ranking.
 * @param {object|null|undefined} profile
 * @returns {{name: string|null, stack: string[], architecture: string|null, risks: string[], confidence: string|null, line: string}|null}
 */
export function summarizeProjectContext(profile) {
  if (!profile || typeof profile !== "object") return null;
  const stack = (Array.isArray(profile.stack) ? profile.stack : []).filter((entry) => typeof entry === "string" && entry && entry !== "Unknown");
  const architecture = typeof profile.architecture?.pattern === "string" && profile.architecture.pattern ? profile.architecture.pattern : null;
  const risks = (Array.isArray(profile.risks) ? profile.risks : []).map((risk) => PROJECT_RISK_WORDS[risk?.kind] ?? null).filter(Boolean);
  const name = typeof profile.projectName === "string" && profile.projectName ? profile.projectName : null;
  const segments = [
    name ? `Proyecto ${name}` : "Proyecto",
    stack.length ? stack.join(", ") : null,
    architecture ? `arquitectura ${architecture}` : null,
    risks.length ? `riesgos: ${risks.join(", ")}` : null
  ].filter(Boolean);
  if (segments.length <= 1 && !stack.length && !architecture && !risks.length) return null;
  return { name, stack, architecture, risks, confidence: profile.confidence ?? null, line: segments.join(" · ") };
}

/**
 * Flat picker catalog: every model that is safe to select and run for analysis
 * right now (`available` + verified access). Credit-gated / denied models
 * (e.g. Fable with `credits_required`) and unverified access never appear —
 * they stay in exclusions / verification, not in the list. A subscription
 * with zero usable models (e.g. Cursor with no available pool) simply
 * contributes no rows; Cursor's own live inventory remains `cursor-agent
 * models` when the human needs it outside this picker.
 *
 * - `models`: the full usable list (no artificial top-N).
 * - `alternatives`: always `[]` (no Other view).
 * - `recommendedModel`: always `null` (no star; the human chooses).
 *
 * Unverified, denied, exhausted and unavailable candidates stay out of the
 * list; `buildAnalystExclusionCauses` still reports them for `d`.
 * Does not change the shared evaluator used later to form the project team.
 *
 * @param {{recommendedModel?: object|null, models?: object[]}|null|undefined} analystCatalog
 * @param {{projectContext?: object|null}} [options]
 * @returns {{recommendedModel: null, models: object[], alternatives: []}}
 */
export function curateAnalystCatalogForPicker(analystCatalog, { projectContext: _projectContext = null } = {}) {
  const incoming = Array.isArray(analystCatalog?.models) ? analystCatalog.models : [];
  const seen = new Set();
  const usable = [];
  for (const model of incoming) {
    // Only actionable analysts: verified access and available now. Denied /
    // credits / exhausted / unverified are never listed as selectable.
    if (model?.available !== true || model?.accessVerified === false) continue;
    if (model?.cause === "unavailable_verified" || model?.cause === "policy_excluded") continue;
    const key = model.candidateKey ?? `${model.adapterId}::${model.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    usable.push(model);
  }
  usable.sort(compareAnalystRows);
  return {
    recommendedModel: null,
    models: usable.map(decorate),
    alternatives: []
  };
}

// Verifiable cause -> concise Spanish picker copy. Only causes backed by real
// evidence; never funds/credits/billing. Consumers must not always say
// "cuota agotada" — reserve / rate-limit / exhausted are distinct.
const CAUSE_ORDER = [
  "quota_reserve", "rate_limited", "quota_exhausted",
  "unavailable_verified", "policy_excluded", "access_unknown", "unscored"
];
const CAUSE_COPY = Object.freeze({
  quota_reserve: "reserva baja",
  rate_limited: "ventana limitada",
  quota_exhausted: "cuota agotada",
  unavailable_verified: "no disponible",
  policy_excluded: "excluido por política",
  access_unknown: "sin verificar",
  unscored: "sin benchmark"
});

const REASON_COPY = Object.freeze({ stale: "evidencia vencida" });

/**
 * Concise Spanish "what" for an exclusion cause. For `quota_reserve`, embeds
 * remaining percent from `reason` when present (`reserva baja (N%)`).
 * Timeout on `access_unknown` stays "sin verificar" (never "cuota agotada").
 *
 * @param {string} cause
 * @param {string|null|undefined} reason
 * @returns {string}
 */
export function formatExclusionWhat(cause, reason = null) {
  const base = CAUSE_COPY[cause] ?? `excluido (${cause})`;
  if (cause === "quota_reserve") {
    const match = String(reason ?? "").match(/(\d+)%/);
    return match ? `reserva baja (${match[1]}%)` : base;
  }
  return base;
}

/**
 * Subject label for one exclusion row: prefer the model display name, then
 * modelId, then the provider. Never prefer the provider when a model identity
 * is known — that is how a Fable denial used to read as "Claude: no disponible".
 *
 * @param {{displayName?: string|null, modelId?: string|null, provider?: string|null}|null|undefined} row
 * @returns {string}
 */
export function exclusionSubject(row) {
  const name = row?.displayName == null || row.displayName === "" ? null : String(row.displayName);
  const modelId = row?.modelId == null || row.modelId === "" ? null : String(row.modelId);
  const provider = row?.provider == null || row.provider === "" ? null : String(row.provider);
  return name ?? modelId ?? provider ?? "unknown";
}

/**
 * One picker detail line: `Subject: what` or `Subject: what — compactReason`
 * only when the reason adds information beyond `what`. `subject` is the
 * model display name when known (e.g. "Claude Fable 5.1"); fall back to the
 * provider label only when there is no per-model subject — never label a
 * single-model denial as if the whole provider were unavailable.
 *
 * @param {string} subject
 * @param {string} cause
 * @param {string|null|undefined} reason
 * @returns {string}
 */
export function formatExclusionLine(subject, cause, reason = null) {
  const what = formatExclusionWhat(cause, reason);
  const label = subject == null || subject === "" ? "unknown" : String(subject);
  const raw = reason == null || reason === "" ? null : String(reason);
  if (!raw) return `${label}: ${what}`;
  if (cause === "quota_reserve" && /\(\d+%\)/.test(what)) return `${label}: ${what}`;
  if (cause === "rate_limited") return `${label}: ${what}`;
  if (cause === "access_unknown" && /timeout|timed\s*out/i.test(raw)) return `${label}: ${what}`;
  const compact = REASON_COPY[raw] ?? raw;
  if (compact === what) return `${label}: ${what}`;
  return `${label}: ${what} — ${compact}`;
}

/**
 * Machine-readable, per-model exclusion causes for every candidate that is
 * in NEITHER picker view (T23): unverified access, verified-denied,
 * exhausted quota, provider unavailable, policy. One row per excluded
 * model — never rolled up to the provider — so a Fable denial cannot read
 * as "Claude: no disponible" while other Claude models remain listed.
 * Sources are real evidence only: per-model `cause` / `accessVerified` on
 * catalog models and `rawCatalog.exclusions` (denied models absent from
 * `models` by design). Never an invented cause.
 *
 * @param {{models?: object[], exclusions?: object[]}|null|undefined} rawCatalog
 * @param {{models?: object[], alternatives?: object[]}|null|undefined} curatedCatalog
 * @param {string|null|undefined} unverifiedClaudeNotice
 * @returns {Array<{adapterId: string, provider: string, modelId: string|null, displayName: string|null, candidateKey: string, cause: string, models: number, reason: string|null}>}
 */
export function buildAnalystExclusionCauses(rawCatalog, curatedCatalog, unverifiedClaudeNotice = null) {
  const curatedRows = [
    ...(Array.isArray(curatedCatalog?.models) ? curatedCatalog.models : []),
    ...(Array.isArray(curatedCatalog?.alternatives) ? curatedCatalog.alternatives : [])
  ];
  const curatedKeys = new Set(curatedRows.map((m) => m?.candidateKey ?? `${m?.adapterId}::${m?.modelId}`));
  const curatedAdapters = new Set(curatedRows.map((m) => m?.adapterId).filter(Boolean));
  const rows = new Map();
  const add = ({ adapterId, cause, candidateKey, modelId = null, displayName = null, reason = null }) => {
    if (!adapterId || !CAUSE_COPY[cause]) return;
    const key = candidateKey ?? `${adapterId}::${modelId ?? rows.size}`;
    if (rows.has(key)) return;
    rows.set(key, {
      adapterId,
      provider: providerPickerLabel(adapterId),
      modelId: modelId == null ? null : String(modelId),
      displayName: displayName == null || displayName === "" ? null : String(displayName),
      candidateKey: key,
      cause,
      models: 1,
      reason: reason == null ? null : (REASON_COPY[reason] ?? reason)
    });
  };
  for (const model of Array.isArray(rawCatalog?.models) ? rawCatalog.models : []) {
    const candidateKey = model?.candidateKey ?? `${model?.adapterId}::${model?.modelId}`;
    if (curatedKeys.has(candidateKey)) continue;
    // A provider-level cause (quota, unavailable, policy) wins over unknown
    // access: the model is out because of the provider, not just unverified.
    const providerCause = model?.cause && model.cause !== "access_unknown" && model.cause !== "unscored" ? model.cause : null;
    const base = {
      adapterId: model?.adapterId,
      candidateKey,
      modelId: model?.modelId ?? null,
      displayName: model?.displayName ?? model?.modelName ?? null
    };
    if (model?.available !== true) {
      if (providerCause) {
        add({ ...base, cause: providerCause, reason: model?.causeReason ?? model?.entitlementReason ?? null });
      } else if (isAccessUnverified(model) || model?.cause === "access_unknown") {
        add({ ...base, cause: "access_unknown", reason: model?.entitlementReason ?? null });
      } else {
        add({ ...base, cause: "unavailable_verified" });
      }
    }
  }
  for (const exclusion of Array.isArray(rawCatalog?.exclusions) ? rawCatalog.exclusions : []) {
    add({
      adapterId: exclusion?.adapterId,
      cause: exclusion?.cause,
      candidateKey: exclusion?.candidateKey,
      modelId: exclusion?.modelId ?? null,
      displayName: exclusion?.displayName ?? exclusion?.modelId ?? null,
      reason: exclusion?.reason ?? null
    });
  }
  if (
    unverifiedClaudeNotice
    && !curatedAdapters.has("claude")
    && ![...rows.values()].some((r) => r.adapterId === "claude" && r.cause === "access_unknown")
  ) {
    add({
      adapterId: "claude",
      cause: "access_unknown",
      candidateKey: "claude::notice",
      modelId: null,
      displayName: null,
      reason: String(unverifiedClaudeNotice)
    });
  }
  return [...rows.values()]
    .sort((a, b) => (
      a.provider.localeCompare(b.provider)
      || CAUSE_ORDER.indexOf(a.cause) - CAUSE_ORDER.indexOf(b.cause)
      || String(a.displayName ?? a.modelId ?? "").localeCompare(String(b.displayName ?? b.modelId ?? ""))
    ));
}

/**
 * Subscription-level rollup of per-model `access_unknown` exclusion rows —
 * kept additive for verification-plan UI that still thinks in subscriptions.
 * @param {Array<{adapterId: string, provider: string, cause: string, models?: number, reason: string|null}>} exclusionCauses
 * @returns {Array<{adapterId: string, provider: string, models: number, reason: string|null}>}
 */
export function aggregateUnverifiedSubscriptions(exclusionCauses) {
  const byAdapter = new Map();
  for (const row of Array.isArray(exclusionCauses) ? exclusionCauses : []) {
    if (row?.cause !== "access_unknown" || !row.adapterId) continue;
    const existing = byAdapter.get(row.adapterId) ?? {
      adapterId: row.adapterId,
      provider: row.provider,
      models: 0,
      reason: null
    };
    existing.models += typeof row.models === "number" ? row.models : 1;
    existing.reason = existing.reason ?? row.reason ?? null;
    byAdapter.set(row.adapterId, existing);
  }
  return [...byAdapter.values()];
}

/**
 * Compact picker notice (T25): at most one partial-comparison acknowledgement.
 * Per-provider exclusion causes stay in `exclusionCauses` for `d`, never dumped
 * into the list footer. Never invents billing / out-of-funds causes.
 *
 * @param {{models?: object[], exclusions?: object[]}|null|undefined} rawCatalog
 * @param {{models?: object[], alternatives?: object[]}|null|undefined} curatedCatalog
 * @param {string|null|undefined} unverifiedClaudeNotice
 * @returns {string|null}
 */
export function buildAnalystPickerNotice(rawCatalog, curatedCatalog, unverifiedClaudeNotice = null) {
  const causes = buildAnalystExclusionCauses(rawCatalog, curatedCatalog, unverifiedClaudeNotice);
  if (causes.length === 0) return null;
  const hasPartial = causes.some((row) => row.cause === "access_unknown");
  if (hasPartial) return "Comparación parcial — d = detalles";
  return "Algunas suscripciones no aportan opciones — d = detalles";
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
  const blockedRoles = team
    .filter((entry) => !entry?.model || entry?.assignmentState === "blocked")
    .map((entry) => entry?.role)
    .filter(Boolean);
  // Operational projectTeam roles only — Analyst is separate (bootstrapAnalyst).
  const readyToApprove = strategy.status === "suggested"
    && team.length > 0
    && blockedRoles.length === 0
    && Boolean(strategy.orchestrator?.adapterId && (strategy.orchestrator?.modelId || strategy.orchestrator?.displayName));
  return {
    state: strategy.status ?? "unknown",
    teamRows: team.length,
    roles: team.map((entry) => entry?.role).filter(Boolean),
    analyst: modelLabel(strategy.bootstrapAnalyst),
    projectRoot: strategy.projectRoot ?? null,
    readyToApprove,
    blockedRoles
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
  const reason = check.reason == null ? null : redactText(String(check.reason));
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
 * @returns {Promise<{analystCatalog: {recommendedModel: object|null, models: object[], alternatives: object[]}, profile: object|null, projectContext: {name: string|null, stack: string[], architecture: string|null, risks: string[], confidence: string|null, line: string}|null, candidates: object|null, projectRoot: string|null, unverifiedClaudeNotice: string|null, pickerNotice: string|null, exclusionCauses: Array<{adapterId: string, provider: string, cause: string, models: number, reason: string|null}>}>}
 */
export async function preflightProjectTeam({
  cwd,
  createConversationService: createService = createConversationService,
  computeProfile = computeProjectProfile
} = {}) {
  const projectCwd = requireCwd(cwd);
  const service = createService({ enableProviderProbes: true });
  // The local project scan (read-only, no provider call) runs in parallel with
  // the catalog snapshot so the picker can contextualize its explanations. A
  // scan failure never blocks the picker: the context is just absent.
  const [preflight, localProfile] = await Promise.all([
    service.preflightProject({ cwd: projectCwd, mode: "catalog" }),
    Promise.resolve().then(() => computeProfile({ cwd: projectCwd })).catch(() => null)
  ]);
  const projectContext = summarizeProjectContext(localProfile);
  const rawCatalog = preflight.analystCatalog ?? { recommendedModel: null, models: [] };
  const analystCatalog = curateAnalystCatalogForPicker(rawCatalog, { projectContext });
  const unverifiedClaudeNotice = preflight.unverifiedClaudeNotice ?? null;
  const exclusionCauses = buildAnalystExclusionCauses(rawCatalog, analystCatalog, unverifiedClaudeNotice);
  return {
    analystCatalog,
    profile: toSerializable(preflight.profile),
    // Additive (T24): local project context (stack, architecture, risks) for the
    // picker's explanation text. Never part of the ranking.
    projectContext,
    candidates: toSerializable(preflight.candidates),
    projectRoot: preflight.projectRoot ?? null,
    unverifiedClaudeNotice,
    pickerNotice: buildAnalystPickerNotice(rawCatalog, analystCatalog, unverifiedClaudeNotice),
    // Additive (T10/T11): machine-readable per-model cause rows behind `pickerNotice`.
    exclusionCauses,
    // Additive (T23): subscriptions whose access could not be verified — rolled
    // up from per-model access_unknown rows so verification-plan UI still
    // thinks in subscriptions. The picker must say so; a partial comparison is
    // never presented as complete.
    unverifiedSubscriptions: aggregateUnverifiedSubscriptions(exclusionCauses),
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
 * `onProgress` (additive) relays the service's progress events
 * (`{completed, total, active, done}`) while the checks run.
 *
 * @param {{cwd?: string, confirmed?: boolean, onProgress?: (event: object) => void, createConversationService?: typeof createConversationService}} args
 * @returns {Promise<{ran: boolean, status: "confirmation_required"|"verified"|"failed"|"unavailable", message?: string, persisted?: boolean, outcomes: object[]}>}
 */
export async function verifyProjectTeamAccess({
  cwd,
  confirmed,
  onProgress = null,
  createConversationService: createService = createConversationService
} = {}) {
  const projectCwd = requireCwd(cwd);
  if (confirmed !== true) {
    return {
      ran: false, status: "confirmation_required", outcomes: [],
      message: "Access verification calls the providers and may consume quota — it only runs after explicit confirmation. Nothing was run."
    };
  }
  return exclusive(
    "verify",
    projectCwd,
    () => ({
      ran: false, status: "failed", outcomes: [],
      message: "An access verification is already running for this project — wait for it to finish. Nothing was run."
    }),
    async () => {
      try {
        const service = createService({ enableProviderProbes: true });
        if (typeof service.verifyAccess !== "function") {
          return { ran: false, status: "unavailable", outcomes: [], message: "This build has no access verification entry point." };
        }
        const result = await service.verifyAccess({
          cwd: projectCwd, confirmed: true, ...(typeof onProgress === "function" ? { onProgress } : {})
        });
        const serializable = toSerializable(result);
        return serializable == null
          ? { ran: false, status: "failed", outcomes: [], message: "Verification returned no result." }
          : redactDeep(serializable);
      } catch (error) {
        return { ran: false, status: "failed", outcomes: [], message: redactText(`Access verification failed: ${error?.message ?? String(error)}`) };
      }
    }
  );
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
 * @param {{cwd?: string, analyst?: object|null, onProgress?: (event: {stage: string, analyst: string|null, startedAt: number, elapsedMs: number}) => void, createConversationService?: typeof createConversationService}} args
 * @returns {Promise<{state: string, teamRows: number, roles: string[], analyst: string|null, projectRoot: string|null, notice: string|null, readyToApprove?: boolean, blockedRoles?: string[]}|{status: "analyst_selection_required", message: string}|{status: "analyst_access_confirmation_required", analyst: {adapterId: string, modelId: string, displayName: string}, message: string}|{status: "analyst_access_unverified", accessStatus: "unverified"|"denied", analyst: {adapterId: string, modelId: string, displayName: string}, reason: string|null, message: string}>}
 */
export async function analyzeProjectTeam({
  cwd,
  analyst: requestedAnalyst = null,
  onProgress = null,
  createConversationService: createService = createConversationService
} = {}) {
  const projectCwd = requireCwd(cwd);
  return exclusive(
    "analyze",
    projectCwd,
    () => {
      throw new Error("A project analysis is already running for this project — wait for it to finish, then try again.");
    },
    async () => {
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
        analyst,
        ...(typeof onProgress === "function" ? { onProgress } : {})
      });
      const summary = summarizeProjectStrategy(strategy);
      if (!summary) {
        throw new Error("Project analysis returned no strategy — nothing was suggested.");
      }
      return { ...summary, notice: preflight.unverifiedClaudeNotice ?? null };
    }
  );
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
  if (inFlightOps.has(`analyze:${projectCwd}`)) {
    throw new Error("A project analysis is still running for this project — wait for it to finish before approving, so the team you approve is the one it suggests.");
  }
  return exclusive(
    "approve",
    projectCwd,
    () => {
      throw new Error("An approval is already in progress for this project.");
    },
    async () => {
      const service = createService({ enableProviderProbes: true });
      const approved = await service.approveProjectStrategy({ cwd: projectCwd });
      if (approved?.ok === false) {
        return approved;
      }
      const summary = summarizeProjectStrategy(approved);
      if (!summary) {
        throw new Error("Approval returned no strategy — the project team was not activated.");
      }
      return summary;
    }
  );
}
