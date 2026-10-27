import { readOutcomeRecords } from './launch-ledger.js';
import { buildManualAnalystCatalog } from './bootstrap-analyst-profile.js';
import { writeRoutingInputCache, readTaskAdmissionInputs, readRoutingLaunchLedger, readTeamRoute } from "./routing-input-cache.js";
import { createRoleAptitudeEvidenceStore } from "../intelligence/role-aptitude-evidence.js";
import { createProviderConnections } from "../provider-connections/service.js";
import { PROVIDER_IDS } from "../provider-connections/allowlist.js";
import { readCursorAccountIdentifier } from "../provider-connections/readers.js";
import { isDeepStrictEqual } from "node:util";
import { createArchitecturePlan } from "../architect/architect-manager.js";
import {
  listTaskRecords, readExecutionLink, readTaskRecord, resolveProjectRoot, transitionTask,
  updateExecutionLink, verifyPlanForExecution, writeExecutionLink
} from "../architect/architect-store.js";
import { PLAN_STATES } from "../architect/architect-types.js";
import { composeTaskResult } from "./task-result.js";
import { associateResultWithGentleReview } from "../control-plane/review-association.js";
import { createGentleReader } from "./gentle-reader.js";
import {
  EXTERNAL_TRANSITION_KINDS, TRANSITION_KINDS, deriveNextTransition, fileTransitionStore
} from "./transition-store.js";
import { normalizeRunResult } from "../kernel/run-result-normalizer.js";
import { resolveHomeDir } from "../paths.js";
import { resolveActiveHost, hostAllowsProvider } from "../hosts/active-host.js";
import { resolveTeamProviders, DEFAULT_TEAM_PROVIDERS } from "../profile.js";
import { listRunRecords, readRunEvents, readRunState, runRecordsToLedger } from "../runtime/run-store.js";
import { recoverRuns, startRun, stopRun } from "../runtime/run-manager.js";
import { createRunId, isActiveRunState } from "../runtime/run-types.js";
import { authorizeRunPermissions } from "../runtime/run-permissions.js";
import { ExecutionModeError, READ_ONLY_MODE, normalizeExecutionMode } from "./execution-mode.js";
import { inspectExecutionAdapters } from "../runtime/execution-adapters/index.js";
import { inspectEngramIntegration } from "../integrations/engram-evidence.js";
import { hasFiniteUsage } from "./usage-summary.js";
import { appendUsageSamples, readUsageSamples } from "../observability/usage-samples.js";
import { readCodexUsage } from "../observability/codex-usage.js";
import { readClaudeUsage } from "../observability/claude-usage.js";
import { readOpenCodeUsage, readOpenCodeGoUsage, readOpenCodeStats } from "../observability/opencode-usage.js";
import { readCodexModels } from "../observability/codex-models.js";
import { readOpenCodeModels } from "../observability/opencode-models.js";
import { readClaudeModels } from "../observability/claude-models.js";
import { isCursorAutoModel, readCursorModels } from "../observability/cursor-models.js";
import { checkCandidate } from "../intelligence/execution-router.js";
import { readSkillCatalog } from "../intelligence/skill-catalog.js";
import { askProvider } from "../intelligence/quick-ask.js";
import { resolveAssignmentAvailability } from "./assignment-availability.js";
import { computeProjectProfile } from "./project-profile.js";
import {
  BLOCKED_ENTITLEMENTS, buildProjectStrategy, computeBootstrapAnalystCatalog, qualifiedRolePool,
  isStrategyStale, computeProjectTeamEditCatalog, applyProjectTeamOverride, resetProjectTeamAssignment
} from "./project-strategy.js";

import { buildAnalystPrompt, deriveRoleRequirements, parseProjectAnalysis, verifyDemandAssessment, stabilizeDemandAssessment } from "./project-analysis.js";
import { buildSanitizedSnapshot } from "./sanitized-snapshot.js";
import { runCodexSandboxedBootstrap } from "./codex-sandbox.js";
import { createBootstrapAnalyzerAdapter } from "./bootstrap-analyzer-adapters.js";
import { verifyClaudeSubscriptionAuth } from "../runtime/execution-adapters/claude.js";
import { readProjectStrategy, readTeamReform, writeProjectStrategy, writeTeamReform } from "./project-strategy-store.js";
import {
  clearPendingTeamProposal, computeProposalId, readPendingTeamProposal, strategyHash, writePendingTeamProposal
} from "./pending-team-proposal-store.js";
import { acquireProjectAnalysisLock } from "./project-analysis-lock.js";
import { readAvailabilityRecovery, writeAvailabilityRecovery } from "./availability-recovery-store.js";
import { approveRecoveryProposal, recoveryProposalId, rejectRecoveryProposal, runStructuralReform, runTeamRecovery, structuralSnapshot } from "./team-recovery.js";
import { resolveProjectRoute } from "./project-router.js";
import { readArtificialAnalysisModels } from "../observability/artificial-analysis-models.js";
import { readHuggingFaceLeaderboard } from "../observability/huggingface-leaderboard.js";
import { readAgentSessionTelemetry } from "../observability/agent-session-telemetry.js";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { loadProjectRoleCatalog } from "../intelligence/role-catalog.js";
import { builderQuotaPool } from "../intelligence/price-tier.js";
import { providersWithUnusedQuota } from "../intelligence/quota-pacing.js";
import { roleTier } from "../intelligence/role-demand.js";
import { withRoleCatalog, currentRegistry, reconcileCatalogRoles } from "../intelligence/role-registry.js";
import { probeGentle } from "../observability/gentle-probe.js";
import { buildRoleTelemetry, kairoRunToTelemetryRecord } from "../intelligence/role-telemetry.js";
import {
  DEFAULT_ENTITLEMENT_TTL_MS,
  mergeEntitlementResults,
  readClaudeEntitlementCache,
  resolveClaudeEntitlements,
  writeClaudeEntitlementCache
} from "../observability/claude-entitlement-store.js";
import {
  ENTITLEMENT,
  probeClaudeModelEntitlements
} from "../observability/claude-model-entitlement.js";
import {
  DEFAULT_CURSOR_ACCESS_TTL_MS,
  invalidateCursorPoolAccess,
  mergeCursorAccessResult,
  readCursorAccessCache,
  resolveCursorPoolAccess,
  writeCursorAccessCache
} from "../observability/cursor-entitlement-store.js";
import {
  CURSOR_ACCESS_STATUS, CURSOR_POOL, classifyCursorPool, probeCursorPoolAccess
} from "../observability/cursor-entitlement.js";
import {
  annotateWithRegistryEvidence, bestEfficientModelPerRoleGlobal, bestModelPerRole, bestModelPerRoleGlobal, buildAiTeam,
  buildEfficientTeam, scoreAvailableModels, summarizeCatalogCoverage
} from "../intelligence/model-intelligence.js";
import { buildTeamSelectionPool, buildAutomaticExecutionPool, buildCompleteCandidateCatalog, buildScoredCandidatePools } from "../intelligence/model-candidate-catalog.js";
import { toRuntimeModelRef } from "../intelligence/transport-registry.js";
import { createCapabilityRegistry } from "../intelligence/model-capability-registry.js";
import { ingestArtificialAnalysisEvidence, ingestHuggingFaceLeaderboardEvidence } from "../intelligence/model-capability-registry-sources.js";
import { readEffortOutcomes, ingestEffortOutcomeEvidence } from "../intelligence/effort-outcome-source.js";
import { ingestOfficialSnapshotEvidence } from "../intelligence/official-benchmark-snapshots.js";
import { ingestKairoTelemetryEvidence } from "../intelligence/kairo-telemetry-source.js";
import { buildProviderCapacity } from "../intelligence/subscription-pressure-source.js";

export const CONVERSATION_SCHEMA = "kairo.conversation/v1";

// The Bootstrap Analyst investigates a real project (reads real files,
// not just answering from the prompt text) — genuinely slower than a
// quick ASK-mode question, so it gets real room instead of quick-ask's
// 30s default.
const BOOTSTRAP_ANALYST_TIMEOUT_MS = 180_000;

/** Max Claude entitlement probes per `/models --verify-access` sweep. */
const CLAUDE_ENTITLEMENT_MAX_PROBES = 12;

/**
 * Cost statement printed before any Claude entitlement spawn. Economy is
 * measured: denied probes cost $0; allowed ones about one cent each.
 * @param {{ pendingCount?: number }} [options]
 */
export function buildClaudeEntitlementVerifyCostStatement({ pendingCount = 0 } = {}) {
  const n = Math.max(0, Number(pendingCount) || 0);
  if (n <= 0) {
    return "No Claude models need access verification right now (denied probes cost $0; allowed ones about one cent each).";
  }
  return `About to verify ${n} Claude model${n === 1 ? "" : "s"}: models your plan denies cost $0; allowed ones cost about one cent each.`;
}

/**
 * One-line preflight notice when unverified Claude models exist.
 * @param {number} count
 */
export function buildUnverifiedClaudePreflightNotice(count) {
  const n = Math.max(0, Number(count) || 0);
  return `${n} modelos de Claude tienen acceso sin verificar — solo están disponibles para selección manual y pueden requerir créditos extra. Corré /models --verify-access para verificar (los que tu plan deniega cuestan $0; los permitidos, alrededor de un centavo cada uno).`;
}

function isPersistableEntitlementStatus(status) {
  return status === ENTITLEMENT.ALLOWED || status === ENTITLEMENT.DENIED;
}

// A 429 temporary limit is persisted too (short-TTL evidence), but only as
// unverified+limit, so every DENIED/UNVERIFIED gate keeps failing closed.
function isPersistableEntitlementResult(result) {
  return isPersistableEntitlementStatus(result?.status)
    || (result?.status === ENTITLEMENT.UNVERIFIED && result?.limit === "temporary");
}

// Identity is enforced only when the auth probe reports an `accountIdentifier`
// key (the real verifier always does, null when unidentifiable). Fakes that
// omit the key keep the legacy subscription-only behavior.
function accountIdentity(auth) {
  return auth && Object.hasOwn(auth, "accountIdentifier") ? { accountIdentifier: auth.accountIdentifier } : {};
}

// Cursor's own real access status (AVAILABLE/EXHAUSTED/UNVERIFIED) uses a
// vocabulary purpose-built for its own two-pool model; wherever Kairo's
// existing per-model entitlement machinery (blockingEntitlement in
// project-router.js, buildCompleteCandidateCatalog's own DENIED/UNVERIFIED
// filtering) expects the shared ENTITLEMENT vocabulary, this projects one
// onto the other — never invents a second, parallel gating mechanism.
function cursorStatusToEntitlement(status) {
  if (status === CURSOR_ACCESS_STATUS.AVAILABLE) return ENTITLEMENT.ALLOWED;
  if (status === CURSOR_ACCESS_STATUS.EXHAUSTED) return ENTITLEMENT.DENIED;
  return ENTITLEMENT.UNVERIFIED;
}

/**
 * Discovery-only view of each real Cursor pool's access: persisted evidence
 * only, NEVER a provider probe. A fresh (within TTL) cached AVAILABLE/EXHAUSTED
 * entry is reused; a cached-but-expired entry is UNVERIFIED with reason
 * "stale" (never allowed); no entry is UNVERIFIED with no reason. A pool with
 * no real candidate model in the current catalog has nothing to gate. Probing
 * lives behind the explicit, confirmed `verifyAccess` entry point only.
 * @param {{homeDir: string, cursorModels: Array<{id:string,displayName?:string}>, now: number, ttlMs: number, readCache: Function}} args
 * @returns {Promise<Record<string, {status: string, reason: string|null, age: string|null, probedAt: string|null}>>}
 */
async function resolveCursorAccessFromCache({ homeDir, cursorModels, now, ttlMs, readCache }) {
  const hasModels = { [CURSOR_POOL.CURSOR_MODELS]: false, [CURSOR_POOL.OTHER_MODELS]: false };
  for (const model of cursorModels) hasModels[classifyCursorPool(model)] = true;
  const cache = await readCache(homeDir).catch(() => null);
  const result = {};
  for (const pool of [CURSOR_POOL.CURSOR_MODELS, CURSOR_POOL.OTHER_MODELS]) {
    if (!hasModels[pool]) {
      result[pool] = { status: CURSOR_ACCESS_STATUS.UNVERIFIED, reason: null, age: null, probedAt: null };
      continue;
    }
    const resolved = resolveCursorPoolAccess({ cache, pool, now, ttlMs });
    result[pool] = resolved.status === CURSOR_ACCESS_STATUS.UNVERIFIED
      ? { ...resolved, reason: resolved.probedAt ? "stale" : null }
      : resolved;
  }
  return result;
}

/** Expired cached evidence is unverified with reason "stale" (never allowed, never a guess). */
function markStaleEntitlements(resolved) {
  for (const entry of Object.values(resolved)) {
    if (entry.status === ENTITLEMENT.UNVERIFIED && entry.probedAt && !entry.reason) entry.reason = "stale";
  }
  return resolved;
}

const SUBSCRIPTION_LABEL = Object.freeze({ claude: "Claude", cursor: "Cursor" });

function evidenceStatusLabel(status) {
  if (status === ENTITLEMENT.ALLOWED || status === CURSOR_ACCESS_STATUS.AVAILABLE) return "allowed";
  if (status === ENTITLEMENT.DENIED || status === CURSOR_ACCESS_STATUS.EXHAUSTED) return "denied";
  return null;
}

/**
 * The concrete, never-executed verification plan: which checks are pending
 * per subscription (Claude: one per MODEL; Cursor: one per POOL, never one per
 * row) and which are reusable from fresh persisted evidence. Pure: no I/O.
 * Only subscriptions the router already considers usable contribute checks.
 * `mayConsumeQuota` is true whenever at least one check is pending, because
 * each pending check is a real provider call.
 * @param {{eligibility: Record<string, {ok?: boolean}>, claudeModels: Array<{id: string, displayName?: string}>, claudeEntitlement: Record<string, object>, cursorModels: Array<{id: string, displayName?: string}>, cursorAccess: Record<string, object>}} args
 */
export function buildAccessVerificationPlan({ eligibility = {}, claudeModels = [], claudeEntitlement = {}, cursorModels = [], cursorAccess = {}, teamProviders = DEFAULT_TEAM_PROVIDERS }) {
  const subscriptions = [];
  // Plan only active providers; retain provider-specific planners for future policy widening.
  for (const adapterId of teamProviders) {
    if (eligibility[adapterId]?.ok !== true) continue;
    if (adapterId === "claude" && claudeModels.length > 0) {
      const checks = claudeModels.map((model) => {
        const entry = claudeEntitlement[model.id] ?? { status: ENTITLEMENT.UNVERIFIED };
        const cachedStatus = evidenceStatusLabel(entry.status);
        return {
          id: `claude::${model.id}`, kind: "model", modelId: model.id, label: model.displayName ?? model.id,
          state: cachedStatus ? "reusable" : "pending",
          reason: cachedStatus ? null : (entry.probedAt ? "stale" : "never_verified"),
          cachedStatus, age: cachedStatus ? (entry.age ?? null) : null
        };
      });
      // Same probe cap the explicit verify path has always honored.
      let pendingSeen = 0;
      const capped = checks.filter((check) => check.state !== "pending" || (pendingSeen += 1) <= CLAUDE_ENTITLEMENT_MAX_PROBES);
      subscriptions.push(summarizeSubscription("claude", "model", capped));
    }
    if (adapterId === "cursor" && cursorModels.length > 0) {
      const byPool = { [CURSOR_POOL.CURSOR_MODELS]: [], [CURSOR_POOL.OTHER_MODELS]: [] };
      for (const model of cursorModels) byPool[classifyCursorPool(model)].push(model);
      const checks = [];
      for (const pool of [CURSOR_POOL.CURSOR_MODELS, CURSOR_POOL.OTHER_MODELS]) {
        const representative = byPool[pool][0];
        if (!representative) continue;
        const access = cursorAccess[pool] ?? { status: CURSOR_ACCESS_STATUS.UNVERIFIED, reason: null };
        const cachedStatus = evidenceStatusLabel(access.status);
        checks.push({
          id: `cursor::${pool}`, kind: "pool", pool, modelId: representative.id, models: byPool[pool].length,
          label: pool === CURSOR_POOL.CURSOR_MODELS ? "Cursor models" : "Other models",
          state: cachedStatus ? "reusable" : "pending",
          reason: cachedStatus ? null : (access.reason === "stale" ? "stale" : "never_verified"),
          cachedStatus, age: cachedStatus ? (access.age ?? null) : null
        });
      }
      if (checks.length > 0) subscriptions.push(summarizeSubscription("cursor", "pool", checks));
    }
  }
  const pendingCount = subscriptions.reduce((sum, sub) => sum + sub.pendingCount, 0);
  const reusableCount = subscriptions.reduce((sum, sub) => sum + sub.reusableCount, 0);
  return {
    pendingCount, reusableCount, mayConsumeQuota: pendingCount > 0, subscriptions,
    costStatement: pendingCount > 0
      ? `Verifying makes ${pendingCount} real provider call${pendingCount === 1 ? "" : "s"} and may consume quota or account credit.`
      : null
  };
}

function summarizeSubscription(adapterId, granularity, checks) {
  return {
    adapterId, provider: SUBSCRIPTION_LABEL[adapterId] ?? adapterId, granularity, checks,
    pendingCount: checks.filter((check) => check.state === "pending").length,
    reusableCount: checks.filter((check) => check.state === "reusable").length
  };
}

const EMPTY_VERIFICATION_PLAN = Object.freeze({
  pendingCount: 0, reusableCount: 0, mayConsumeQuota: false, subscriptions: [], costStatement: null
});

/**
 * Read-only projection of the recovery state for setup: a manual pending
 * proposal first (the user's own act), then the automatic record. A proposal
 * whose base team no longer matches the active one is reported as
 * invalidated (never pending) BEFORE approval; approve keeps its own
 * revalidation. A failed base read preserves the recorded pending state.
 * Pure: no store is written and nothing is analyzed.
 */
function describeSetupRecovery({ record, manual, base, baseCheckFailed = false }) {
  const BASE_CHANGED = "The active team changed since the proposal was created.";
  if (manual) {
    const valid = baseCheckFailed || (base?.status === "active" && strategyHash(base) === manual.basedOn?.hash);
    return {
      outcome: valid ? "proposed" : "invalidated",
      pending: valid,
      invalidated: !valid,
      invalidReason: valid ? null : BASE_CHANGED,
      source: manual.source ?? "manual-reanalysis",
      proposalId: manual.id,
      ...(baseCheckFailed ? { baseCheckFailed: true } : {})
    };
  }
  if (!record) return null;
  const proposed = record.outcome === "proposed" && record.proposal != null;
  const stale = !baseCheckFailed && proposed && record.basedOn != null && (
    base?.status !== "active" ||
    (base.profileFingerprint ?? null) !== (record.basedOn?.profileFingerprint ?? null) ||
    (base.approvedAt ?? null) !== (record.basedOn?.approvedAt ?? null)
  );
  return {
    outcome: stale ? "invalidated" : record.outcome ?? null,
    pending: proposed && !stale,
    invalidated: stale,
    invalidReason: stale ? BASE_CHANGED : null,
    source: proposed ? "automatic-recovery" : null,
    proposalId: proposed ? recoveryProposalId(record) : null,
    ...(baseCheckFailed ? { baseCheckFailed: true } : {})
  };
}

