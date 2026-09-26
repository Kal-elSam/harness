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
 * Analyze this project's team headlessly with the default analyst.
 * Persists a SUGGESTED ProjectStrategy (the service does) — never active:
 * activation stays an explicit human act (`approveProjectTeam`).
 *
 * @param {{cwd?: string, createConversationService?: typeof createConversationService}} args
 * @returns {Promise<{state: string, teamRows: number, roles: string[], analyst: string|null, projectRoot: string|null, notice: string|null}>}
 */
export async function analyzeProjectTeam({
  cwd,
  createConversationService: createService = createConversationService
} = {}) {
  const projectCwd = requireCwd(cwd);
  const service = createService({ enableProviderProbes: true });
  const preflight = await service.preflightProject({ cwd: projectCwd });
  const analyst = pickDefaultAnalyst(preflight.analystCatalog);
  if (!analyst) throw noAnalystError(preflight.analystCatalog);
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