function publicPlan(record, execution = null) {
  const status = record.status ?? record;
  return {
    taskId: status.taskId,
    taskText: status.taskText ?? null,
    state: status.state,
    provider: status.provider,
    model: status.model ?? null,
    sessionId: status.sessionId ?? null,
    baseHead: status.baseHead,
    createdAt: status.createdAt,
    updatedAt: status.updatedAt,
    error: status.error ?? null,
    artifacts: status.artifacts,
    planReady: ![PLAN_STATES.DRAFT, PLAN_STATES.FAILED].includes(status.state),
    approval: status.state === PLAN_STATES.APPROVED
      ? "approved"
      : status.state === PLAN_STATES.REJECTED ? "rejected" : "not_decided",
    execution: execution ?? {
      state: "not_started",
      provider: "claude",
      message: status.state === PLAN_STATES.APPROVED
        ? "Approved plan is ready for explicit Claude execution."
        : "Approval is required before execution."
    }
  };
}

/**
 * Maps execution-adapter availability into the cockpit's `providers` shape,
 * keyed by each adapter's display label (e.g. "Codex", "Claude") so
 * the slash diagnostics' providerLine() lookups resolve to real data instead
 * of its hardcoded fallback text.
 * @param {ReturnType<typeof inspectExecutionAdapters>} adapters
 */
// Provider display lookups use "Claude"; the claude adapter's
// own display label is "Claude Code" (claude.js's `label`), so it needs an
// explicit override here rather than relying on the label verbatim.
const PROVIDER_DISPLAY_NAME = { claude: "Claude" };

/**
 * Sums real, auditable token usage (`run.tokenUsage`, emitted by each
 * adapter's own parseEventLine — see run-events.js) per agentId across
 * recent Kairo-launched runs. This is measured consumption from runs Kairo
 * itself started — separate from provider account-level subscription quota.
 * @param {Array<object>} runs - listRunRecords() results
 * @returns {Record<string, {total: number, runCount: number}>}
 */
function aggregateRunUsageByAgent(runs) {
  const byAgent = {};
  for (const run of runs) {
    if (!hasFiniteUsage(run?.tokenUsage)) continue;
    const agentId = run.agentId ?? "unknown";
    const bucket = byAgent[agentId] ?? { total: 0, runCount: 0 };
    bucket.total += Number.isFinite(run.tokenUsage.total) ? run.tokenUsage.total : 0;
    bucket.runCount += 1;
    byAgent[agentId] = bucket;
  }
  return byAgent;
}

function formatCodexUsage(usage) {
  if (!usage || usage.status === "unknown") return "ENABLED · usage unknown";
  const primary = usage.primary ? `5h ${usage.primary.remainingPercent}% left` : null;
  const secondary = usage.secondary ? `weekly ${usage.secondary.remainingPercent}% left` : null;
  const parts = [primary, secondary].filter(Boolean);
  return `${parts.join(" · ") || "usage unavailable"} · ${usage.status}`;
}

// Claude Code's own `/usage` is a local_command (intercepted client-side,
// zero cost — see observability/claude-usage.js), so this mirrors
// formatCodexUsage's shape: real session/weekly percentages, never invented.
function formatClaudeUsage(usage) {
  if (!usage || usage.status === "unknown") return "ENABLED · usage unknown";
  const primary = usage.primary ? `${usage.primary.label} ${usage.primary.remainingPercent}% left` : null;
  const secondary = usage.secondary ? `${usage.secondary.label} ${usage.secondary.remainingPercent}% left` : null;
  const parts = [primary, secondary].filter(Boolean);
  return `${parts.join(" · ") || "usage unavailable"} · ${usage.status}`;
}

// Real subscription headroom per adapter, for EFFICIENT TEAM's quota-pressure
// dimension (subscription-pressure-source.js). Quota is account-wide, so this
// picks the worst-case real window — a provider isn't "healthy" just because
// its 5h window has room if its weekly window (or, for Go, any one of its
// windows) is nearly exhausted.
function remainingPercentByAdapter(codexUsage, claudeUsage, opencodeUsage) {
  const result = {};
  const worstOf = (usage) => {
    const values = [usage?.primary?.remainingPercent, usage?.secondary?.remainingPercent]
      .filter((v) => typeof v === "number");
    return values.length ? Math.min(...values) : null;
  };
  const codexRemaining = worstOf(codexUsage);
  if (codexRemaining != null) result.codex = codexRemaining;
  const claudeRemaining = worstOf(claudeUsage);
  if (claudeRemaining != null) result.claude = claudeRemaining;
  const goWindows = opencodeUsage?.go?.windows ?? [];
  const goValues = goWindows.map((w) => w.remainingPercent).filter((v) => typeof v === "number");
  if (goValues.length) result["opencode-go"] = Math.min(...goValues);
  return result;
}

function providersFromAdapters(adapters, usageByAgent = {}, codexUsage = null, claudeUsage = null, opencodeUsage = null) {
  const providers = {};
  for (const adapter of adapters) {
    const state = adapter.available
      ? (adapter.launchable ? "ENABLED" : "LIMITED")
      : "MISSING";
    const name = PROVIDER_DISPLAY_NAME[adapter.id] ?? adapter.label;
    const usage = usageByAgent[adapter.id];
    const usageSuffix = usage
      ? ` · ${usage.total} tokens (${usage.runCount} run${usage.runCount === 1 ? "" : "s"} via Kairo)`
      : "";
    providers[name] = {
      status: (adapter.reason ? `${state} · ${adapter.reason}` : state) + usageSuffix
    };
  }
  if (codexUsage) providers.Codex = { status: formatCodexUsage(codexUsage), usage: codexUsage };
  if (claudeUsage) providers.Claude = { status: formatClaudeUsage(claudeUsage), usage: claudeUsage };
  if (opencodeUsage && (opencodeUsage.go || opencodeUsage.zen)) {
    const go = opencodeUsage.go;
    const zen = opencodeUsage.zen;
    const goLabel = go?.status === "measured" || go?.status === "rate-limited"
      ? (go.windows ?? []).map((w) => `${w.name} ${w.remainingPercent}% left`).join(" · ") : "Go usage unknown";
    const zenLabel = zen?.status === "local_recorded" ? `Zen 7d $${zen.totalCost.toFixed(2)} local` : "Zen 7d local unknown";
    providers.OpenCode = { status: `${goLabel} · ${zenLabel}`, usage: opencodeUsage };
  }
  return providers;
}

/**
 * Maps the Engram integration inspection into the cockpit's `integrations`
 * shape. Other integration lines (MCP/Skills/CodeGraph/Graphify/Gentle)
 * still use view.js's fallback text until a similarly cheap, per-poll-safe
 * inspector exists for each.
 * @param {ReturnType<typeof inspectEngramIntegration>} engram
 */
function integrationsFromInspections(engram) {
  return { engram: { status: engram.status } };
}

function snapshot(projectRoot, plans, providers = {}, integrations = {}) {
  return {
    schema: CONVERSATION_SCHEMA,
    projectRoot,
    providers,
    integrations,
    usage: { codex: null, claude: null, opencode: null },
    modelIntelligence: {
      status: "unknown", source: null, age: null, models: [], roles: [], eligibility: {}, coverage: [],
      globalGuide: { capability: [], efficient: [] }, aiTeam: [], efficientTeam: []
    },
    governance: {
      methodologyOwner: "gentle-ai",
      orchestratorOwner: "kairo",
      approvalIsExecutionConsent: false
    },
    capabilities: {
      architecture: true,
      planDecision: true,
      automatedImplementation: true,
      claudeExecution: "subscription_only",
      openCodeExecution: {
        available: false,
        reason: "Unavailable until opencode-go/* is verified and server-side Use balance is disabled."
      }
    },
    timeline: plans
  };
}

/**
 * One team role for `readTeam`. Availability comes from the existing
 * `resolveAssignmentAvailability` plus the adapter's own install/launch
 * facts (a strategy adapterId such as "opencode-go" maps to adapter
 * "opencode") — never a second eligibility rule.
 */
function teamRole(role, model, providers, intelligence) {
  const adapterId = model?.adapterId ?? null;
  const provider = adapterId
    ? providers.find((p) => p.id === adapterId) ?? providers.find((p) => adapterId.startsWith(`${p.id}-`)) ?? null
    : null;
  let blockedReason = null;
  if (!model) {
    blockedReason = "No eligible model assigned.";
  } else if (provider && !provider.installed) {
    blockedReason = provider.reason ?? `${provider.label} is not installed.`;
  } else {
    const { available, warning } = resolveAssignmentAvailability(model, intelligence);
    if (!available) blockedReason = warning ?? "Not available.";
  }
  return {
    role,
    provider: adapterId,
    model: model?.displayName ?? model?.modelId ?? null,
    modelId: model?.modelId ?? null,
    installed: provider?.installed ?? false,
    launchable: provider?.launchable ?? false,
    eligible: blockedReason === null,
    blockedReason
  };
}

/** Bootstrap Analyst catalog from the snapshot's model intelligence (shared by preflight and the setup read). */
function analystCatalogFor(intelligence = {}, teamProviders = DEFAULT_TEAM_PROVIDERS) {
  const {
    scoredAll = [], manualSelectionScoredPool = scoredAll, deniedScoredPool = [], eligibility = {}, registry = null,
    providerCapacity = null, unscoredModels = [], analystUnscoredModels = unscoredModels
  } = intelligence;
  return computeBootstrapAnalystCatalog({
    scoredAll, manualSelectionScoredPool, deniedScoredPool, eligibility, registry, providerCapacity,
    unscoredModels: analystUnscoredModels, teamProviders
  });
}

/** A malformed link/run record is typed corrupt evidence, never a thrown read. */
function unreadableExecution(error) {
  const corrupt = error instanceof SyntaxError || /Invalid execution artifact/i.test(String(error?.message ?? ""));
  return {
    runId: null, provider: null, role: null, active: false,
    state: corrupt ? "result_corrupt" : "evidence_unreadable",
    error: corrupt ? "Run evidence is corrupt." : "Run evidence is unreadable.",
    startedAt: null, updatedAt: null, message: "Run evidence could not be read."
  };
}

// Moved to project-strategy.js so every strategy builder stamps the same band and pool; kept exported here.
export { qualifiedRolePool };

export function createConversationService(deps = {}) {
  const activeHost = resolveActiveHost({ host: deps.activeHost, env: deps.env ?? {} });
  const ownedEvidenceStore = deps.ownedEvidenceStore ?? createRoleAptitudeEvidenceStore();
  const ownedEvidenceAccountKey = deps.ownedEvidenceAccountKey ?? "default";
  // Keep selection-only inputs out of public snapshots. Key by snapshot so
  // concurrent project reads cannot overwrite one another's candidate pool.
  const teamSelectionPools = new WeakMap();
  const structuralCatalogs = new WeakMap();
  const resolveRoot = deps.resolveRoot ?? resolveProjectRoot;
  const createPlan = deps.createPlan ?? createArchitecturePlan;
  const listPlans = deps.listPlans ?? listTaskRecords;
  const readPlan = deps.readPlan ?? readTaskRecord;
  const transition = deps.transition ?? transitionTask;
  const homeDir = deps.homeDir ?? resolveHomeDir();
  // Providers allowed to hold team roles: injected, else the user profile, else the default.
  const teamProvidersFor = async (workspaceRoot) => deps.teamProviders ?? resolveTeamProviders({ homeDir, workspaceRoot });
  const readExecution = deps.readExecution ?? readExecutionLink;
  const readRun = deps.readRun ?? readRunState;
  const recover = deps.recoverRuns ?? recoverRuns;
  const verifyExecution = deps.verifyExecution ?? verifyPlanForExecution;
  const launchRun = deps.startRun ?? startRun;
  const authorizeRuns = deps.authorizeRunPermissions ?? authorizeRunPermissions;
  const cancelRun = deps.stopRun ?? stopRun;
  const reserveExecution = deps.writeExecution ?? writeExecutionLink;
  const updateExecution = deps.updateExecution ?? updateExecutionLink;
  const newRunId = deps.createRunId ?? createRunId;
  const inspectAdapters = deps.inspectExecutionAdapters ?? inspectExecutionAdapters;
  const inspectEngram = deps.inspectEngramIntegration ?? inspectEngramIntegration;
  const listRuns = deps.listRunRecords ?? listRunRecords;
  const readRunEventsImpl = deps.readRunEvents ?? readRunEvents;
  // Production default: bounded read-only Gentle status reader with typed
  // unavailable results. Tests inject `readGentleContext` or `gentle.*`.
  const readGentleContext = deps.readGentleContext ?? createGentleReader(deps.gentle ?? {});
  const transitions = deps.transitionStore ?? fileTransitionStore;
  const readCodexUsageImpl = deps.readCodexUsage ?? readCodexUsage;
  const readClaudeUsageImpl = deps.readClaudeUsage ?? readClaudeUsage;
  const readOpenCodeUsageImpl = deps.readOpenCodeUsage
    ?? (deps.resolveRoot ? async () => null : readOpenCodeUsage);
  const readOpenCodeGoImpl = deps.readOpenCodeGoUsage
    ?? (deps.resolveRoot ? async () => null : readOpenCodeGoUsage);
  const readOpenCodeStatsImpl = deps.readOpenCodeStats
    ?? (deps.resolveRoot ? async () => null : readOpenCodeStats);
  const readCodexModelsImpl = deps.readCodexModels ?? readCodexModels;
  const readOpenCodeModelsImpl = deps.readOpenCodeModels ?? readOpenCodeModels;
  const readClaudeModelsImpl = deps.readClaudeModels ?? readClaudeModels;
  const readSkillCatalogImpl = deps.readSkillCatalog ?? readSkillCatalog;
  const askProviderImpl = deps.askProvider ?? askProvider;
  const computeProjectProfileImpl = deps.computeProjectProfile ?? computeProjectProfile;
  const readProjectStrategyImpl = deps.readProjectStrategy ?? readProjectStrategy;
  const writeProjectStrategyImpl = deps.writeProjectStrategy ?? writeProjectStrategy;
  const providerStatus = deps.providerStatus ?? (deps.resolveRoot
    ? async () => null
    : (args) => createProviderConnections({ homeDir }).status(args));
  const readTeamReformImpl = deps.readTeamReform ?? readTeamReform;
  const writeTeamReformImpl = deps.writeTeamReform ?? writeTeamReform;
  const readPendingTeamProposalImpl = deps.readPendingTeamProposal ?? readPendingTeamProposal;
  const writePendingTeamProposalImpl = deps.writePendingTeamProposal ?? writePendingTeamProposal;
  const clearPendingTeamProposalImpl = deps.clearPendingTeamProposal ?? clearPendingTeamProposal;
  const parseProjectAnalysisImpl = deps.parseProjectAnalysis ?? parseProjectAnalysis;
  const deriveRoleRequirementsImpl = deps.deriveRoleRequirements ?? deriveRoleRequirements;
  const buildSanitizedSnapshotImpl = deps.buildSanitizedSnapshot ?? buildSanitizedSnapshot;
  const runCodexSandboxedBootstrapImpl = deps.runCodexSandboxedBootstrap ?? runCodexSandboxedBootstrap;
  const createBootstrapAnalyzerAdapterImpl = deps.createBootstrapAnalyzerAdapter ?? createBootstrapAnalyzerAdapter;
  const acquireProjectAnalysisLockImpl = deps.acquireProjectAnalysisLock ?? acquireProjectAnalysisLock;
  const readAvailabilityRecoveryImpl = deps.readAvailabilityRecovery ?? readAvailabilityRecovery;
  const writeAvailabilityRecoveryImpl = deps.writeAvailabilityRecovery ?? writeAvailabilityRecovery;
  const codexIsolationDeps = deps.codexIsolationDeps ?? {};
  const verifyClaudeSubscriptionAuthImpl = deps.verifyClaudeSubscriptionAuth ?? verifyClaudeSubscriptionAuth;
  const readArtificialAnalysisModelsImpl = deps.readArtificialAnalysisModels ?? readArtificialAnalysisModels;
  // Unit tests inject resolveRoot and must remain provider-call free. The real
  // cockpit opts in explicitly so a refresh performs one bounded read-only probe.
  const enableProviderProbes = deps.enableProviderProbes ?? !deps.resolveRoot;
  const codexUsageTtlMs = deps.codexUsageTtlMs ?? 60_000;
  const claudeUsageTtlMs = deps.claudeUsageTtlMs ?? 60_000;
  const opencodeUsageTtlMs = deps.opencodeUsageTtlMs ?? 300_000;
  const opencodeGoUsageTtlMs = deps.opencodeGoUsageTtlMs ?? 60_000;
  // Model catalogs and Artificial Analysis's real benchmark scores both
  // change slowly and cost real subprocess spawns / a real network call —
  // snapshot() polls every couple seconds, so these need a much longer TTL
  // than usage, not a fresh read on every poll.
  const modelCatalogTtlMs = deps.modelCatalogTtlMs ?? 600_000;
  const artificialAnalysisTtlMs = deps.artificialAnalysisTtlMs ?? 6 * 60 * 60_000;
  // Same scale as Artificial Analysis: real benchmark leaderboards don't
  // change minute to minute. Telemetry reads local run records already on
  // disk (no network call) but still shouldn't re-scan on every 2s poll.
  const huggingFaceLeaderboardTtlMs = deps.huggingFaceLeaderboardTtlMs ?? 6 * 60 * 60_000;
  const telemetryTtlMs = deps.telemetryTtlMs ?? 30_000;
  // Claude entitlement disk cache is stable for days; subscription auth is
  // a real CLI spawn (~10s) — cache both so snapshot() polls never re-probe
  // per-model entitlement (that lives behind /models --verify-access).
  const claudeEntitlementCacheTtlMs = deps.claudeEntitlementCacheTtlMs ?? 600_000;
  const claudeSubscriptionAuthTtlMs = deps.claudeSubscriptionAuthTtlMs ?? 10_000;
  const now = deps.now ?? (() => Date.now());
  const loadProjectRoleCatalogImpl = deps.loadProjectRoleCatalog ?? loadProjectRoleCatalog;
  const probeGentleImpl = deps.probeGentle ?? probeGentle;
  const readFileImpl = deps.readFile ?? readFile;

  // Shared TTL + in-flight-dedupe cache for both provider usage probes:
  // concurrent snapshot() calls collapse into one underlying read, and reads
  // are skipped entirely while a fresh-enough cached value exists.
  function createCachedProbe(readFn, ttlMs, onFresh) {
    // One entry per key (project root, "global", ...): a read in flight for one key must never be
    // served to a caller asking for another, and one key must not evict another's cache.
    const entries = new Map();
    const readCached = async function readCached(key, args) {
      if (!enableProviderProbes) return null;
      let entry = entries.get(key);
      if (!entry) { entry = { cache: null, inFlight: null }; entries.set(key, entry); }
      const currentTime = now();
      if (entry.cache && currentTime - entry.cache.readAt < ttlMs) return entry.cache.value;
      if (entry.inFlight) return entry.inFlight;
      const mine = entry;
      mine.inFlight = Promise.resolve(readFn(args))
        .then(async (value) => {
          // Observations belong to fresh reads, not repeated TTL cache hits.
          try { await onFresh?.(value); } catch { /* quota history is best-effort */ }
          mine.cache = { readAt: now(), value };
          return value;
        })
        .finally(() => { mine.inFlight = null; });
      return mine.inFlight;
    };
    // Explicit bust for a caller that just wrote fresh data behind this
    // same read (e.g. verifyClaudeEntitlements persisting a real probe
    // result to disk) — without it, this TTL cache would keep serving the
    // pre-write read for up to ttlMs even though the real source changed
    // moments ago, in the same long-running session. Dropping the entries
    // also orphans any read still in flight, so it cannot repopulate the cache.
    readCached.invalidate = () => { entries.clear(); };
    return readCached;
  }
  const recordUsage = provider => value => (deps.appendUsageSamples ?? appendUsageSamples)(homeDir, provider, value, { now });
  const readCodexUsageCached = createCachedProbe(readCodexUsageImpl, codexUsageTtlMs, recordUsage("codex"));
  const readClaudeUsageCached = createCachedProbe(readClaudeUsageImpl, claudeUsageTtlMs, recordUsage("claude"));
  const readCursorModelsImpl = deps.readCursorModels ?? readCursorModels;
  const readCodexModelsCached = createCachedProbe(readCodexModelsImpl, modelCatalogTtlMs);
  const readOpenCodeGoModelsCached = createCachedProbe(
    () => readOpenCodeModelsImpl({ provider: "opencode-go" }), modelCatalogTtlMs
  );
  const readCursorModelsCached = createCachedProbe(readCursorModelsImpl, modelCatalogTtlMs);
  const readArtificialAnalysisModelsCached = createCachedProbe(
    (args) => readArtificialAnalysisModelsImpl({ ...args, homeDir }), artificialAnalysisTtlMs
  );
  const readHuggingFaceLeaderboardImpl = deps.readHuggingFaceLeaderboard ?? readHuggingFaceLeaderboard;
  const readHuggingFaceLeaderboardCached = createCachedProbe(
    (datasetId) => readHuggingFaceLeaderboardImpl({ datasetId, homeDir }), huggingFaceLeaderboardTtlMs
  );
  const listRunRecordsImpl = deps.listRunRecords ?? listRunRecords;
  const listRunRecordsCached = createCachedProbe(() => listRunRecordsImpl(homeDir), telemetryTtlMs);
  // Reading real session transcripts is slow (~6 s on real data): cache it with a long TTL and never let
  // a snapshot wait on it. A read that misses the short wait keeps running; its value (and the last good
  // one) serves the next snapshots.
  const readAgentSessionTelemetryImpl = deps.readAgentSessionTelemetry ?? readAgentSessionTelemetry;
  const sessionTelemetryWaitMs = deps.sessionTelemetryWaitMs ?? 100;
  let lastSessionTelemetry = null;
  const readAgentSessionTelemetryCached = createCachedProbe(async () => {
    // Read the service's own home, never the process home: an injected homeDir
    // (tests, alternate profiles) must not scan the real user's transcripts.
    lastSessionTelemetry = await readAgentSessionTelemetryImpl({
      projectsDir: join(homeDir, ".claude", "projects"),
      sessionsDir: process.env.CODEX_HOME ? join(process.env.CODEX_HOME, "sessions") : join(homeDir, ".codex", "sessions")
    });
    return lastSessionTelemetry;
  }, deps.sessionTelemetryTtlMs ?? 300_000);
  async function readSessionTelemetryBounded() {
    const pending = readAgentSessionTelemetryCached("sessions", null);
    if (!pending || typeof pending.then !== "function") return lastSessionTelemetry;
    pending.catch(() => {});
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), sessionTelemetryWaitMs); });
    try {
      const value = await Promise.race([pending, timeout]);
      return value === undefined ? lastSessionTelemetry : value;
    } catch {
      return lastSessionTelemetry;
    } finally { clearTimeout(timer); }
  }
  const readOpenCodeUsageCached = createCachedProbe(readOpenCodeUsageImpl, opencodeUsageTtlMs, value => recordUsage("opencode-go")(value?.go));
  const readOpenCodeGoCached = createCachedProbe(readOpenCodeGoImpl, opencodeGoUsageTtlMs, recordUsage("opencode-go"));
  const readOpenCodeStatsCached = createCachedProbe(readOpenCodeStatsImpl, opencodeUsageTtlMs);
  /**
   * The strategy file is read, then slow work (snapshot, profile, catalog) runs, then a value derived
   * from the stale read is written. Re-read right before the write and refuse when it changed, so a
   * newer approval/recovery/edit is never silently overwritten.
   */
  async function assertStrategyUnchanged(projectRoot, expected) {
    const current = await readProjectStrategyImpl(homeDir, projectRoot);
    if (!isDeepStrictEqual(current, expected)) {
      const error = new Error("The project strategy changed while this operation was running — nothing was written. Review the current team and try again.");
      error.code = "strategy_changed";
      throw error;
    }
  }
  const readClaudeEntitlementCacheImpl = deps.readClaudeEntitlementCache ?? readClaudeEntitlementCache;
  const writeClaudeEntitlementCacheImpl = deps.writeClaudeEntitlementCache ?? writeClaudeEntitlementCache;
  const mergeEntitlementResultsImpl = deps.mergeEntitlementResults ?? mergeEntitlementResults;
  const probeClaudeModelEntitlementsImpl = deps.probeClaudeModelEntitlements ?? probeClaudeModelEntitlements;
  const readCursorAccessCacheImpl = deps.readCursorAccessCache ?? readCursorAccessCache;
  const writeCursorAccessCacheImpl = deps.writeCursorAccessCache ?? writeCursorAccessCache;
  const probeCursorPoolAccessImpl = deps.probeCursorPoolAccess ?? probeCursorPoolAccess;
  // Identity for Cursor evidence: resolved at most once per verification sweep, only when a
  // probe is about to be written. With an injected probe (a fake world) the default never spawns.
  const resolveCursorAccountIdentifierImpl = deps.resolveCursorAccountIdentifier
    ?? (deps.probeCursorPoolAccess ? async () => null : readCursorAccountIdentifier);
  const cursorIdentity = async () => {
    const accountIdentifier = await Promise.resolve(resolveCursorAccountIdentifierImpl()).catch(() => null);
    return typeof accountIdentifier === "string" && accountIdentifier.trim() ? { accountIdentifier } : {};
  };
  const cursorAccessTtlMs = deps.cursorAccessTtlMs ?? DEFAULT_CURSOR_ACCESS_TTL_MS;
  // Read the Cursor access cache for a merge-then-write. An absent cache (null) is a normal first
  // write; a READ FAILURE must not be turned into "empty", or the write would replace every pool's
  // evidence with only the new result.
  const readCursorCacheForMerge = async () => {
    try {
      return { ok: true, cache: await readCursorAccessCacheImpl(homeDir) };
    } catch {
      return { ok: false, cache: null };
    }
  };
  const readClaudeEntitlementCacheCached = createCachedProbe(
    () => readClaudeEntitlementCacheImpl(homeDir), claudeEntitlementCacheTtlMs
  );
  // Auth spawn is slow; never re-run on every poll. Failures cache as null
  // so resolveClaudeEntitlements treats subscription as mismatched/absent.
  const verifyClaudeSubscriptionAuthCached = createCachedProbe(async () => {
    try {
      return await verifyClaudeSubscriptionAuthImpl({});
    } catch {
      return null;
    }
  }, claudeSubscriptionAuthTtlMs);

  async function executionFor(projectRoot, taskId) {
    let link;
    try {
      link = await readExecution(projectRoot, taskId);
    } catch (error) {
      return unreadableExecution(error);
    }
    if (!link) return null;
    let run;
    try {
      run = await readRun(homeDir, link.runId);
    } catch (error) {
      return { ...unreadableExecution(error), runId: link.runId, provider: link.agentId ?? link.provider ?? "claude", role: link.role ?? null };
    }
    return {
      runId: link.runId,
      provider: run?.agentId ?? link.agentId ?? "claude",
      role: link.role ?? null,
      mode: link.mode === READ_ONLY_MODE ? READ_ONLY_MODE : "standard",
      state: run?.state ?? link.state ?? "failed",
      active: run ? isActiveRunState(run.state) : false,
      error: run?.error ?? link.error ?? null,
      startedAt: run?.startedAt ?? link.createdAt ?? null,
      updatedAt: run?.updatedAt ?? link.updatedAt ?? null,
      message: run ? `Claude run is ${run.state}.` : (link.error ?? "Claude run record is unavailable.")
    };
  }

  // The ONE timeline projection (plans + their execution evidence) shared by
  // `snapshot`, `readTeam` and `readWork`. Recovery only marks dead runs
  // interrupted; it never launches anything.
  async function projectedPlans(projectRoot) {
    // A corrupt run record must not take the whole team/work view down: recovery is
    // best-effort here and the affected task shows typed unreadable evidence (executionFor).
    await recover(homeDir).catch(() => {});
    const allPlans = await listPlans(projectRoot);
    return Promise.all(allPlans.map(async (plan) => publicPlan(plan, await executionFor(projectRoot, plan.taskId))));
  }

  // The circuit is scoped to the CURRENT execution's run. With no current run the
  // store is still validated (corruption stays typed) but old progress from earlier
  // runs is never presented as the current circuit.
  async function readCircuit(projectRoot, taskId, runId) {
    if (typeof runId === "string" && runId) return transitions.read(projectRoot, taskId, { runId });
    const read = await transitions.read(projectRoot, taskId, { runId: null });
    if (read?.state !== "ok") return read;
    return { ...read, entries: [], next: deriveNextTransition([]) };
  }

  // Task rows (timeline + each task's pending transition) shared by readTeam and readWork.
  async function taskRows(projectRoot, timeline) {
    const nextByTask = new Map();
    for (const { taskId, execution } of timeline) {
      nextByTask.set(taskId, (await readCircuit(projectRoot, taskId, execution?.runId))?.next ?? null);
    }
    return timeline.map(({ taskId, taskText, state, provider, model, sessionId: owner, execution, artifacts, error }) => ({
      taskId, taskText, state, provider, model, sessionId: owner, execution, artifacts, error,
      nextTransition: nextByTask.get(taskId) ?? null
    }));
  }

  // Best-effort idempotent upsert of an observed transition. Reads and
  // launches must never fail or relaunch because the record is unwritable.
  async function noteTransition(projectRoot, taskId, input) {
    try {
      await transitions.append(projectRoot, taskId, input);
      return null;
    } catch (error) {
      return typeof error?.code === "string" ? error.code : "TRANSITION_WRITE_FAILED";
    }
  }

  // The legacy keyword-classification routeExecution() helper that used to
  // back planExecution/executePlan's no-role fallback path was removed
  // here — PROJECT TEAM (resolveProjectRoute, via routeProjectExecution
  // below) is now the sole authority for execution routing (see
  // planExecution's own doc). The underlying selectExecutionProvider
  // classifier itself still exists in execution-router.js but is no
  // longer imported or called anywhere in this file.

  async function root(cwd) { return resolveRoot(cwd); }

  async function projectAssignmentCatalog(projectRoot) {
    const fullCatalog = loadProjectRoleCatalogImpl({ projectRoot });
    const gentle = await probeGentleImpl({ cwd: projectRoot }).catch(() => ({ state: "missing" }));
    return gentle?.state === "available"
      ? fullCatalog
      : { ...fullCatalog, registry: Object.fromEntries(Object.entries(fullCatalog.registry).filter(([, role]) => role.owner !== "gentle-ai")) };
  }

  function assignAnalyzedProject(profile, candidates, analyst, { roleCatalog, projectGoal = null, orchestrator = null, teamProviders }) {
    const built = buildProjectStrategy(profile, { ...candidates, teamProviders, roleCatalog, projectGoal, orchestrator, teamShape: true }, analyst);
    return {
      ...built,
      ...(candidates.structuralCatalog ? { structure: structuralSnapshot({
        roles: built.structure.roles, teamProviders, eligibility: candidates.eligibility, models: candidates.structuralCatalog
      }) } : {}),
      // Persist verified selection inputs alongside the strategy's display
      // summary. Rebuild must not reinterpret capabilities or discard demand.
      analysisInputs: {
        roleRequirements: profile.roleRequirements,
        demandAssessment: profile.demandAssessment ?? null,
        risks: profile.risks ?? [],
        architecture: profile.architecture ?? {}
      }
    };
  }

  /**
   * Recompute a team from the analysis already stored in `stored` (roleCapabilities,
   * demandAssessment, analyst, fingerprint) with today's selection, capacity,
   * catalog and project signals. The role set follows the ACTIVE catalog: a
   * signal-activated role (Deliverer with a git remote) joins, one whose signal is
   * gone leaves. Never calls a model or the analyst runner.
   */
  async function currentRoleRequirements(projectRoot, stored) {
    const capabilities = stored?.roleCapabilities ?? {};
    // Older drafts stored the verified demand summary, not its category
    // inputs. Recover those verified levels without asking an analyst again.
    const assessment = stored?.demandAssessment;
    const legacyAssessment = assessment?.categories ? assessment : assessment?.levels ? {
      ...assessment,
      categories: Object.fromEntries(Object.entries(assessment.levels).map(([name, level]) => [name, {
        level, claimedLevel: assessment.claimedLevels?.[name] ?? level
      }]))
    } : null;
    const base = stored?.analysisInputs?.roleRequirements ?? Object.entries(capabilities).map(([role, { required = [], optional = [] }]) => (
      { role, capabilities: [...required, ...optional], reason: "" }
    ));
    const demandAssessment = stored?.analysisInputs?.demandAssessment ?? legacyAssessment;
    let fresh = null;
    try { fresh = await computeProjectProfileImpl({ cwd: projectRoot }); } catch { fresh = null; }
    // Without readable signals the stored role set stands: absence of evidence never removes a role.
    if (!fresh?.signals || typeof fresh.signals !== "object") return { requirements: base, activated: [], deactivated: [], demandAssessment, legacyAssessment };
    return { ...reconcileCatalogRoles(base, { signals: fresh.signals, quality: fresh.quality ?? {}, demandAssessment }), demandAssessment, legacyAssessment };
  }

  async function formFromStored(service, projectRoot, stored, providerStates = null) {
    const capabilities = stored?.roleCapabilities;
    if (!capabilities || typeof capabilities !== "object" || !Object.keys(capabilities).length || !stored.bootstrapAnalyst) {
      const error = new Error("No stored analysis. Run kairo team analysts and kairo team analyze first.");
      error.code = "no_analysis";
      throw error;
    }
    const { candidates } = await service.preflightProject({ cwd: projectRoot, mode: "catalog" });
    for (const provider of providerStates?.providers ?? []) {
      const installed = provider.installation?.state !== "missing";
      const authenticated = provider.authentication?.state !== "unauthenticated";
      if (!installed || !authenticated) {
        candidates.eligibility = {
          ...candidates.eligibility,
          [provider.providerId]: {
            ...candidates.eligibility?.[provider.providerId], ok: false, limit: undefined,
            installed, authenticated,
            reason: !installed ? "Provider is not installed" : "Provider is not authenticated"
          }
        };
      }
    }
    const roleCatalog = await projectAssignmentCatalog(projectRoot);
    const roles = await currentRoleRequirements(projectRoot, stored);
    const profile = {
      fingerprint: stored.profileFingerprint ?? null,
      demandAssessment: roles.legacyAssessment,
      ...stored.analysisInputs,
      roleRequirements: roles.requirements
    };
    const analyst = {
      model: stored.bootstrapAnalyst, choice: stored.bootstrapAnalystChoice ?? null,
      selectionSource: stored.bootstrapAnalystSelectionSource ?? "recommended",
      recommendationTags: stored.bootstrapAnalystRecommendationTags ?? []
    };
    const rebuilt = assignAnalyzedProject(profile, candidates, analyst, {
      roleCatalog, projectGoal: stored.projectGoal ?? null, orchestrator: stored.orchestrator,
      teamProviders: await teamProvidersFor(projectRoot)
    });
    return { rebuilt, activated: roles.activated, deactivated: roles.deactivated };
  }

  // runBootstrapAnalysis's body, run only while the project analysis lock
  // is held (see runBootstrapAnalysis). `persist: false` returns the
  // suggested strategy without writing it: automatic team recovery must not
  // overwrite the ACTIVE team before it has verified the rebuilt one.
  // Optional `onProgress({ stage, analyst, startedAt, elapsedMs })` mirrors
  // verification_progress — stages: preparing, consulting_analyst,
  // processing, building_team. Never invents percentages or private thoughts.
  async function runLockedBootstrapAnalysis({ projectRoot, profile, candidates, analyst, projectGoal = null, persist = true, onProgress = null }) {
    const startedAt = Date.now();
    const analystLabel = analyst?.model?.displayName
      ?? analyst?.model?.modelId
      ?? null;
    const emitProgress = (stage) => {
      if (typeof onProgress !== "function") return;
      try {
        onProgress({
          stage,
          analyst: analystLabel,
          startedAt,
          elapsedMs: Math.max(0, Date.now() - startedAt)
        });
      } catch {
        // Progress listeners must never abort analysis.
      }
    };
    emitProgress("preparing");
    // SECRET-SAFE (a real, meaningful reduction — not by itself a
    // filesystem sandbox guarantee, see sanitized-snapshot.js's own
    // header for why): the analyst's `cwd` points at a bounded,
    // secret-redacted temporary copy, never the real project directory.
    // A normal investigation never sees an unredacted secret.
    //
    // The actual provider call is routed through a neutral
    // BootstrapAnalyzerAdapter (bootstrap-analyzer-adapters.js) rather
    // than branched inline here — each adapter reports its own real
    // isolation level ("verified" | "restricted" | "unverified") and is
    // checked BEFORE any provider call is attempted, so an ineligible
    // adapter (e.g. Codex without a verified OS-level boundary on this
    // platform) fails closed with a concrete reason instead of silently
    // running with weaker protection than the caller expects.
    const snapshot = await buildSanitizedSnapshotImpl(projectRoot);
    try {
      const goal = typeof projectGoal === "string" && projectGoal.trim()
        ? projectGoal.trim()
        : await readFileImpl(join(projectRoot, ".kairo", "goal.md"), "utf8").then(text => text.trim()).catch(() => null);
      const roleCatalog = await projectAssignmentCatalog(projectRoot);
      const orchestrator = { source: "host", model: activeHost.id && activeHost.id !== 'claude-code'
        ? null : (deps.env ?? process.env).CLAUDE_MODEL ?? (deps.env ?? process.env).CLAUDE_CODE_MODEL ?? null };
      // S37: tell the analyst what the snapshot left out so it can flag gaps.
      const prompt = buildAnalystPrompt(profile, undefined, snapshot.exclusionSummary ?? null, { projectGoal: goal, roleCatalog });
      const adapter = createBootstrapAnalyzerAdapterImpl(analyst.model.adapterId, {
        modelId: analyst.model.modelId,
        deps: {
          askProvider: askProviderImpl, runCodexSandboxedBootstrap: runCodexSandboxedBootstrapImpl, isolationDeps: codexIsolationDeps,
          verifyClaudeSubscriptionAuth: verifyClaudeSubscriptionAuthImpl, readClaudeModels: readClaudeModelsImpl,
          modelEntitlement: candidates?.claudeEntitlement ?? {}
        }
      });
      const eligibility = await adapter.checkEligibility();
      if (!eligibility.eligible) {
        throw new Error(`Bootstrap Analyst is not eligible to run: ${eligibility.reason ?? "unknown reason"}`);
      }
      // A real project investigation (the model reads real files, not
      // just answering from the prompt text) genuinely takes longer
      // than ASK mode's quick-question default — give it real room
      // instead of timing out mid-investigation.
      emitProgress("consulting_analyst");
      const response = await adapter.analyze({
        question: prompt, snapshotRoot: snapshot.snapshotRoot, timeoutMs: BOOTSTRAP_ANALYST_TIMEOUT_MS
      });
      if (response.status !== "answered") {
        throw new Error(`Bootstrap Analyst did not answer: ${response.error ?? response.status}`);
      }
      emitProgress("processing");
      const parsed = parseProjectAnalysisImpl(response.answer);
      if (!parsed.valid) throw new Error(`Bootstrap Analyst response failed validation: ${parsed.error}`);
      // Real-evidence gate, checked PER recommendedRoleNeeds entry (see
      // deriveRoleRequirements): a role need is only trusted when its
      // OWN evidence cites at least one real file the analyst actually
      // had access to — one well-evidenced role need can no longer
      // vouch for every other role need in the same response.
      const roleRequirements = deriveRoleRequirementsImpl(parsed.analysis, profile.roleRequirements, snapshot.copiedFiles, roleCatalog);
      // S35: the verified demand assessment, not tooling presence, drives floors.
      const verifiedAssessment = verifyDemandAssessment(parsed.analysis.demandAssessment, snapshot.copiedFiles);
      const previousStrategy = verifiedAssessment ? await readProjectStrategyImpl(homeDir, projectRoot) : null;
      const demandAssessment = stabilizeDemandAssessment(previousStrategy?.demandAssessment, verifiedAssessment);
      emitProgress("building_team");
      const strategy = assignAnalyzedProject({ ...profile, roleRequirements, demandAssessment }, candidates, analyst, { roleCatalog, projectGoal: goal, orchestrator, teamProviders: await teamProvidersFor(projectRoot) });
      if (persist) await writeProjectStrategyImpl(homeDir, projectRoot, strategy);
      return {
        ...strategy, projectRoot, analysis: parsed.analysis,
        sanitization: { filesCopied: snapshot.filesCopied, secretsRedacted: snapshot.secretsRedacted, excludedPrivatePaths: snapshot.excludedPrivatePaths.length }
      };
    } finally {
      await snapshot.cleanup();
    }
  }


  /**
   * The exact real task text an automatic run gets launched with (see
   * executePlan) — the ONE real formula, never a second one invented for
   * display purposes. Reused by toExecutionPreview so a MANUAL_HANDOFF
   * preview can hand the human this same text, ready to paste into the
   * manual-only provider's own chat, instead of just naming the model.
   * @param {string} planMarkdown
   */
  function buildExecutionTaskPrompt(planMarkdown, mode = "standard") {
    if (mode === READ_ONLY_MODE) {
      // Clarity only: the prompt is NOT containment (that is the adapter's job).
      return [
        "Analyze the explicitly approved architecture plan below. This run is READ-ONLY analysis.",
        "You must not modify, create, delete or move any file, and must not run commands that change the repository or the system. Report findings only.",
        "Follow repository AGENTS.md and Gentle governance. Do not treat plan approval as any additional governance receipt.",
        "",
        planMarkdown
      ].join("\n");
    }
    return [
      "Implement the explicitly approved architecture plan below.",
      "Follow repository AGENTS.md and Gentle governance. Do not treat plan approval as any additional governance receipt.",
      "Use safe, non-bypassed permissions for this session.",
      "",
      planMarkdown
    ].join("\n");
  }

  /**
   * Projects a real project-router decision into the public
   * ProjectExecutionPreview shape — never recalculates anything the
   * router already decided, only reshapes it (plain `model` id string for
   * launchRun's own contract, alongside the full `modelRef`) and derives
   * `confirmationTarget` — the one real thing left to explicitly confirm,
   * present ONLY when there's something genuinely confirmable:
   * - ROUTED: the real assigned candidate.
   * - WAIT_FOR_PROJECT_TEAM with a real suggestedAlternative: that
   *   alternative, never the blocked assignment itself.
   * - Everything else (MANUAL_HANDOFF, or WAIT_FOR_PROJECT_TEAM with no
   *   real alternative): null — nothing to confirm into an automatic run.
   * @param {ReturnType<typeof resolveProjectRoute>} route
   * @param {{planMarkdown: string}|null} [record] - present only from
   *   planExecution (which already read the real plan record); used to
   *   attach `taskPrompt` for a MANUAL_HANDOFF decision only — a ROUTED/
   *   WAIT_FOR_PROJECT_TEAM preview never needs it, since executePlan
   *   builds the real task text itself from the SAME buildExecutionTaskPrompt.
   */
  function toExecutionPreview(route, record = null, mode = "standard") {
    let confirmationTarget = null;
    // Standard targets stay byte-for-byte (no mode key); only read-only is bound explicitly.
    const modeKey = mode === READ_ONLY_MODE ? { mode } : {};
    if (route.decision === "ROUTED" && route.model) {
      confirmationTarget = { role: route.role, selection: "assigned", strategyFingerprint: route.strategyFingerprint, candidateKey: route.model.candidateKey ?? null, ...modeKey };
    } else if (route.decision === "WAIT_FOR_PROJECT_TEAM" && route.suggestedAlternative?.model) {
      confirmationTarget = { role: route.role, selection: "suggested-alternative", strategyFingerprint: route.strategyFingerprint, candidateKey: route.suggestedAlternative.model.candidateKey ?? null, ...modeKey };
    }
    const taskPrompt = route.decision === "MANUAL_HANDOFF" && record?.planMarkdown
      ? buildExecutionTaskPrompt(record.planMarkdown, mode)
      : null;
    return {
      mode,
      decision: route.decision, role: route.role,
      provider: route.provider, model: route.model?.modelId ?? null, modelRef: route.model,
      assignmentSource: route.assignmentSource, strategyFingerprint: route.strategyFingerprint,
      why: mode === READ_ONLY_MODE ? `${route.why ?? ""} Mode: read-only (analysis only, no file changes).`.trim() : route.why,
      blockedAssignment: route.blockedAssignment, suggestedAlternative: route.suggestedAlternative,
      ...(route.distribution ? { distribution: route.distribution } : {}),
      ...(route.rerouted != null ? { rerouted: route.rerouted, reroutedFrom: route.reroutedFrom, reroutedTo: route.reroutedTo } : {}),
      confirmationTarget, taskPrompt
    };
  }

  return {
    getOwnedEvidenceStore() { return ownedEvidenceStore; },
    getOwnedEvidenceAccountKey() { return ownedEvidenceAccountKey; },
    /** Project-scoped: the timeline shows every task of the project. */
    async snapshot({ cwd }) {
      const projectRoot = await root(cwd);
      const teamProviders = await teamProvidersFor(projectRoot);
      const projected = await projectedPlans(projectRoot);
      const adapters = inspectAdapters({ cwd: projectRoot });
      const engram = inspectEngram();
      const recentRuns = await listRuns(homeDir, { limit: 50 });
      const usageByAgent = aggregateRunUsageByAgent(recentRuns);
      // Usage, the persisted project strategy, and (when enabled) every
      // provider-probe catalog/entitlement read are all independent I/O —
      // only the ELIGIBILITY computation below actually needs codex/claude/
      // opencode usage resolved first. Started together, never as two (or
      // three) sequential waves, so a cold snapshot's real wall-clock time
      // is bounded by the single slowest read, not their sum.
      const usagePromise = Promise.all([
        readCodexUsageCached(projectRoot, { cwd: projectRoot }),
        readClaudeUsageCached("global", {}),
        deps.readOpenCodeUsage
          ? readOpenCodeUsageCached("global", {})
          : Promise.all([
            readOpenCodeGoCached("global", {}),
            readOpenCodeStatsCached("global", {})
          ]).then(([go, zen]) => ({ go, zen }))
      ]);
      // Cheap local read only — never recomputed here. Recomputing a real
      // ProjectProfile (git log, Graphify probe) on every poll tick would
      // make the dashboard itself expensive; that only happens on an
      // explicit /project analyze or /project refresh.
      const projectStrategyPromise = readProjectStrategyImpl(homeDir, projectRoot);
      const providerProbesPromise = enableProviderProbes
        ? Promise.all([
          readCodexModelsCached(projectRoot, { cwd: projectRoot }),
          readOpenCodeGoModelsCached("global", {}),
          readCursorModelsCached(projectRoot, { cwd: projectRoot }),
          readArtificialAnalysisModelsCached("global", {}),
          readClaudeEntitlementCacheCached("global", {}),
          verifyClaudeSubscriptionAuthCached("global", {})
        ])
        : Promise.resolve(null);

      const [[codexUsage, claudeUsage, opencodeUsage], projectStrategyResult, providerProbes] = await Promise.all([
        usagePromise, projectStrategyPromise, providerProbesPromise
      ]);

      const result = snapshot(
        projectRoot, projected,
        providersFromAdapters(adapters, usageByAgent, codexUsage, claudeUsage, opencodeUsage), integrationsFromInspections(engram)
      );
      result.usage.codex = codexUsage;
      result.usage.claude = claudeUsage;
      result.usage.opencode = opencodeUsage;
      result.projectStrategy = projectStrategyResult;
      if (enableProviderProbes) {
        const [codexCatalog, opencodeGoCatalog, cursorCatalog, aa, entitlementCache, claudeAuth] = providerProbes;
        // Same eligibility policy the execution/ask router uses, with one
        // deliberate exception: opencode-go is allowed here even without
        // `launchable` (requireLaunchable: false) — you do have real
        // access to its models via the Go subscription, so AI TEAM can
        // name them as real options, even though Kairo can't yet safely
        // auto-execute through the shared opencode adapter (see
        // execution-adapters/opencode.js). Real task routing never gets
        // this exception (selectExecutionProvider always requires
        // launchable), so Kairo never actually picks Go for a real run
        // it's guaranteed to reject at launch. Zen and Cursor stay
        // excluded here regardless (PAYG risk / manual-only).
        const eligibility = {};
        const candidates = [];
        for (const adapterId of ["codex", "claude", "opencode-go", "opencode-zen", "cursor"]) {
          const check = checkCandidate(adapterId, { adapters, codexUsage, claudeUsage, opencodeGoUsage: opencodeUsage?.go }, { requireLaunchable: false });
          const adapter = adapters.find(entry => entry.id === (adapterId.startsWith("opencode") ? "opencode" : adapterId));
          eligibility[adapterId] = { ...check, installed: adapter?.available, authenticated: adapter?.authenticated };
          if (check.ok) candidates.push(adapterId);
        }
        const claudeCatalog = readClaudeModelsImpl();
        // Cache-only resolve — never probeClaudeModelEntitlement* from snapshot().
        const claudeEntitlement = markStaleEntitlements(resolveClaudeEntitlements({
          cache: entitlementCache,
          subscriptionType: claudeAuth?.subscriptionType ?? null,
          ...accountIdentity(claudeAuth),
          catalogIds: (claudeCatalog.models ?? []).map((m) => m.id),
          now: now(),
          ttlMs: deps.claudeEntitlementTtlMs ?? DEFAULT_ENTITLEMENT_TTL_MS
        }));
        const catalogsByAdapter = {
          codex: codexCatalog?.models ?? [],
          claude: claudeCatalog.models,
          "opencode-go": opencodeGoCatalog?.models ?? [],
          // "auto" is a real, opaque, manual-only fallback — never scored,
          // recommended, or auto-selected as if it were a real, checkable
          // named model (see cursor-models.js's own doc).
          cursor: (cursorCatalog?.models ?? []).filter((model) => !isCursorAutoModel(model.id))
        };
        // Cursor's own real access, per pool, from PERSISTED evidence only.
        // Discovery never spawns a provider probe: a fresh cache entry is
        // reused, a stale one is unverified ("stale"), and real probing only
        // happens through the explicit, confirmed verifyAccess() entry point.
        // Projected into the shared ENTITLEMENT vocabulary so it plugs into
        // the exact same per-model gating Claude's own entitlement already
        // uses (buildCompleteCandidateCatalog's DENIED/UNVERIFIED filtering,
        // project-router.js's blockingEntitlement) — never a second mechanism.
        const cursorAccess = await resolveCursorAccessFromCache({
          homeDir, cursorModels: catalogsByAdapter.cursor, now: now(), ttlMs: cursorAccessTtlMs,
          readCache: readCursorAccessCacheImpl
        });
        const cursorModelEntitlement = {};
        for (const model of catalogsByAdapter.cursor) {
          const pool = classifyCursorPool(model);
          cursorModelEntitlement[model.id] = { status: cursorStatusToEntitlement(cursorAccess[pool]?.status), reason: cursorAccess[pool]?.reason ?? null };
        }
        // Namespaced by adapter — never a flat modelId merge, which would
        // let a Cursor-proxied model silently collide with (and overwrite)
        // a Claude entry sharing the exact same raw id.
        const modelEntitlement = { claude: claudeEntitlement, cursor: cursorModelEntitlement };
        const scored = scoreAvailableModels(
          candidates.map((adapterId) => ({ adapterId, models: catalogsByAdapter[adapterId] ?? [] })),
          aa.models
        );
        // AI TEAM needs the full real capability picture — including
        // providers that are temporarily ineligible (quota exhausted, rate
        // limited) — so a preferred model never just vanishes; it's shown
        // unavailable with a real eligible fallback instead. `scored`
        // above stays eligibility-filtered for existing consumers.
        const scoredAllRaw = scoreAvailableModels(
          Object.keys(catalogsByAdapter).map((adapterId) => ({ adapterId, models: catalogsByAdapter[adapterId] ?? [] })),
          aa.models
        );
        // The Complete Candidate Catalog — every real model across every
        // real provider catalog, mapped to ModelCandidateIdentity (clean
        // modelName, accessMode, evidenceStatus, real lineage/lifecycle —
        // see model-candidate-catalog.js's own doc). Built once, from the
        // exact same real provider catalogs scoredAllRaw itself came from.
        const completeCandidateCatalog = buildCompleteCandidateCatalog(
          Object.keys(catalogsByAdapter).map((adapterId) => ({ adapterId, models: catalogsByAdapter[adapterId] ?? [] })),
          aa.models,
          { modelEntitlement }
        );
        // The Recommendation Pool: scoredAllRaw joined with its real
        // identity, with genuinely superseded generations excluded —
        // QUALITY/EFFICIENT TEAM and ProjectStrategy consume THIS, never
        // scoredAllRaw directly, so an old generation Cursor still
        // re-exposes (e.g. Claude Sonnet 4) naturally stops competing
        // without buildAiTeam/buildEfficientTeam's own ranking logic
        // needing to know why. Access-mode-manual candidates may stay in
        // it, but per-model entitlement fails closed: unverified Claude is
        // reserved for the separate explicit manual-selection pool below.
        const { recommendationPool: scoredAll, manualSelectionPool: manualSelectionScoredPool, deniedPool: deniedScoredPool } = buildScoredCandidatePools(
          scoredAllRaw,
          completeCandidateCatalog
        );
        const teamSelectionPool = buildTeamSelectionPool(scoredAllRaw, completeCandidateCatalog);
        const eligibleRecommendations = scoredAll.filter((candidate) => eligibility[candidate.adapterId]?.ok === true);
        // The Automatic Execution Pool: the real subset of scoredAll
        // Kairo could actually launch itself right now (accessMode
        // "automatic" AND real, current eligibility) — exposed for the
        // real task router (not yet built) to consume; QUALITY/EFFICIENT
        // TEAM never filter by this, only by capability/portfolio.
        const automaticExecutionPool = buildAutomaticExecutionPool(scoredAll, eligibility);
        // How much of each real catalog could even be matched to AA data —
        // independent of runtime eligibility above. A provider can be fully
        // eligible right now and still have unmatched models simply because
        // AA doesn't track them, or (Claude, today) Kairo only has a
        // documented catalog rather than a live per-account discovery.
        const coverage = summarizeCatalogCoverage([
          { adapterId: "codex", catalogStatus: codexCatalog?.status ?? "unknown", models: codexCatalog?.models ?? [], error: codexCatalog?.error ?? null },
          { adapterId: "claude", catalogStatus: claudeCatalog.status, models: claudeCatalog.models, error: claudeCatalog.error ?? null },
          { adapterId: "opencode-go", catalogStatus: opencodeGoCatalog?.status ?? "unknown", models: opencodeGoCatalog?.models ?? [], error: opencodeGoCatalog?.error ?? null },
          // Real catalog read failure surfaces here — e.g. "Authentication
          // required" when Cursor isn't authenticated, never a generic
          // "unknown" status with no explanation (see fitWhyLines()).
          { adapterId: "cursor", catalogStatus: cursorCatalog?.status ?? "unknown", models: cursorCatalog?.models ?? [], error: cursorCatalog?.error ?? null }
        ], aa.models);
        // Real catalog models that exist but couldn't be matched to any
        // real Artificial Analysis data — shown honestly as UNSCORED in
        // /models --evidence instead of just vanishing with no trace.
        // Derived directly from the Complete Candidate Catalog's own real
        // evidenceStatus — model-intelligence.js's old listUnscoredModels
        // duplicated this exact same real AA-match check separately; this
        // catalog replaces it as the one real source of truth.
        const toUnscoredRow = (candidate) => ({
          adapterId: candidate.adapterId, modelId: candidate.modelId, displayName: candidate.rawDisplayName,
          candidateKey: candidate.candidateKey, accessMode: candidate.accessMode, lifecycle: candidate.lifecycle,
          entitlement: candidate.entitlement, entitlementReason: candidate.entitlementReason
        });
        // Analyst picker only: the same unscored set but keeping UNVERIFIED
        // access (selectable with revalidation, manual view). DENIED stays out.
        // `unscoredModels` below is untouched, so /models --evidence and the
        // team edit catalog keep hiding unverified models.
        const analystUnscoredModels = completeCandidateCatalog
          .filter((candidate) => (
            candidate.evidenceStatus === "unscored"
            && candidate.lifecycle !== "superseded"
            && candidate.entitlement !== ENTITLEMENT.DENIED
          ))
          .map(toUnscoredRow);
        const unscoredModels = completeCandidateCatalog
          // Same "not superseded" real rule the Recommendation Pool
          // applies to SCORED candidates (buildRecommendationPool) — an
          // unscored candidate with a real, proven newer same-lineage
          // successor is exactly as stale as a scored one would be, and
          // must never surface in /models --evidence's UNSCORED list or
          // the projectTeam edit catalog as if it were still current.
          // "Unavailable" (denied OR unverified) means absent here too —
          // this exact array is what aiTeamDetailLines() (/models
          // --evidence) renders directly, unfiltered by anything else.
          .filter((candidate) => (
            candidate.evidenceStatus === "unscored"
            && candidate.lifecycle !== "superseded"
            && !BLOCKED_ENTITLEMENTS.has(candidate.entitlement)
          ))
          .map(toUnscoredRow);

        // The Model Intelligence Foundation registry: every source Kairo
        // has (AA, Hugging Face scoped to Go, manufacturer snapshots,
        // Kairo's own real run telemetry) collected with provenance, not
        // blended into AI TEAM's ranking math — Terminal-Bench and AA's
        // codingIndex aren't the same measurement, and averaging them would
        // violate the registry's own no-blending contract. Instead it's
        // surfaced as corroborating evidence alongside each pick (see
        // annotateWithRegistryEvidence), so AI TEAM's actual decision stays
        // exactly the real-metric ranking it already was, while /models can
        // now also show what else is known about the chosen model.
        const registry = createCapabilityRegistry();
        ingestArtificialAnalysisEvidence(
          registry, Object.keys(catalogsByAdapter).map((adapterId) => ({ adapterId, models: catalogsByAdapter[adapterId] ?? [] })),
          aa.models, { fetchedAt: aa.fetchedAt ?? new Date().toISOString() }
        );
        const hle = await readHuggingFaceLeaderboardCached("cais/hle", "cais/hle").catch(() => null);
        if (hle?.entries?.length) {
          ingestHuggingFaceLeaderboardEvidence(
            registry, [{ adapterId: "opencode-go", models: catalogsByAdapter["opencode-go"] ?? [] }],
            // scale: "hundred" — verified live against the real HF cache
            // (cais/hle): DeepSeek-V4.1-Flash's real reported value is
            // 63.9, not a 0-1 fraction. AA's own "hle" field IS a real 0-1
            // fraction, so the two sources genuinely disagree on scale
            // despite sharing the metric name "hle" — see
            // model-capability-registry-sources.js's own doc for the bug
            // this fixes.
            hle.entries, { metric: "hle", scale: "hundred", fetchedAt: hle.fetchedAt }
          );
        }
        ingestOfficialSnapshotEvidence(registry);
        try {
          const outcomes = await readEffortOutcomes(new URL("../../../scripts/effort-eval/outcome-tasks/results.jsonl", import.meta.url));
          ingestEffortOutcomeEvidence(registry, outcomes);
        } catch { /* Optional local priors must not interrupt team formation. */ }
        const runRecords = await listRunRecordsCached("runs", null).catch(() => []);
        ingestKairoTelemetryEvidence(registry, runRecords);
        // S47: measured per-role cost and volume from session transcripts plus attributed Kairo runs.
        // A telemetry failure must never break preflight: no roleTelemetry means today's behavior.
        let roleTelemetry = null;
        try {
          const sessions = await readSessionTelemetryBounded();
          const outcomes = await readOutcomeRecords(homeDir, projectRoot).catch(() => []);
          const records = [...outcomes, ...(sessions?.records ?? []), ...(runRecords ?? []).map(kairoRunToTelemetryRecord).filter(Boolean)];
          const built = records.length ? buildRoleTelemetry(records, teamSelectionPool) : null;
          if (built && (Object.keys(built.roles).length || built.volumes)) roleTelemetry = built;
        } catch { roleTelemetry = null; }
        // Provider quota is a PROVIDER-level fact, never copied into the
        // per-model capability registry as if it were model evidence — see
        // subscription-pressure-source.js. buildEfficientTeam resolves it
        // separately, by adapterId: before public price for near-equivalent
        // Builder/Explorer candidates, otherwise as its last tiebreak.
        const providerCapacity = buildProviderCapacity(remainingPercentByAdapter(codexUsage, claudeUsage, opencodeUsage), { codex: codexUsage, claude: claudeUsage, "opencode-go": opencodeUsage?.go });

        result.modelIntelligence = {
          status: aa.status, source: aa.source, age: aa.age,
          models: annotateWithRegistryEvidence(scored, registry), roles: bestModelPerRole(eligibleRecommendations),
          eligibility, coverage, unscoredModels, analystUnscoredModels,
          // Resolved Claude per-model entitlement (cache-only; never probed here).
          claudeEntitlement,
          // Real, per-pool Cursor access — a real minimal probe, never a
          // human toggle. `modelEntitlement` (claude + cursor, shared
          // ENTITLEMENT vocabulary) is the internal per-model gate
          // completeCandidateCatalog/routeProjectExecution actually use;
          // `cursorAccess` (pool-level) is what the UI reads for real,
          // human-readable Cursor-specific status text.
          cursorAccess, modelEntitlement,
          // Concrete, never-executed verification plan (T23): which checks
          // are pending per subscription and which are reusable.
          verificationPlan: buildAccessVerificationPlan({
            eligibility, claudeModels: claudeCatalog.models ?? [], claudeEntitlement,
            cursorModels: catalogsByAdapter.cursor, cursorAccess, teamProviders
          }),
          // BEST FIT GLOBAL / EFFICIENT GLOBAL: the honest, uncoordinated
          // per-role winner — never cedes a role for portfolio diversity,
          // family concentration, or provider distribution (see
          // bestModelPerRoleGlobal's own header for why that coordination
          // belongs to PROJECT TEAM alone, not a "what's genuinely best"
          // question). This is the real fix for the reported bug: the
          // dashboard widget was showing aiTeam/efficientTeam (coordinated,
          // portfolio-aware) as if it were this uncoordinated global view,
          // which could silently show a real diversity pick (e.g. Muse
          // Spark) as "the best Architect" when it only won because Astra
          // had already been used elsewhere.
          globalGuide: {
            capability: bestModelPerRoleGlobal(scoredAll, eligibility, registry),
            efficient: bestEfficientModelPerRoleGlobal(scoredAll, eligibility, registry, { providerCapacity })
          },
          // Kept temporarily as compatibility aliases for existing callers
          // — PROJECT TEAM (the real, coordinated-portfolio result) once a
          // project has actually been analyzed; today's callers still read
          // these as the global view until the cockpit widget migrates.
          aiTeam: buildAiTeam(teamSelectionPool, eligibility, registry, undefined, { teamProviders, providerCapacity, ownedEvidenceStore, accountKey: ownedEvidenceAccountKey, roleTelemetry }),
          efficientTeam: buildEfficientTeam(teamSelectionPool, eligibility, registry, { teamProviders, providerCapacity, ownedEvidenceStore, accountKey: ownedEvidenceAccountKey, roleTelemetry }),
          // Raw ingredients (never rendered directly) so a caller that
          // needs a PROJECT-specific re-scoring (see analyzeProject below)
          // can call buildAiTeam/buildEfficientTeam again with the
          // project's own real roleCapabilities, instead of only ever
          // filtering the generic global team by role name. `scoredAll`
          // here is the entitlement-safe Recommendation Pool (superseded,
          // denied, and unverified Claude already excluded), not the raw
          // scoreAvailableModels() output
          // — see scoredAllRaw/completeCandidateCatalog above.
          scoredAll, manualSelectionScoredPool, deniedScoredPool, registry, providerCapacity,
          // Present only when measured data exists, so a no-telemetry snapshot keeps its exact key set.
          ...(roleTelemetry ? { roleTelemetry } : {}),
          // The real subset Kairo can actually launch itself — exposed
          // for the real task router (not yet built) to consume; never
          // used by QUALITY/EFFICIENT TEAM or ProjectStrategy, which only
          // ever filter by capability/portfolio, never by accessMode.
          automaticExecutionPool
        };
        teamSelectionPools.set(result, teamSelectionPool);
        // Catalog presence is independent of scoring and model entitlement.
        structuralCatalogs.set(result, Object.entries(catalogsByAdapter).flatMap(([adapterId, models]) =>
          (Array.isArray(models) ? models : []).map(() => ({ adapterId }))));
        // Publish only complete refreshed inputs for an approved team. Keep
        // selection and gate policy shared with routeProjectExecution (T3).
        if (projectStrategyResult?.status === "active" && projectStrategyResult.approvedAt) {
          const roles = Object.fromEntries((projectStrategyResult.projectTeam ?? []).map(({ role }) => [role, {
            pool: qualifiedRolePool({ role, models: scoredAll, eligibility, registry, roleCapabilities: projectStrategyResult.roleCapabilities,
              roleCatalog: loadProjectRoleCatalogImpl({ projectRoot }) }).all
          }]));
          try {
            await (deps.writeRoutingInputCache ?? writeRoutingInputCache)(homeDir, projectRoot, {
              generatedAt: now(), approvedAt: projectStrategyResult.approvedAt, roles,
              eligibility, modelEntitlement, providerCapacity, models: scoredAll, registry
            });
          } catch (error) {
            // A cache failure must not interrupt normal project use. Explicit
            // refresh reports it rather than claiming the cache was rebuilt.
            result.routingInputCacheError = error.message;
          }
        }
      }
      return result;
    },
    async refreshRoutingInputs({ cwd }) {
      const projectRoot = await root(cwd);
      const strategy = await readProjectStrategyImpl(homeDir, projectRoot);
      if (strategy?.status !== "active" || !strategy.projectTeam?.length || !strategy.approvedAt) {
        throw new Error("No approved team for this project. Analyze and approve a project team first.");
      }
      for (const probe of [readCodexUsageCached, readClaudeUsageCached, readOpenCodeUsageCached,
        readOpenCodeGoCached, readOpenCodeStatsCached, readCodexModelsCached, readOpenCodeGoModelsCached,
        readCursorModelsCached, readArtificialAnalysisModelsCached, readClaudeEntitlementCacheCached,
        verifyClaudeSubscriptionAuthCached, readHuggingFaceLeaderboardCached, listRunRecordsCached]) probe.invalidate();
      const snap = await this.snapshot({ cwd: projectRoot });
      if (snap.routingInputCacheError) throw new Error(snap.routingInputCacheError);
      if (!enableProviderProbes) throw new Error("Routing refresh requires model intelligence probes.");
      // A structural change (role set, teamProviders, a provider's install/login/catalog)
      // re-forms the active team here, without approval. Quota never does. A failed
      // re-form leaves the previous team serving and never fails the refresh.
      let reform = null;
      let reformError = null;
      let providerStates = null;
      try {
        const providerIds = (await teamProvidersFor(projectRoot)).filter(id => PROVIDER_IDS.includes(id));
        providerStates = await providerStatus({ providerIds });
      } catch { /* Preserve existing eligibility when status is unavailable. */ }
      try {
        const result = await this.reformTeamOnStructuralChange({ projectRoot, snapshot: snap, providerStates });
        if (result.outcome === "reformed") reform = result.entry;
      } catch (error) { reformError = error.message; }
      if (reform) {
        // The routing cache is bound to the approval: write it again for the re-formed team.
        const refreshed = await this.snapshot({ cwd: projectRoot });
        if (refreshed.routingInputCacheError) throw new Error(refreshed.routingInputCacheError);
        return { refreshed: true, approvedAt: refreshed.projectStrategy.approvedAt, reform };
      }
      return { refreshed: true, approvedAt: snap.projectStrategy.approvedAt, ...(reformError ? { reformError } : {}) };
    },
    /**
     * Automatic structural re-form of the ACTIVE team (see runStructuralReform in
     * team-recovery.js). The team is rebuilt from the stored analysis with today's
     * catalog roles, teamProviders and provider availability, activated without a
     * human approval, and recorded with timestamp, reasons and before/after roles
     * in the team-reform log. The first formation still needs approval: a missing
     * or suggested strategy is never touched.
     */
    async reformTeamOnStructuralChange({ projectRoot, snapshot = null, providerStates = null }) {
      const snap = snapshot ?? await this.snapshot({ cwd: projectRoot });
      const intelligence = snap.modelIntelligence ?? {};
      const structuralEligibility = { ...intelligence.eligibility };
      for (const provider of providerStates?.providers ?? []) {
        const current = structuralEligibility[provider.providerId];
        if (!current) continue;
        const installed = provider.installation?.state === "missing" ? false
          : provider.installation?.state === "installed" ? true : current.installed;
        const authenticated = provider.authentication?.state === "unauthenticated" ? false
          : provider.authentication?.state === "authenticated" ? true : current.authenticated;
        structuralEligibility[provider.providerId] = {
          ...current, installed, authenticated,
          ...(installed === false || authenticated === false ? { ok: false, limit: undefined } : {})
        };
      }
      return runStructuralReform({
        readStrategy: () => readProjectStrategyImpl(homeDir, projectRoot),
        writeStrategy: (strategy) => writeProjectStrategyImpl(homeDir, projectRoot, strategy),
        readLog: () => readTeamReformImpl(homeDir, projectRoot),
        writeLog: (log) => writeTeamReformImpl(homeDir, projectRoot, log),
        acquireLock: () => acquireProjectAnalysisLockImpl(homeDir, projectRoot, { owner: "automatic-reform" }),
        currentStructure: async () => {
          const stored = await readProjectStrategyImpl(homeDir, projectRoot);
          const { requirements } = await currentRoleRequirements(projectRoot, stored);
          return structuralSnapshot({
            roles: requirements.map(entry => entry.role), teamProviders: await teamProvidersFor(projectRoot),
            eligibility: structuralEligibility, models: structuralCatalogs.get(snap) ?? intelligence.scoredAll ?? []
          });
        },
        form: ({ strategy }) => formFromStored(this, projectRoot, strategy, providerStates).then(({ rebuilt }) => rebuilt),
        now
      });
    },
    async submitArchitecture({ cwd, task, model = null }) {
      const projectRoot = await root(cwd);
      const result = await createPlan({ cwd: projectRoot, task, model });
      return { ...publicPlan(result.status), reused: result.reused === true, projectRoot };
    },
    /**
     * Read-only team query for one explicit project: roles with assigned
     * provider/model, per-provider installed/launchable, eligibility and
     * blocked reason, plus tasks with states and result pointers. Composes
     * `snapshot` (same facts the cockpit/Pi show); it never selects a team,
     * writes a strategy, or launches a run.
     * @param {{cwd: string}} args
     */
    async readTeam({ cwd }) {
      const snap = await this.snapshot({ cwd });
      const adapters = inspectAdapters({ cwd: snap.projectRoot });
      const intelligence = snap.modelIntelligence ?? {};
      const strategy = snap.projectStrategy ?? null;
      const providers = adapters.map((adapter) => ({
        id: adapter.id, label: adapter.label, installed: adapter.available === true,
        launchable: adapter.launchable === true, reason: adapter.reason ?? null,
        eligibility: intelligence.eligibility?.[adapter.id] ?? null
      }));
      const entries = strategy ? [
        ["Project Analyst", strategy.bootstrapAnalyst ?? null],
        ...(activeHost.id || strategy.orchestrator?.source === "host" ? [] : [["Orchestrator", strategy.orchestrator ?? null]]),
        ...(strategy.projectTeam ?? []).map((entry) => [entry?.role ?? "Unknown role", entry?.model ?? null])
      ] : [];
      const roles = await Promise.all(entries.map(async ([role, model]) => {
        if (!activeHost.id) return teamRole(role, model, providers, intelligence);
        let route = null;
        if (strategy.projectTeam?.some(entry => entry.role === role)) {
          try { route = await readTeamRoute({ role, cwd: snap.projectRoot, homeDir, activeHost }); }
          catch (error) { route = { model: null, why: error.message }; }
        }
        const compatible = model && hostAllowsProvider(activeHost, model.adapterId);
        const selected = route ? route.decision === 'ROUTED' ? route.model : null : compatible ? model : null;
        const row = teamRole(role, selected, providers, intelligence);
        return !selected ? { ...row, blockedReason: route?.why ?? `No compatible assignment for active host ${activeHost.id}.` } : row;
      }));
      return {
        schema: CONVERSATION_SCHEMA,
        projectRoot: snap.projectRoot,
        state: strategy ? (strategy.status ?? "unknown") : "not_analyzed",
        ...(activeHost.id ? { host: activeHost } : {}),
        roles,
        providers,
        tasks: await taskRows(snap.projectRoot, snap.timeline)
      };
    },
    /**
     * Light read-only view of the work in one explicit project: its sessions
     * and tasks (with run evidence and pending transitions). Same projection
     * as `readTeam().tasks`, without the provider probes or usage reads, so a
     * host can refresh it on every render. Never launches, writes or selects.
     * @param {{cwd: string}} args
     */
    async readWork({ cwd }) {
      const projectRoot = await root(cwd);
      const timeline = await projectedPlans(projectRoot);
      return {
        projectRoot,
        tasks: await taskRows(projectRoot, timeline)
      };
    },
    /**
     * Read-only raw facts for the setup projection (operations/setup-*): adapter
     * install state, per-provider access evidence (Claude entitlement, Cursor
     * access), eligibility, the analyst catalog, the persisted strategy, the
     * edit catalog per role of a SUGGESTED strategy and the recovery record.
     * Never selects a team, probes a provider, writes or launches anything.
     * @param {{cwd: string}} args
     */
    async readSetup({ cwd, analystMode = null }) {
      const snap = await this.snapshot({ cwd });
      const setupProviders = await teamProvidersFor(snap.projectRoot);
      const intelligence = snap.modelIntelligence ?? {};
      const strategy = snap.projectStrategy ?? null;
      const {
        scoredAll = [], manualSelectionScoredPool = scoredAll, eligibility = {}, registry = null, unscoredModels = []
      } = intelligence;
      const editCatalogs = {};
      if (strategy?.status === "suggested") {
        for (const entry of strategy.projectTeam ?? []) {
          editCatalogs[entry.role] = computeProjectTeamEditCatalog(entry.role, {
            scoredAll, manualSelectionScoredPool, eligibility, registry, unscoredModels, teamProviders: setupProviders
          }).models;
        }
      }
      const record = await readAvailabilityRecoveryImpl(homeDir, snap.projectRoot).catch(() => null);
      const manual = await readPendingTeamProposalImpl(homeDir, snap.projectRoot).catch(() => null);
      let base = null;
      let baseCheckFailed = false;
      if (manual || (record?.outcome === "proposed")) {
        try {
          base = await readProjectStrategyImpl(homeDir, snap.projectRoot);
        } catch {
          baseCheckFailed = true;
        }
      }
      const recovery = describeSetupRecovery({ record, manual, base, baseCheckFailed });
      return {
        projectRoot: snap.projectRoot,
        adapters: inspectAdapters({ cwd: snap.projectRoot }),
        eligibility,
        providerCapacity: intelligence.providerCapacity ?? {},
        claudeEntitlement: intelligence.claudeEntitlement ?? {},
        cursorAccess: intelligence.cursorAccess ?? {},
        knownCandidates: [...manualSelectionScoredPool, ...unscoredModels].map((model) => ({
          candidateKey: model.candidateKey ?? `${model.adapterId}::${model.modelId}`,
          adapterId: model.adapterId, modelId: model.modelId, entitlement: model.entitlement ?? null,
          accessType: model.accessType ?? null, estimatedAnalysisCost: model.estimatedAnalysisCost ?? null
        })),
        analystCatalog: analystMode === 'manual' ? buildManualAnalystCatalog(intelligence, setupProviders) : analystCatalogFor(intelligence, setupProviders),
        // The existing read-only plan (pending vs reusable checks); never executed here.
        verificationPlan: intelligence.verificationPlan ?? EMPTY_VERIFICATION_PLAN,
        strategy,
        editCatalogs,
        recovery
      };
    },
    /**
     * ProjectOverlay / ratatui picker preflight: computes a real, read-only
     * ProjectProfile (full mode) and the full analyst catalog. No bootstrap
     * provider call or strategy persistence occurs; the human selects and
     * confirms a catalog entry before analysis runs.
     *
     * @param {{ cwd: string, mode?: "full"|"catalog" }} args
     *   `mode: "catalog"` skips `computeProjectProfile` so the ratatui
     *   picker can open after a single snapshot (usage/catalog/auth probes).
     *   Analyze always uses `mode: "full"` (or omits mode) so profile exists.
     */
    async preflightProject({ cwd, mode = "full", analystMode = null } = {}) {
      const projectRoot = await root(cwd);
      const catalogOnly = mode === "catalog";
      const preflightProviders = await teamProvidersFor(projectRoot);
      // profile (local git/Graphify read) and snapshot (usage/catalog/auth/
      // cursor provider probes) are independent I/O — started together in
      // full mode. Catalog-only mode skips profile so the picker modal is
      // bounded by snapshot wall time alone (analyze re-runs full preflight).
      const [profile, snap] = catalogOnly
        ? [null, await this.snapshot({ cwd: projectRoot })]
        : await Promise.all([
            computeProjectProfileImpl({ cwd: projectRoot }),
            this.snapshot({ cwd: projectRoot })
          ]);
      const {
        scoredAll = [], manualSelectionScoredPool = scoredAll, deniedScoredPool = [], eligibility = {}, registry = null,
        providerCapacity = null, roleTelemetry = null, unscoredModels = [], analystUnscoredModels = unscoredModels,
        claudeEntitlement = {}, cursorAccess = {}, verificationPlan = EMPTY_VERIFICATION_PLAN
      } = snap.modelIntelligence ?? {};
      const quotaSamples = Object.fromEntries(await Promise.all(
        Object.keys(providerCapacity ?? {}).map(async provider => [provider,
          await (deps.readUsageSamples ?? readUsageSamples)(homeDir, provider, { now })])
      ));
      const candidates = { now: now(), quotaSamples, scoredAll, structuralCatalog: structuralCatalogs.get(snap), teamSelectionPool: teamSelectionPools.get(snap) ?? scoredAll, eligibility, registry, providerCapacity, roleTelemetry, claudeEntitlement, cursorAccess, ownedEvidenceStore, ownedEvidenceAccountKey };
      const analystCatalog = analystMode === 'manual' ? buildManualAnalystCatalog(snap.modelIntelligence, preflightProviders) : analystCatalogFor(snap.modelIntelligence, preflightProviders);
      const unverifiedCount = Object.values(claudeEntitlement).filter(
        (entry) => entry?.status === ENTITLEMENT.UNVERIFIED
      ).length;
      const unverifiedClaudeNotice = unverifiedCount > 0
        ? buildUnverifiedClaudePreflightNotice(unverifiedCount)
        : null;
      return { profile, candidates, analystCatalog, projectRoot, unverifiedClaudeNotice, verificationPlan };
    },
    /**
     * `/models --verify-access [--refresh]`: the only service path that
     * spawns `probeClaudeModelEntitlements`. Without refresh, only
     * unverified / TTL-expired catalog ids are probed; with refresh, every
     * catalog id is probed (still capped at maxProbes=12). Persist only when
     * at least one allowed/denied result exists — an all-unverified sweep
     * never invents evidence on disk.
     *
     * @param {object} args
     * @param {string} args.cwd
     * @param {boolean} [args.refresh]
     * @param {(info: { pendingCount: number, pendingIds: string[], costStatement: string }) => (void|Promise<void>)} [args.beforeProbe]
     *   Called after the probe set is known and BEFORE any spawn — app.js
     *   prints the cost statement here.
     * @param {(info: { modelId: string, index: number, total: number, result: object }) => void} [args.onProgress]
     */
    async verifyClaudeEntitlements({ cwd, refresh = false, beforeProbe = null, onProgress = null } = {}) {
      const projectRoot = cwd ? await root(cwd) : null;
      const catalog = readClaudeModelsImpl();
      const catalogIds = (catalog.models ?? []).map((m) => m.id).filter(Boolean);
      let auth = null;
      try {
        auth = await verifyClaudeSubscriptionAuthImpl({});
      } catch {
        auth = null;
      }
      const subscriptionType = auth?.subscriptionType ?? null;
      const cache = await readClaudeEntitlementCacheImpl(homeDir);
      const nowMs = now();
      const ttlMs = deps.claudeEntitlementTtlMs ?? DEFAULT_ENTITLEMENT_TTL_MS;
      const resolved = resolveClaudeEntitlements({
        cache,
        subscriptionType,
        ...accountIdentity(auth),
        catalogIds,
        now: nowMs,
        ttlMs
      });
      const pendingIds = (refresh
        ? catalogIds
        : catalogIds.filter((id) => resolved[id]?.status === ENTITLEMENT.UNVERIFIED && resolved[id]?.limit !== "temporary")
      ).slice(0, CLAUDE_ENTITLEMENT_MAX_PROBES);
      const costStatement = buildClaudeEntitlementVerifyCostStatement({ pendingCount: pendingIds.length });
      if (typeof beforeProbe === "function") {
        await beforeProbe({ pendingCount: pendingIds.length, pendingIds, costStatement });
      }
      if (pendingIds.length === 0) {
        return {
          probed: [],
          results: [],
          costStatement,
          persisted: false,
          pendingCount: 0,
          refresh: Boolean(refresh),
          subscriptionType
        };
      }
      const results = await probeClaudeModelEntitlementsImpl({
        modelIds: pendingIds,
        maxProbes: CLAUDE_ENTITLEMENT_MAX_PROBES,
        cwd: projectRoot ?? process.cwd(),
        onProgress
      });
      const hasPersistable = results.some(isPersistableEntitlementResult);
      let persisted = false;
      if (hasPersistable) {
        const merged = mergeEntitlementResultsImpl(cache, { subscriptionType, ...accountIdentity(auth), results });
        await writeClaudeEntitlementCacheImpl(homeDir, merged);
        persisted = true;
        // The very next snapshot() in this same session must see this real
        // result immediately, never the pre-verification read cached for
        // up to claudeEntitlementCacheTtlMs (10 minutes by default).
        readClaudeEntitlementCacheCached.invalidate();
      }
      return {
        probed: pendingIds,
        results,
        costStatement,
        persisted,
        pendingCount: pendingIds.length,
        refresh: Boolean(refresh),
        subscriptionType
      };
    },
    /**
     * The concrete, read-only verification plan (T23): pending vs reusable
     * checks per subscription and whether running them may consume quota.
     * Built from persisted evidence only — nothing is probed here.
     * @param {{cwd: string}} args
     */
    async planAccessVerification({ cwd } = {}) {
      const snap = await this.snapshot({ cwd: await root(cwd) });
      return snap.modelIntelligence?.verificationPlan ?? EMPTY_VERIFICATION_PLAN;
    },
    /**
     * The explicit, confirmed verification entry point (T23) and the ONLY
     * place discovery-time probes can run. Executes each pending check of
     * `planAccessVerification` at most once (Claude per model, Cursor per
     * pool), persists only real allowed/denied results through the existing
     * stores, and reports a per-subscription outcome. Never invents a
     * result, never substitutes another provider; a probe that throws or
     * cannot decide is `unverified` with its real reason.
     * `onProgress` (optional, additive) receives
     * `{completed, total, active: [{id, label, adapterId, provider}], done: null|{id, label, adapterId, provider, status, reason}}`:
     * once when the run starts, then once per finished check. `total` counts
     * pending checks only (reusable evidence makes no call). A throwing
     * listener never affects the run.
     * @param {{cwd: string, confirmed?: boolean, onProgress?: (event: object) => void}} args
     * @returns {Promise<{ran: boolean, status: "confirmation_required"|"verified", message?: string, persisted?: boolean, outcomes: Array<object>}>}
     */
    async verifyAccess({ cwd, confirmed, onProgress = null } = {}) {
      if (confirmed !== true) {
        return {
          ran: false, status: "confirmation_required", outcomes: [],
          message: "Access verification calls the providers and may consume quota — it only runs after explicit confirmation. Nothing was run."
        };
      }
      const projectRoot = await root(cwd);
      const plan = await this.planAccessVerification({ cwd: projectRoot });
      const verifyProviders = await teamProvidersFor(projectRoot);
      const outcomes = [];
      let persisted = false;
      // Progress: counts only the checks this run will really make.
      const runnable = plan.subscriptions.filter((sub) => verifyProviders.includes(sub.adapterId));
      const total = runnable.reduce((sum, sub) => sum + sub.checks.filter((check) => check.state === "pending").length, 0);
      let completed = 0;
      const refOf = (subscription, check) => ({ id: check.id, label: check.label, adapterId: subscription.adapterId, provider: subscription.provider });
      const emit = (active, done) => {
        if (typeof onProgress !== "function") return;
        try { onProgress({ completed, total, active, done }); } catch { /* a listener never breaks verification */ }
      };
      const reported = new Set();
      const finish = (subscription, check, status, reason, nextActive) => {
        if (reported.has(check.id)) return;
        reported.add(check.id);
        completed += 1;
        emit(nextActive, { ...refOf(subscription, check), status, reason: reason ?? null });
      };
      for (const subscription of runnable) {
        const pending = subscription.checks.filter((check) => check.state === "pending");
        if (pending.length === 0) continue;
        let results;
        if (subscription.adapterId === "claude") {
          const ids = pending.map((check) => check.modelId);
          const checkByModel = new Map(pending.map((check) => [check.modelId, check]));
          emit([refOf(subscription, pending[0])], null);
          // The next Claude model (sequential probes) is the active one.
          const nextClaude = (modelId) => {
            const index = pending.findIndex((check) => check.modelId === modelId);
            const upcoming = pending[index + 1];
            return upcoming ? [refOf(subscription, upcoming)] : [];
          };
          let probed;
          try {
            probed = await probeClaudeModelEntitlementsImpl({
              modelIds: ids, maxProbes: CLAUDE_ENTITLEMENT_MAX_PROBES, cwd: projectRoot,
              onProgress: ({ modelId, result } = {}) => {
                const check = checkByModel.get(modelId);
                if (check) finish(subscription, check, result?.status ?? ENTITLEMENT.UNVERIFIED, result?.reason ?? null, nextClaude(modelId));
              }
            });
          } catch (error) {
            probed = ids.map((modelId) => ({ modelId, status: ENTITLEMENT.UNVERIFIED, reason: error?.message ?? String(error) }));
          }
          const byModel = new Map((Array.isArray(probed) ? probed : []).map((result) => [result?.modelId, result]));
          const persistable = [];
          results = pending.map((check) => {
            const real = byModel.get(check.modelId);
            const status = real?.status ?? ENTITLEMENT.UNVERIFIED;
            if (isPersistableEntitlementResult(real)) persistable.push(real);
            const reason = real ? (real.reason ?? null) : "The probe returned no result for this model";
            // Probes that did not report live are reported now, in order.
            finish(subscription, check, status, reason, nextClaude(check.modelId));
            return { id: check.id, label: check.label, modelId: check.modelId, status, reason };
          });
          if (persistable.length > 0) {
            let auth = null;
            try { auth = await verifyClaudeSubscriptionAuthImpl({}); } catch { auth = null; }
            const subscriptionType = auth?.subscriptionType ?? null;
            const cache = await readClaudeEntitlementCacheImpl(homeDir);
            await writeClaudeEntitlementCacheImpl(homeDir, mergeEntitlementResultsImpl(cache, { subscriptionType, ...accountIdentity(auth), results: persistable }));
            readClaudeEntitlementCacheCached.invalidate();
            persisted = true;
          }
        } else if (subscription.adapterId === "cursor") {
          // Cursor pools run concurrently: every pending pool is active at once.
          let inFlight = pending.map((check) => refOf(subscription, check));
          emit(inFlight, null);
          const probed = await Promise.all(pending.map(async (check) => {
            let real;
            try {
              real = await probeCursorPoolAccessImpl({ pool: check.pool, modelId: check.modelId, cwd: projectRoot });
            } catch (error) {
              real = { pool: check.pool, status: CURSOR_ACCESS_STATUS.UNVERIFIED, reason: error?.message ?? String(error) };
            }
            inFlight = inFlight.filter((ref) => ref.id !== check.id);
            finish(subscription, check, cursorStatusToEntitlement(real?.status), real?.reason ?? null, [...inFlight]);
            return real;
          }));
          const cacheRead = await readCursorCacheForMerge();
          let cache = cacheRead.cache;
          const before = cache;
          const identity = probed.some((real) => cursorStatusToEntitlement(real?.status) !== ENTITLEMENT.UNVERIFIED) ? await cursorIdentity() : {};
          results = pending.map((check, index) => {
            const real = probed[index];
            const status = cursorStatusToEntitlement(real?.status);
            if (status !== ENTITLEMENT.UNVERIFIED) cache = mergeCursorAccessResult(cache, real, identity);
            return { id: check.id, label: check.label, pool: check.pool, modelId: check.modelId, status, reason: real?.reason ?? null };
          });
          if (cache !== before && cacheRead.ok) {
            try {
              await writeCursorAccessCacheImpl(homeDir, cache);
              persisted = true;
            } catch {
              // evidence stays in memory only; `persisted` stays false
            }
          }
        } else {
          continue;
        }
        outcomes.push({
          adapterId: subscription.adapterId, provider: subscription.provider, granularity: subscription.granularity,
          results,
          counts: {
            allowed: results.filter((r) => r.status === ENTITLEMENT.ALLOWED).length,
            denied: results.filter((r) => r.status === ENTITLEMENT.DENIED).length,
            unverified: results.filter((r) => r.status === ENTITLEMENT.UNVERIFIED).length
          }
        });
      }
      return { ran: true, status: "verified", persisted, outcomes };
    },
    /**
     * T20: on-demand access check for ONE analyst model the human just
     * confirmed whose access is UNVERIFIED. Runs the real provider probe for
     * that model only (Claude: one `claude -p` entitlement probe, about one
     * cent when allowed; Cursor: one minimal `cursor-agent -p` probe of the
     * model's own pool, bypassing the snapshot cooldown), persists a real
     * allowed/denied result exactly like the snapshot/verify paths do, and
     * never persists or reports "allowed" for anything it could not decide.
     * Fail-closed: any other adapter, a thrown probe, or an undecidable
     * result is UNVERIFIED with the real reason (never invented quota).
     * @param {{cwd?: string, model: {adapterId: string, modelId: string, displayName?: string}}} args
     * @returns {Promise<{status: "allowed"|"denied"|"unverified", reason: string|null}>}
     */
    async verifyAnalystAccess({ cwd, model } = {}) {
      const adapterId = model?.adapterId ?? null;
      const modelId = model?.modelId ?? null;
      if (!adapterId || !modelId) return { status: ENTITLEMENT.UNVERIFIED, reason: "No analyst model to verify" };
      try {
        const projectRoot = cwd ? await root(cwd) : process.cwd();
        if (adapterId === "claude") {
          const [result] = await probeClaudeModelEntitlementsImpl({ modelIds: [modelId], maxProbes: 1, cwd: projectRoot });
          const status = result?.status ?? ENTITLEMENT.UNVERIFIED;
          if (isPersistableEntitlementResult(result)) {
            let auth = null;
            try { auth = await verifyClaudeSubscriptionAuthImpl({}); } catch { auth = null; }
            const subscriptionType = auth?.subscriptionType ?? null;
            const cache = await readClaudeEntitlementCacheImpl(homeDir);
            await writeClaudeEntitlementCacheImpl(homeDir, mergeEntitlementResultsImpl(cache, { subscriptionType, ...accountIdentity(auth), results: [result] }));
            readClaudeEntitlementCacheCached.invalidate();
            if (status === ENTITLEMENT.UNVERIFIED) return { status, reason: result?.reason ?? null, limit: "temporary" };
            return { status, reason: result.reason ?? null };
          }
          return { status: ENTITLEMENT.UNVERIFIED, reason: result?.reason ?? "Claude access probe returned no decision" };
        }
        if (adapterId === "cursor") {
          const pool = classifyCursorPool({ id: modelId, displayName: model.displayName });
          const probed = await probeCursorPoolAccessImpl({ pool, modelId, cwd: projectRoot });
          const status = cursorStatusToEntitlement(probed?.status);
          if (status !== ENTITLEMENT.UNVERIFIED) {
            const cacheRead = await readCursorCacheForMerge();
            if (cacheRead.ok) {
              await writeCursorAccessCacheImpl(homeDir, mergeCursorAccessResult(cacheRead.cache, probed, await cursorIdentity())).catch(() => {});
            }
          }
          return { status, reason: probed?.reason ?? null };
        }
        return { status: ENTITLEMENT.UNVERIFIED, reason: `No on-demand access check exists for ${adapterId}` };
      } catch (error) {
        return { status: ENTITLEMENT.UNVERIFIED, reason: error?.message ?? String(error) };
      }
    },
    /**
     * ProjectOverlay's confirmed analyst step (ANALYZING -> SUGGESTED):
     * runs the human's already-confirmed real model read-only (askProvider
     * — the same real, no-file-write path ASK mode uses; never a new
     * execution surface) against the real, limited context package
     * (project-analysis.js's buildAnalystPrompt), validates its structured
     * response, and ONLY on a valid response deterministically derives
     * real role requirements and builds + persists a SUGGESTED
     * ProjectStrategy. An invalid/unparseable analyst response throws —
     * no ProjectStrategy is ever created from it.
     * @param {object} args
     * @param {string} args.cwd
     * @param {object} args.profile - from preflightProject
     * @param {object} args.candidates - from preflightProject
     * @param {{choice?: "quality"|"efficient"|null, model: object, selectionSource?: "recommended"|"manual", recommendationTags?: string[]}} args.analyst
     */
    async runBootstrapAnalysis({ cwd, profile, candidates, analyst, projectGoal = null, onProgress = null }) {
      const projectRoot = await root(cwd);
      // One analysis per project at a time: automatic team recovery takes
      // the same lock, so a manual analyze never races it (or vice versa).
      const lock = await acquireProjectAnalysisLockImpl(homeDir, projectRoot, { owner: "manual" });
      if (!lock.acquired) {
        const holder = lock.holder ? ` (started ${lock.holder.startedAt} by ${lock.holder.owner})` : "";
        throw new Error(`A project analysis is already running for this project${holder}. Wait for it to finish, then try again.`);
      }
      try {
        const active = await readProjectStrategyImpl(homeDir, projectRoot);
        // D1: with an ACTIVE team, a re-analysis never writes the strategy
        // file (so chat and in-flight runs keep the team they have). Its
        // result waits as a separate pending proposal pinned to this base.
        if (active?.status !== "active") {
          return await runLockedBootstrapAnalysis({
            projectRoot, profile, candidates, analyst, projectGoal,
            ...(typeof onProgress === "function" ? { onProgress } : {})
          });
        }
        const result = await runLockedBootstrapAnalysis({
          projectRoot, profile, candidates, analyst, projectGoal, persist: false,
          ...(typeof onProgress === "function" ? { onProgress } : {})
        });
        const { projectRoot: _root, analysis: _analysis, sanitization: _sanitization, ...strategy } = result;
        const proposal = {
          ...strategy, status: "suggested", proposedAt: new Date().toISOString(),
          proposal: { source: "manual-reanalysis" }
        };
        const basedOn = {
          profileFingerprint: active.profileFingerprint ?? null,
          approvedAt: active.approvedAt ?? null,
          hash: strategyHash(active)
        };
        const id = computeProposalId(proposal, basedOn);
        await writePendingTeamProposalImpl(homeDir, projectRoot, {
          id, source: "manual-reanalysis", createdAt: proposal.proposedAt, basedOn, proposal
        });
        return { ...result, pending: true, proposalId: id };
      } finally {
        await lock.release();
      }
    },
    /**
     * Recompute the team from the analysis already stored in the strategy
     * (roleCapabilities, demandAssessment, analyst, fingerprint) with today's
     * selection, capacity and catalog. Never calls a model or the analyst
     * runner. Without `yes` it writes nothing. With `yes` the result is saved
     * as a draft (never approved): over a draft/missing-active strategy
     * directly, over an approved one as a pending proposal so the approved
     * team stays until the human approves.
     */
    async rebuildProjectTeam({ cwd, yes = false }) {
      const projectRoot = await root(cwd);
      const stored = await readProjectStrategyImpl(homeDir, projectRoot);
      const { rebuilt } = await formFromStored(this, projectRoot, stored);
      const label = (entry) => ({ model: entry?.model ? (entry.model.displayName ?? entry.model.modelId) : null, provider: entry?.model?.adapterId ?? null, assignmentState: entry?.assignmentState ?? "ready" });
      const oldByRole = new Map((stored.projectTeam ?? []).map((entry) => [entry.role, entry]));
      const newByRole = new Map(rebuilt.projectTeam.map((entry) => [entry.role, entry]));
      const roles = [...new Set([...oldByRole.keys(), ...newByRole.keys()])].map((role) => {
        const before = label(oldByRole.get(role));
        const after = label(newByRole.get(role));
        const changed = before.model !== after.model || before.provider !== after.provider || before.assignmentState !== after.assignmentState;
        return { role, old: before, new: after, changed, why: changed ? (newByRole.get(role)?.reason ?? null) : null };
      });
      const changed = roles.some((entry) => entry.changed);
      const result = { applied: false, changed, strategyStatus: stored.status, roles, phasePlan: rebuilt.phasePlan };
      if (yes !== true || !changed) return result;
      const lock = await acquireProjectAnalysisLockImpl(homeDir, projectRoot, { owner: "manual" });
      if (!lock.acquired) throw new Error("A project analysis is already running for this project. Wait for it to finish, then try again.");
      try {
        if (stored.status !== "active") {
          await assertStrategyUnchanged(projectRoot, stored);
          await writeProjectStrategyImpl(homeDir, projectRoot, rebuilt);
          return { ...result, applied: true, strategyStatus: "suggested" };
        }
        const proposal = { ...rebuilt, status: "suggested", proposedAt: new Date(now()).toISOString(), proposal: { source: "manual-rebuild" } };
        const basedOn = { profileFingerprint: stored.profileFingerprint ?? null, approvedAt: stored.approvedAt ?? null, hash: strategyHash(stored) };
        const id = computeProposalId(proposal, basedOn);
        await assertStrategyUnchanged(projectRoot, stored);
        await writePendingTeamProposalImpl(homeDir, projectRoot, { id, source: "manual-rebuild", createdAt: proposal.proposedAt, basedOn, proposal });
        return { ...result, applied: true, pending: true, proposalId: id };
      } finally {
        await lock.release();
      }
    },
    /**
     * Automatic team recovery after a provider-availability change (see
     * team-recovery.js): at most once per availability fingerprint, under
     * the project analysis lock, activating the rebuilt team only when it
     * was built for the availability that is still current. Availability
     * comes from snapshot(), whose usage probes are cached (60 s for
     * Codex/Claude, 5 min for Go); a change hidden by that cache shows up as
     * a new fingerprint on a later refresh and triggers one more recovery.
     * Never throws for an expected outcome; returns what happened.
     */
    async recoverProjectTeam({ cwd, reopenPending = false, analyst = null, explicit = false }) {
      const projectRoot = await root(cwd);
      // Reopening a pending proposal (Esc, restart) only READS the stores:
      // no analysis, no lock, no attempt recorded.
      if (reopenPending) {
        const pending = await this.pendingTeamProposal({ cwd: projectRoot });
        if (pending) return pending;
      }
      return runTeamRecovery({
        readStrategy: () => readProjectStrategyImpl(homeDir, projectRoot),
        writeStrategy: (strategy) => writeProjectStrategyImpl(homeDir, projectRoot, strategy),
        readRecord: () => readAvailabilityRecoveryImpl(homeDir, projectRoot),
        writeRecord: (record) => writeAvailabilityRecoveryImpl(homeDir, projectRoot, record),
        // The human's own pick (a fresh Enter in the picker). Without it
        // recovery only suggests an analyst and never analyzes.
        analystChoice: analyst,
        // D5: only the human's explicit request (R) may open the selection.
        explicit: explicit === true,
        acquireLock: () => acquireProjectAnalysisLockImpl(homeDir, projectRoot, { owner: "automatic-recovery" }),
        currentEligibility: async () => (await this.snapshot({ cwd: projectRoot })).modelIntelligence?.eligibility ?? {},
        preflight: () => this.preflightProject({ cwd: projectRoot }),
        analyze: ({ profile, candidates, analyst }) => runLockedBootstrapAnalysis({ projectRoot, profile, candidates, analyst, persist: false }),
        now
      });
    },
    /**
     * Approve a pending recovery proposal (see team-recovery.js): the
     * proposal is re-verified against current eligibility and only then
     * activated. A stale proposal throws instead of swapping in blocked
     * models. Nothing is ever auto-approved — this is the explicit human
     * act runTeamRecovery deliberately leaves out.
     */
    async approveRecoveryProposal({ cwd, proposalId }) {
      const projectRoot = await root(cwd);
      const manual = await readPendingTeamProposalImpl(homeDir, projectRoot);
      if (manual && proposalId === manual.id) return this.approvePendingTeamProposal({ projectRoot, pending: manual });
      // With a manual proposal pending, the caller must say WHICH proposal
      // it viewed — an absent id never defaults to either one.
      if (manual && !(typeof proposalId === "string" && proposalId && proposalId === recoveryProposalId(await readAvailabilityRecoveryImpl(homeDir, projectRoot).catch(() => null)))) {
        throw new Error("That is not the pending proposal you viewed — review the current proposal again.");
      }
      return approveRecoveryProposal({
        proposalId,
        readRecord: () => readAvailabilityRecoveryImpl(homeDir, projectRoot),
        writeRecord: (record) => writeAvailabilityRecoveryImpl(homeDir, projectRoot, record),
        readStrategy: () => readProjectStrategyImpl(homeDir, projectRoot),
        writeStrategy: (strategy) => writeProjectStrategyImpl(homeDir, projectRoot, strategy),
        currentEligibility: async () => (await this.snapshot({ cwd: projectRoot })).modelIntelligence?.eligibility ?? {},
        now
      });
    },
    /**
     * Activates the pending manual re-analysis proposal THE HUMAN VIEWED
     * (caller already matched its id). The base (active) team must be
     * exactly what the proposal was built against, and the same activation
     * gate as `/project approve` must pass. The strategy is replaced by one
     * atomic write; only then is the proposal cleared, so a failed write
     * leaves the active team untouched and the proposal pending.
     */
    async approvePendingTeamProposal({ projectRoot, pending }) {
      const current = await readProjectStrategyImpl(homeDir, projectRoot);
      if (current?.status !== "active" || strategyHash(current) !== pending.basedOn?.hash) {
        throw new Error("The active team changed since the proposal was created — review the current team and run a new analysis instead of approving this one.");
      }
      const candidate = { ...pending.proposal, status: "suggested" };
      const reasons = await this.activationBlockers({ strategy: candidate, projectRoot });
      if (reasons.length > 0) {
        throw new Error(`The proposal cannot be activated right now: ${reasons.join("; ")}`);
      }
      const { proposal: _origin, proposedAt: _proposedAt, ...rest } = pending.proposal;
      const activated = {
        ...rest, status: "active", approvedAt: new Date(now()).toISOString(),
        activation: { source: "reanalysis-approved", proposalId: pending.id }
      };
      await assertStrategyUnchanged(projectRoot, current);
      await writeProjectStrategyImpl(homeDir, projectRoot, activated);
      await clearPendingTeamProposalImpl(homeDir, projectRoot);
      return { outcome: "approved", proposalId: pending.id, strategy: activated };
    },
    /**
     * The proposal a human can review right now, from either source, in one
     * shape: a manual re-analysis proposal first (the user's own act), then
     * a pending automatic-recovery proposal. Read-only. null when none.
     */
    async pendingTeamProposal({ cwd }) {
      const projectRoot = await root(cwd);
      const manual = await readPendingTeamProposalImpl(homeDir, projectRoot);
      if (manual) {
        return {
          outcome: "proposed", source: manual.source ?? "manual-reanalysis", proposalId: manual.id,
          fingerprint: null, affected: [], proposal: manual.proposal, basedOn: manual.basedOn ?? null
        };
      }
      const record = await readAvailabilityRecoveryImpl(homeDir, projectRoot).catch(() => null);
      if (record?.outcome !== "proposed" || !record.proposal) return null;
      return {
        outcome: "proposed", source: "automatic-recovery", proposalId: recoveryProposalId(record),
        fingerprint: record.fingerprint, affected: record.affected ?? [], proposal: record.proposal, basedOn: record.basedOn ?? null
      };
    },
    /**
     * Reject a pending proposal: the active team was never touched, so
     * rejection only discards the proposal (manual) or closes the
     * fingerprint (recovery). Throws when there is nothing pending or the
     * id is not the one viewed.
     */
    async rejectRecoveryProposal({ cwd, proposalId }) {
      const projectRoot = await root(cwd);
      const manual = await readPendingTeamProposalImpl(homeDir, projectRoot);
      if (manual && proposalId === manual.id) {
        await clearPendingTeamProposalImpl(homeDir, projectRoot);
        return { outcome: "rejected", proposalId: manual.id };
      }
      if (manual && !(typeof proposalId === "string" && proposalId && proposalId === recoveryProposalId(await readAvailabilityRecoveryImpl(homeDir, projectRoot).catch(() => null)))) {
        throw new Error("That is not the pending proposal you viewed — review the current proposal again.");
      }
      return rejectRecoveryProposal({
        proposalId,
        readRecord: () => readAvailabilityRecoveryImpl(homeDir, projectRoot),
        writeRecord: (record) => writeAvailabilityRecoveryImpl(homeDir, projectRoot, record)
      });
    },
    /**
     * Why a strategy cannot be activated right now (empty list = it can):
     * integrity of the team plus CURRENT eligibility/availability of every
     * operational assignment. Shared by `/project approve` and by approving
     * a pending re-analysis proposal, so both gates are the same one.
     */
    async activationBlockers({ strategy, projectRoot }) {
      const reasons = [];
      const team = strategy.projectTeam ?? [];
      if (team.length === 0) reasons.push("projectTeam is empty — re-analyze before approving.");
      const hostOrchestrator = strategy.orchestrator?.source === "host";
      if (!hostOrchestrator && (!strategy.orchestrator?.adapterId || !(strategy.orchestrator?.modelId || strategy.orchestrator?.displayName))) {
        reasons.push("Orchestrator assignment is missing.");
      }
      const snap = await this.snapshot({ cwd: projectRoot });
      const intelligence = snap.modelIntelligence ?? {};
      const availabilityOpts = {
        eligibility: intelligence.eligibility ?? {},
        claudeEntitlement: intelligence.claudeEntitlement ?? {},
        cursorAccess: intelligence.cursorAccess ?? {}
      };
      for (const entry of team) {
        const role = entry?.role ?? "Unknown role";
        if (!entry?.model?.adapterId || !(entry.model.modelId || entry.model.displayName)) {
          reasons.push(`${role}: missing assignment`);
          continue;
        }
        if (entry.assignmentState === "blocked") {
          reasons.push(`${role}: assignment blocked (no usable primary or fallback)`);
          continue;
        }
        const availability = resolveAssignmentAvailability(entry.model, availabilityOpts);
        if (!availability.available) {
          reasons.push(`${role}: ${availability.warning ?? "unavailable"}`);
        }
      }
      if (strategy.orchestrator?.adapterId) {
        const orch = resolveAssignmentAvailability(strategy.orchestrator, availabilityOpts);
        if (!orch.available) {
          reasons.push(`Orchestrator: ${orch.warning ?? "unavailable"}`);
        }
      }
      return reasons;
    },
    /**
     * `/project approve`: SUGGESTED -> ACTIVE. Re-checks strategy integrity
     * and current eligibility/availability for every operational assignment
     * before flipping status. Unusable or missing roles return
     * `{ok:false, status, reasons[]}` without mutating — never a silent
     * model swap. Edit stays allowed on the suggested strategy.
     */
    async approveProjectStrategy({ cwd }) {
      const projectRoot = await root(cwd);
      const existing = await readProjectStrategyImpl(homeDir, projectRoot);
      if (!existing) throw new Error("No suggested project strategy yet — run /project analyze first.");
      if (existing.status !== "suggested") {
        return { ok: false, status: existing.status ?? "unknown", reasons: [`Strategy is ${existing.status}, not suggested — nothing to approve.`] };
      }
      const reasons = await this.activationBlockers({ strategy: existing, projectRoot });
      if (reasons.length > 0) {
        return { ok: false, status: existing.status, reasons };
      }
      const approved = { ...existing, status: "active", approvedAt: new Date().toISOString() };
      await assertStrategyUnchanged(projectRoot, existing);
      await writeProjectStrategyImpl(homeDir, projectRoot, approved);
      return { ok: true, ...approved, projectRoot };
    },
    /**
     * `/project refresh`: a strategy that was never approved (no strategy
     * yet, or still just "suggested") is left as-is — the interactive
     * overlay analysis flow is the only way to get a new suggestion; refresh
     * never silently re-runs a real provider call. An ACTIVE strategy
     * whose real fingerprint no longer matches the current evidence is
     * marked STALE (persisted) but keeps its previous team assignments/
     * approval intact — a stale flag, not a silent, unapproved swap.
     */
    async refreshProjectStrategy({ cwd }) {
      const projectRoot = await root(cwd);
      const existing = await readProjectStrategyImpl(homeDir, projectRoot);
      if (!existing || existing.status !== "active") return existing;
      const profile = await computeProjectProfileImpl({ cwd: projectRoot });
      if (isStrategyStale(existing, profile)) {
        const stale = { ...existing, status: "stale" };
        await assertStrategyUnchanged(projectRoot, existing);
        await writeProjectStrategyImpl(homeDir, projectRoot, stale);
        return { ...stale, projectRoot, profile };
      }
      return { ...existing, projectRoot, profile };
    },
    /**
     * The real projectTeam edit catalog for one role (section 4 —
     * "Edición persistida del PROJECT TEAM") — every real, non-superseded
     * candidate from active providers, with its own real
     * availability/evidenceStatus/role evaluation. Read-only; never
     * writes anything, never consumes quota.
     */
    async getProjectTeamEditCatalog({ cwd, role }) {
      const projectRoot = await root(cwd);
      const snap = await this.snapshot({ cwd: projectRoot });
      const { scoredAll = [], manualSelectionScoredPool = scoredAll, eligibility = {}, registry = null, unscoredModels = [] } = snap.modelIntelligence ?? {};
      return computeProjectTeamEditCatalog(role, { scoredAll, manualSelectionScoredPool, eligibility, registry, unscoredModels, teamProviders: await teamProvidersFor(projectRoot) });
    },
    /**
     * Persists a real, human-confirmed assignment for one role of a
     * SUGGESTED project strategy — either a manual override (a real,
     * currently-listed edit-catalog candidate) or an implicit reset (the
     * role's own real recommended candidate chosen again). Rejects a role
     * outside this project's team, a candidate no longer in the real
     * current catalog (superseded/disappeared), or any strategy that
     * isn't SUGGESTED (active/stale stay read-only in this increment).
     * Never runs anything, never consumes quota — this only ever changes
     * what a LATER approved run would delegate to.
     * @param {object} args
     * @param {string} args.cwd
     * @param {string} args.role
     * @param {string} args.candidateKey - one real candidateKey from
     *   getProjectTeamEditCatalog's own output for this exact role.
     */
    async setProjectTeamAssignment({ cwd, role, candidateKey }) {
      const projectRoot = await root(cwd);
      const existing = await readProjectStrategyImpl(homeDir, projectRoot);
      if (!existing) throw new Error("No project strategy to edit — run /project analyze first.");
      if (existing.status !== "suggested") {
        throw new Error(`Cannot edit a ${existing.status.toUpperCase()} project strategy — only a SUGGESTED one is editable.`);
      }
      const catalog = await this.getProjectTeamEditCatalog({ cwd, role });
      const candidate = catalog.models.find((model) => model.candidateKey === candidateKey);
      if (!candidate) throw new Error(`"${candidateKey}" is not a real, current candidate for ${role} — it may be superseded or no longer available.`);
      const updated = applyProjectTeamOverride(existing, role, candidate);
      await assertStrategyUnchanged(projectRoot, existing);
      await writeProjectStrategyImpl(homeDir, projectRoot, updated);
      return updated;
    },
    /** Persists one chat entry; a write failure throws so the caller can surface it. */
    /** Persists an empty transcript so `/clear` stays cleared across a restart. */
    async showPlan({ cwd, taskId }) {
      const projectRoot = await root(cwd);
      const record = await readPlan(projectRoot, taskId);
      if (!record) throw new Error(`Plan "${taskId}" not found.`);
      return {
        ...publicPlan(record, await executionFor(projectRoot, taskId)),
        projectRoot,
        taskMarkdown: record.taskMarkdown,
        planMarkdown: record.planMarkdown
      };
    },
    async readTaskResult({ cwd, taskId }) {
      const projectRoot = await root(cwd);
      const record = await readPlan(projectRoot, taskId);
      if (!record) throw new Error(`Plan "${taskId}" not found.`);
      // Same liveness recovery as team/snapshot reads: a run whose process died is
      // reported interrupted here too, never as running. It only marks, never launches.
      // A corrupt unrelated run record must not hide this task's own (typed) evidence.
      await recover(homeDir).catch(() => {});
      const link = await readExecution(projectRoot, taskId);
      const result = await composeTaskResult({
        taskId,
        projectRoot,
        link,
        readRun: (runId) => readRun(homeDir, runId),
        readEvents: (runId) => readRunEventsImpl(homeDir, runId),
        normalize: normalizeRunResult,
        associate: associateResultWithGentleReview,
        readGentleContext
      });
      // Observed evidence only: upsert (no-op when already recorded), then read.
      if (link && result.status !== "not_started") {
        await noteTransition(projectRoot, taskId, { runId: link.runId, kind: "delegated", evidence: `run:${link.runId}` });
        if (result.status === "terminal") {
          await noteTransition(projectRoot, taskId, { runId: link.runId, kind: "result_observed", evidence: `run:${link.runId}` });
        }
      }
      const { state, error, entries, next } = await readCircuit(projectRoot, taskId, link?.runId);
      return { ...result, transitions: { state, error: error ?? null, entries, next } };
    },
    /**
     * Append-only assertion of a review-side transition (authorized review,
     * comments, correction). Needs an explicit task id and kind from the
     * fixed enum plus an opaque evidence pointer; it launches nothing and
     * never touches review authority.
     */
    async recordTransition({ cwd, taskId, kind, evidence }) {
      if (!TRANSITION_KINDS.includes(kind)) {
        throw Object.assign(new Error(`Unknown transition kind "${kind}".`), { code: "TRANSITION_KIND_INVALID" });
      }
      if (!EXTERNAL_TRANSITION_KINDS.includes(kind)) {
        throw Object.assign(new Error(`"${kind}" is observed by Kairo and cannot be asserted.`), { code: "TRANSITION_KIND_NOT_EXTERNAL" });
      }
      const projectRoot = await root(cwd);
      const record = await readPlan(projectRoot, taskId);
      if (!record) throw new Error(`Plan "${taskId}" not found.`);
      const link = await readExecution(projectRoot, taskId);
      if (!link) {
        throw Object.assign(new Error(`Plan "${taskId}" has no execution to attach a transition to.`), { code: "TRANSITION_NO_EXECUTION" });
      }
      const { recorded } = await transitions.append(projectRoot, taskId, { runId: link.runId, kind, evidence });
      const read = await readCircuit(projectRoot, taskId, link.runId);
      return { taskId, runId: link.runId, kind, recorded, next: read.next };
    },
    async decidePlan({ cwd, taskId, decision }) {
      if (![PLAN_STATES.APPROVED, PLAN_STATES.REJECTED].includes(decision)) {
        throw new Error("Decision must be approved or rejected.");
      }
      const projectRoot = await root(cwd);
      const existing = await readPlan(projectRoot, taskId);
      if (!existing) throw new Error(`Plan "${taskId}" not found.`);
      const record = await transition(projectRoot, taskId, decision);
      return { ...publicPlan(record, await executionFor(projectRoot, taskId)), projectRoot };
    },
    /**
     * The real PROJECT TEAM route for one role, right now — reloads the
     * persisted ProjectStrategy and CURRENT eligibility fresh on every
     * call (never cached/reused across preview and confirm; executePlan's
     * own revalidation calls this exact same method again before ever
     * reserving quota — see its own doc).
     * @param {string} role
     * @param {string} projectRoot
     */
    async routeProjectExecution(role, projectRoot, context = {}) {
      const strategy = await readProjectStrategyImpl(homeDir, projectRoot);
      const snap = await this.snapshot({ cwd: projectRoot });
      const eligibility = snap.modelIntelligence?.eligibility ?? {};
      // Combined claude+cursor per-model entitlement — the real gate that
      // actually prevents launching a task on a blocked/exhausted model,
      // for either adapter, via the exact same blockingEntitlement check
      // (project-router.js) real Claude entitlement already used alone.
      const modelEntitlement = snap.modelIntelligence?.modelEntitlement ?? {};
      const models = snap.modelIntelligence?.scoredAll ?? [];
      const registry = snap.modelIntelligence?.registry ?? null;
      const providerCapacity = snap.modelIntelligence?.providerCapacity ?? {};
      const host = context.activeHost ?? (activeHost.id ? activeHost : undefined);
      const args = { role, strategy, eligibility, modelEntitlement, models, registry, providerCapacity, ...(host ? { activeHost: host } : {}) };
      // Per-task distribution: recompute the qualified pool from the live
      // snapshot (a new key, subscription or model joins automatically) and
      // read this project+role's run history. Any failure keeps today's
      // route and states why; it never fails the task.
      let distributionFailure = null;
      if (strategy?.status === "active" && Array.isArray(strategy.projectTeam)) {
        try {
          const roleCatalog = loadProjectRoleCatalogImpl({ projectRoot });
          const banded = qualifiedRolePool({ role, models, eligibility, registry, roleCapabilities: strategy.roleCapabilities,
            roleCatalog });
          let { pool, note: bandNote } = banded;
          const records = await listRuns(homeDir);
          const launches = await readRoutingLaunchLedger(homeDir, projectRoot);
          const at = now();
          const admission = await readTaskAdmissionInputs(homeDir, records, launches, pool.map(row => row.adapterId), at, { ...deps, projectRoot, providerCapacity });
          // Quota-aware S26: Builders take the cheapest qualified model unless pacing projects unused quota.
          if (withRoleCatalog(roleCatalog, () => currentRegistry()[role]?.builder === true)) {
            const builder = builderQuotaPool(banded.all, pool, providersWithUnusedQuota(admission.providerCapacity ?? providerCapacity, admission.samples, at));
            pool = builder.pool;
            bandNote = [bandNote, builder.note].filter(Boolean).join(" ") || null;
          }
          if (pool.length || admission.samples.length) {
            const ledger = [...runRecordsToLedger(records, { projectRoot, role }), ...launches.filter(row => row.role === role)];
            const route = resolveProjectRoute({ ...args, pool, ledger, capacity: providerCapacity, now: at, ...admission });
            return bandNote ? { ...route, why: `${route.why} ${bandNote}` } : route;
          }
        } catch (error) {
          distributionFailure = `Distribution skipped: ${error?.message ?? error}.`;
        }
      }
      const route = resolveProjectRoute(args);
      return distributionFailure ? { ...route, distribution: { applied: false, reason: distributionFailure } } : route;
    },
    /**
     * Read-only preview of what executePlan would do right now.
     *
     * PROJECT TEAM is the sole authority for execution routing — `role`
     * is required and always comes from the caller's own explicit choice,
     * NEVER inferred from the plan's task text. Resolves the role against
     * the approved ProjectStrategy via resolveProjectRoute and returns a
     * ProjectExecutionPreview (decision/provider/model/modelRef/
     * assignmentSource/strategyFingerprint/why/blockedAssignment/
     * suggestedAlternative/confirmationTarget — see toExecutionPreview's
     * own doc). The legacy keyword-classification router
     * (selectExecutionProvider) is never consulted here — a project with
     * no active team simply returns WAIT_FOR_PROJECT_TEAM, the router's
     * own honest answer, never a silent fallback to guessing from text.
     */
    async planExecution({ cwd, taskId, role, mode, activeHost }) {
      if (!role) throw new Error("planExecution requires an explicit role — it is never inferred from the task's text.");
      const planMode = normalizeExecutionMode(mode);
      if (!planMode) throw new ExecutionModeError("invalid_execution_mode", `Unsupported execution mode "${mode}".`);
      const projectRoot = await root(cwd);
      const record = await readPlan(projectRoot, taskId);
      if (!record) throw new Error(`Plan "${taskId}" not found.`);
      const route = await this.routeProjectExecution(role, projectRoot, { activeHost });
      return { ...toExecutionPreview(route, record, planMode), ...(route.host ? { host: route.host } : {}), projectRoot, taskId };
    },
    /**
     * @param {object} args
     * @param {string} args.cwd
     * @param {string} args.taskId
     * @param {{role: string, selection: "assigned"|"suggested-alternative", strategyFingerprint: string|null, candidateKey: string|null}} args.confirmationTarget -
     *   the EXACT confirmationTarget a prior planExecution({role}) preview
     *   returned — required; PROJECT TEAM is the sole authority for what
     *   executes, so there is no free-form agentId/model override. Before
     *   reserving any real quota or launching anything, the real project
     *   route is recomputed from scratch (fresh strategy + fresh
     *   eligibility) and compared field-for-field against this —
     *   strategyFingerprint, role, and the resolved candidateKey must all
     *   still match exactly. Any drift (strategy re-approved, quota lost,
     *   override changed) rejects outright and asks for a new preview;
     *   never silently re-routes to something else. Never accepts a
     *   MANUAL_HANDOFF candidate — that's never something Kairo launches.
     */
    async executePlan({ cwd, taskId, confirmationTarget, mode, activeHost }) {
      if (!confirmationTarget) throw new Error(`Cannot execute "${taskId}": a confirmationTarget from a fresh planExecution({role}) preview is required — PROJECT TEAM is the sole authority for execution.`);
      // A target with no mode IS standard. A read-only confirmation can never
      // launch a standard run and a standard one can never launch read-only.
      const targetMode = normalizeExecutionMode(confirmationTarget.mode);
      const requestedMode = mode === undefined ? targetMode : normalizeExecutionMode(mode);
      if (!targetMode || !requestedMode || targetMode !== requestedMode) {
        throw new Error(`Cannot execute "${taskId}": the real project team state changed since this was confirmed (execution mode) — request a new preview and confirm again.`);
      }
      const projectRoot = await root(cwd);
      const existing = await executionFor(projectRoot, taskId);
      const record = await verifyExecution(projectRoot, taskId, { checkWorkingTree: !existing });
      if (existing) {
        if ((existing.mode ?? "standard") !== targetMode) {
          throw new Error(`Cannot execute "${taskId}": the real project team state changed since this was confirmed (an execution in another mode already exists) — request a new preview and confirm again.`);
        }
        return { ...publicPlan(record, existing), projectRoot, reused: true };
      }

      const route = await this.routeProjectExecution(confirmationTarget.role, projectRoot, { activeHost });
      const resolvedCandidate = confirmationTarget.selection === "assigned"
        ? (route.decision === "ROUTED" ? route.model : null)
        : (route.decision === "WAIT_FOR_PROJECT_TEAM" ? route.suggestedAlternative?.model ?? null : null);
      const candidateStillMatches = resolvedCandidate
        && route.strategyFingerprint === confirmationTarget.strategyFingerprint
        && resolvedCandidate.candidateKey === confirmationTarget.candidateKey;
      if (!candidateStillMatches) {
        throw new Error(`Cannot execute "${taskId}": the real project team state changed since this was confirmed (strategy, eligibility, or override) — request a new preview and confirm again.`);
      }
      const resolvedAgentId = resolvedCandidate.adapterId;
      // OpenCode Go/Zen's real catalog stores bare model ids (see
      // opencode-models.js's normalizeModel) — the CLI needs the real,
      // fully-qualified "opencode-go/<id>" (or "opencode/<id>" for Zen)
      // ref to deterministically route to the intended product; a bare id
      // is exactly the ambiguity Kairo must never risk. Every other
      // adapter's modelId is already launch-ready as-is.
      const resolvedModel = resolvedAgentId === "opencode-go" || resolvedAgentId === "opencode-zen"
        ? toRuntimeModelRef(resolvedAgentId === "opencode-go" ? "go" : "zen", resolvedCandidate.modelId)
        : resolvedCandidate.modelId;

      const runPermissions = targetMode === READ_ONLY_MODE ? [READ_ONLY_MODE] : [];
      if (targetMode === READ_ONLY_MODE) {
        // Fail closed BEFORE reserving or launching: the adapter must really
        // support read-only (see ADAPTER_PERMISSION_MODES), never a prompt alone.
        try {
          authorizeRuns({ permissions: runPermissions, agentId: resolvedAgentId, allowUnsafePermissions: false, source: "cockpit" });
        } catch (cause) {
          const refusal = new Error(`Cannot execute "${taskId}" read-only: ${cause?.message ?? "adapter does not support read-only"}`);
          refusal.code = "read_only_unsupported";
          refusal.cause = cause;
          throw refusal;
        }
      }
      const modeKey = targetMode === READ_ONLY_MODE ? { mode: targetMode } : {};
      const runId = newRunId();
      const createdAt = new Date().toISOString();
      try {
        await reserveExecution(projectRoot, taskId, { runId, agentId: resolvedAgentId, role: confirmationTarget.role ?? null, ...modeKey, state: "reserved", createdAt, updatedAt: createdAt });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const raced = await executionFor(projectRoot, taskId);
        if (!raced) throw error;
        if ((raced.mode ?? "standard") !== targetMode) throw new Error(`Cannot execute "${taskId}": the real project team state changed since this was confirmed (an execution in another mode already exists) — request a new preview and confirm again.`);
        return { ...publicPlan(record, raced), projectRoot, reused: true };
      }
      const task = buildExecutionTaskPrompt(record.planMarkdown, targetMode);
      let started;
      try {
        started = await launchRun({
          homeDir, runId, agentId: resolvedAgentId, task, cwd: projectRoot, model: resolvedModel,
          permissions: runPermissions, allowUnsafePermissions: false, permissionSource: "cockpit",
          // Real, un-redacted assistant/result content flows into this
          // real run's own event log only when this is true (see
          // run-redact.js's own allowTranscript gate) — the cockpit is a
          // local, interactive session where the human launching the run
          // is the one reading it back live (via the run event log),
          // never a background/unattended context, so showing the run's
          // own real output where it's already displayed makes sense.
          captureTranscript: true, strategy: "direct", wait: false, role: confirmationTarget.role ?? null
        });
      } catch (error) {
        // The launch failed: record it, but never let a failure of the record mask the launch error.
        try {
          await updateExecution(projectRoot, taskId, {
            runId, agentId: resolvedAgentId, role: confirmationTarget.role ?? null, ...modeKey, state: "failed", error: error.message ?? String(error), createdAt,
            updatedAt: new Date().toISOString()
          });
        } catch {
          // keep the original error
        }
        throw error;
      }
      // From here the run is live. A bookkeeping failure must be reported, never recorded as a failed run.
      const warnings = [];
      try {
        await updateExecution(projectRoot, taskId, {
          runId, agentId: resolvedAgentId, role: confirmationTarget.role ?? null, ...modeKey, state: started.metadata.state, createdAt, updatedAt: new Date().toISOString()
        });
      } catch (error) {
        warnings.push(`Run ${runId} started, but its execution link could not be updated: ${error?.message ?? String(error)}`);
      }
      try {
        const transitionWarning = await noteTransition(projectRoot, taskId, {
          runId, kind: "delegated", evidence: `run:${runId}`
        });
        if (transitionWarning) warnings.push(transitionWarning);
      } catch (error) {
        warnings.push(`Run ${runId} started, but the plan transition could not be recorded: ${error?.message ?? String(error)}`);
      }
      return {
        ...publicPlan(record, {
          runId, provider: resolvedAgentId, role: confirmationTarget.role ?? null, mode: targetMode, state: started.metadata.state, active: true,
          error: null, startedAt: started.metadata.startedAt, updatedAt: started.metadata.updatedAt,
          message: `${resolvedAgentId} run is ${started.metadata.state}.`
        }),
        projectRoot,
        reused: false,
        ...(warnings.length > 0 ? { transitionWarning: warnings.join(" ") } : {})
      };
    },
    async cancelExecution({ cwd, taskId }) {
      const projectRoot = await root(cwd);
      const link = await readExecution(projectRoot, taskId);
      if (!link) throw new Error(`Plan "${taskId}" has no Claude execution.`);
      await cancelRun(homeDir, link.runId);
      const record = await readPlan(projectRoot, taskId);
      return { ...publicPlan(record, await executionFor(projectRoot, taskId)), projectRoot };
    },
  };
}
