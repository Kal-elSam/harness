import { createArchitecturePlan } from "../architect/architect-manager.js";
import {
  listTaskRecords, readExecutionLink, readTaskRecord, resolveProjectRoot, transitionTask,
  updateExecutionLink, verifyPlanForExecution, writeExecutionLink
} from "../architect/architect-store.js";
import { PLAN_STATES } from "../architect/architect-types.js";
import { resolveHomeDir } from "../paths.js";
import { listRunRecords, readRunState } from "../runtime/run-store.js";
import { recoverRuns, startRun, stopRun } from "../runtime/run-manager.js";
import { createRunId, isActiveRunState } from "../runtime/run-types.js";
import { inspectExecutionAdapters } from "../runtime/execution-adapters/index.js";
import { inspectEngramIntegration } from "../integrations/engram-evidence.js";
import { hasFiniteUsage } from "../ink/cockpit-usage.js";
import { readCodexUsage } from "../observability/codex-usage.js";
import { readClaudeUsage } from "../observability/claude-usage.js";
import { readOpenCodeUsage, readOpenCodeGoUsage, readOpenCodeStats } from "../observability/opencode-usage.js";
import { readCodexModels } from "../observability/codex-models.js";
import { readOpenCodeModels } from "../observability/opencode-models.js";
import { readClaudeModels } from "../observability/claude-models.js";
import { readCursorModels } from "../observability/cursor-models.js";
import { checkCandidate, isLikelyQuestion, selectAskProvider, selectExecutionProvider } from "../intelligence/execution-router.js";
import { readSkillCatalog } from "../intelligence/skill-catalog.js";
import { askProvider } from "../intelligence/quick-ask.js";
import { appendTranscriptEntry, clearTranscript, readTranscript } from "./transcript-store.js";
import { readSession, writeSessionMode } from "./session-store.js";
import { computeProjectProfile } from "./project-profile.js";
import {
  buildProjectStrategy, computeBootstrapAnalystAlternatives, computeBootstrapAnalystCatalog, isStrategyStale,
  computeProjectTeamEditCatalog, applyProjectTeamOverride, resetProjectTeamAssignment
} from "./project-strategy.js";
import { buildAnalystPrompt, deriveRoleRequirements, parseProjectAnalysis } from "./project-analysis.js";
import { buildSanitizedSnapshot } from "./sanitized-snapshot.js";
import { runCodexSandboxedBootstrap } from "./codex-sandbox.js";
import { createBootstrapAnalyzerAdapter } from "./bootstrap-analyzer-adapters.js";
import { verifyClaudeSubscriptionAuth } from "../runtime/execution-adapters/claude.js";
import { readProjectStrategy, writeProjectStrategy } from "./project-strategy-store.js";
import { readArtificialAnalysisModels } from "../observability/artificial-analysis-models.js";
import { readHuggingFaceLeaderboard } from "../observability/huggingface-leaderboard.js";
import {
  annotateWithRegistryEvidence, bestEfficientModelPerRoleGlobal, bestModelPerRole, bestModelPerRoleGlobal, buildAiTeam,
  buildEfficientTeam, scoreAvailableModels, summarizeCatalogCoverage
} from "../intelligence/model-intelligence.js";
import { buildAutomaticExecutionPool, buildCompleteCandidateCatalog, buildRecommendationPool } from "../intelligence/model-candidate-catalog.js";
import { createCapabilityRegistry } from "../intelligence/model-capability-registry.js";
import { ingestArtificialAnalysisEvidence, ingestHuggingFaceLeaderboardEvidence } from "../intelligence/model-capability-registry-sources.js";
import { ingestOfficialSnapshotEvidence } from "../intelligence/official-benchmark-snapshots.js";
import { ingestKairoTelemetryEvidence } from "../intelligence/kairo-telemetry-source.js";
import { buildProviderCapacity } from "../intelligence/subscription-pressure-source.js";

export const CONVERSATION_SCHEMA = "kairo.conversation/v1";

// The Bootstrap Analyst investigates a real project (reads real files,
// not just answering from the prompt text) — genuinely slower than a
// quick ASK-mode question, so it gets real room instead of quick-ask's
// 30s default.
const BOOTSTRAP_ANALYST_TIMEOUT_MS = 180_000;

function publicPlan(record, execution = null) {
  const status = record.status ?? record;
  return {
    taskId: status.taskId,
    taskText: status.taskText ?? null,
    state: status.state,
    provider: status.provider,
    model: status.model ?? null,
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
 * `cockpit/view.js`'s providerLine() lookups resolve to real data instead
 * of its hardcoded fallback text.
 * @param {ReturnType<typeof inspectExecutionAdapters>} adapters
 */
// cockpit/view.js's providerLine() looks up "Claude" — the claude adapter's
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

export function createConversationService(deps = {}) {
  const resolveRoot = deps.resolveRoot ?? resolveProjectRoot;
  const createPlan = deps.createPlan ?? createArchitecturePlan;
  const listPlans = deps.listPlans ?? listTaskRecords;
  const readPlan = deps.readPlan ?? readTaskRecord;
  const transition = deps.transition ?? transitionTask;
  const homeDir = deps.homeDir ?? resolveHomeDir();
  const readExecution = deps.readExecution ?? readExecutionLink;
  const readRun = deps.readRun ?? readRunState;
  const recover = deps.recoverRuns ?? recoverRuns;
  const verifyExecution = deps.verifyExecution ?? verifyPlanForExecution;
  const launchRun = deps.startRun ?? startRun;
  const cancelRun = deps.stopRun ?? stopRun;
  const reserveExecution = deps.writeExecution ?? writeExecutionLink;
  const updateExecution = deps.updateExecution ?? updateExecutionLink;
  const newRunId = deps.createRunId ?? createRunId;
  const inspectAdapters = deps.inspectExecutionAdapters ?? inspectExecutionAdapters;
  const inspectEngram = deps.inspectEngramIntegration ?? inspectEngramIntegration;
  const listRuns = deps.listRunRecords ?? listRunRecords;
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
  const routeTask = deps.selectExecutionProvider ?? selectExecutionProvider;
  const readSkillCatalogImpl = deps.readSkillCatalog ?? readSkillCatalog;
  const routeAsk = deps.selectAskProvider ?? selectAskProvider;
  const askProviderImpl = deps.askProvider ?? askProvider;
  const appendTranscriptImpl = deps.appendTranscriptEntry ?? appendTranscriptEntry;
  const readTranscriptImpl = deps.readTranscript ?? readTranscript;
  const clearTranscriptImpl = deps.clearTranscript ?? clearTranscript;
  const readSessionImpl = deps.readSession ?? readSession;
  const writeSessionModeImpl = deps.writeSessionMode ?? writeSessionMode;
  const computeProjectProfileImpl = deps.computeProjectProfile ?? computeProjectProfile;
  const readProjectStrategyImpl = deps.readProjectStrategy ?? readProjectStrategy;
  const writeProjectStrategyImpl = deps.writeProjectStrategy ?? writeProjectStrategy;
  const parseProjectAnalysisImpl = deps.parseProjectAnalysis ?? parseProjectAnalysis;
  const deriveRoleRequirementsImpl = deps.deriveRoleRequirements ?? deriveRoleRequirements;
  const buildSanitizedSnapshotImpl = deps.buildSanitizedSnapshot ?? buildSanitizedSnapshot;
  const runCodexSandboxedBootstrapImpl = deps.runCodexSandboxedBootstrap ?? runCodexSandboxedBootstrap;
  const createBootstrapAnalyzerAdapterImpl = deps.createBootstrapAnalyzerAdapter ?? createBootstrapAnalyzerAdapter;
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
  const now = deps.now ?? (() => Date.now());

  // Shared TTL + in-flight-dedupe cache for both provider usage probes:
  // concurrent snapshot() calls collapse into one underlying read, and reads
  // are skipped entirely while a fresh-enough cached value exists.
  function createCachedProbe(readFn, ttlMs) {
    let cache = null;
    let inFlight = null;
    return async function readCached(key, args) {
      if (!enableProviderProbes) return null;
      const currentTime = now();
      if (cache && cache.key === key && currentTime - cache.readAt < ttlMs) return cache.value;
      if (inFlight) return inFlight;
      inFlight = Promise.resolve(readFn(args))
        .then((value) => {
          cache = { key, readAt: now(), value };
          return value;
        })
        .finally(() => { inFlight = null; });
      return inFlight;
    };
  }
  const readCodexUsageCached = createCachedProbe(readCodexUsageImpl, codexUsageTtlMs);
  const readClaudeUsageCached = createCachedProbe(readClaudeUsageImpl, claudeUsageTtlMs);
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
  const readOpenCodeUsageCached = createCachedProbe(readOpenCodeUsageImpl, opencodeUsageTtlMs);
  const readOpenCodeGoCached = createCachedProbe(readOpenCodeGoImpl, opencodeGoUsageTtlMs);
  const readOpenCodeStatsCached = createCachedProbe(readOpenCodeStatsImpl, opencodeUsageTtlMs);

  async function executionFor(projectRoot, taskId) {
    const link = await readExecution(projectRoot, taskId);
    if (!link) return null;
    const run = await readRun(homeDir, link.runId);
    return {
      runId: link.runId,
      provider: run?.agentId ?? link.agentId ?? "claude",
      state: run?.state ?? link.state ?? "failed",
      active: run ? isActiveRunState(run.state) : false,
      error: run?.error ?? link.error ?? null,
      startedAt: run?.startedAt ?? link.createdAt ?? null,
      updatedAt: run?.updatedAt ?? link.updatedAt ?? null,
      message: run ? `Claude run is ${run.state}.` : (link.error ?? "Claude run record is unavailable.")
    };
  }

  /**
   * Real classification + real availability/quota/catalog data -> a routing
   * decision. Model-catalog reads spawn real processes, same as the usage
   * probes, so they're skipped (empty catalogs) under the same
   * `enableProviderProbes` test-safety gate.
   */
  async function routeExecution(projectRoot, taskText) {
    const adapters = inspectAdapters({ cwd: projectRoot });
    // Real skill descriptions (SKILL.md, not just folder names) — cheap
    // filesystem reads, safe even under the process-spawn test-safety gate.
    const skills = await readSkillCatalogImpl(projectRoot);
    if (!enableProviderProbes) {
      return routeTask({ task: taskText, adapters, codexUsage: null, claudeUsage: null, catalogs: {}, skills });
    }
    const [codexUsage, claudeUsage, opencodeGoUsage, codexCatalog, opencodeGoCatalog, opencodeZenCatalog] = await Promise.all([
      readCodexUsageCached(projectRoot, { cwd: projectRoot }),
      readClaudeUsageCached("global", {}),
      readOpenCodeGoCached("global", {}),
      readCodexModelsImpl(),
      readOpenCodeModelsImpl({ provider: "opencode-go" }),
      readOpenCodeModelsImpl({ provider: "opencode" })
    ]);
    return routeTask({
      task: taskText, adapters, codexUsage, claudeUsage, opencodeGoUsage, skills,
      catalogs: {
        codex: codexCatalog, opencodeGo: opencodeGoCatalog, opencodeZen: opencodeZenCatalog,
        claude: readClaudeModelsImpl()
      }
    });
  }

  async function root(cwd) { return resolveRoot(cwd); }

  return {
    async snapshot({ cwd }) {
      const projectRoot = await root(cwd);
      await recover(homeDir);
      const plans = await listPlans(projectRoot);
      const projected = await Promise.all(plans.map(async (plan) => publicPlan(
        plan, await executionFor(projectRoot, plan.taskId)
      )));
      const adapters = inspectAdapters({ cwd: projectRoot });
      const engram = inspectEngram();
      const recentRuns = await listRuns(homeDir, { limit: 50 });
      const usageByAgent = aggregateRunUsageByAgent(recentRuns);
      const [codexUsage, claudeUsage, opencodeUsage] = await Promise.all([
        readCodexUsageCached(projectRoot, { cwd: projectRoot }),
        readClaudeUsageCached("global", {}),
        deps.readOpenCodeUsage
          ? readOpenCodeUsageCached("global", {})
          : Promise.all([
            readOpenCodeGoCached("global", {}),
            readOpenCodeStatsCached("global", {})
          ]).then(([go, zen]) => ({ go, zen }))
      ]);
      const result = snapshot(
        projectRoot, projected,
        providersFromAdapters(adapters, usageByAgent, codexUsage, claudeUsage, opencodeUsage), integrationsFromInspections(engram)
      );
      result.usage.codex = codexUsage;
      result.usage.claude = claudeUsage;
      result.usage.opencode = opencodeUsage;
      // Cheap local read only — never recomputed here. Recomputing a real
      // ProjectProfile (git log, Graphify probe) on every poll tick would
      // make the dashboard itself expensive; that only happens on an
      // explicit /project analyze or /project refresh.
      result.projectStrategy = await readProjectStrategyImpl(homeDir, projectRoot);
      if (enableProviderProbes) {
        const [codexCatalog, opencodeGoCatalog, cursorCatalog, aa] = await Promise.all([
          readCodexModelsCached(projectRoot, { cwd: projectRoot }),
          readOpenCodeGoModelsCached("global", {}),
          readCursorModelsCached(projectRoot, { cwd: projectRoot }),
          readArtificialAnalysisModelsCached("global", {})
        ]);
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
          eligibility[adapterId] = check;
          if (check.ok) candidates.push(adapterId);
        }
        const claudeCatalog = readClaudeModelsImpl();
        const catalogsByAdapter = {
          codex: codexCatalog?.models ?? [],
          claude: claudeCatalog.models,
          "opencode-go": opencodeGoCatalog?.models ?? [],
          cursor: cursorCatalog?.models ?? []
        };
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
          aa.models
        );
        // The Recommendation Pool: scoredAllRaw joined with its real
        // identity, with genuinely superseded generations excluded —
        // QUALITY/EFFICIENT TEAM and ProjectStrategy consume THIS, never
        // scoredAllRaw directly, so an old generation Cursor still
        // re-exposes (e.g. Claude Sonnet 4) naturally stops competing
        // without buildAiTeam/buildEfficientTeam's own ranking logic
        // needing to know why. Manual-only real candidates (Cursor,
        // OpenCode Go) stay in it — this is "what Kairo can honestly
        // recommend", not "what Kairo can launch by itself".
        const scoredAll = buildRecommendationPool(scoredAllRaw, completeCandidateCatalog);
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
          { adapterId: "codex", catalogStatus: codexCatalog?.status ?? "unknown", models: codexCatalog?.models ?? [] },
          { adapterId: "claude", catalogStatus: claudeCatalog.status, models: claudeCatalog.models },
          { adapterId: "opencode-go", catalogStatus: opencodeGoCatalog?.status ?? "unknown", models: opencodeGoCatalog?.models ?? [] },
          { adapterId: "cursor", catalogStatus: cursorCatalog?.status ?? "unknown", models: cursorCatalog?.models ?? [] }
        ], aa.models);
        // Real catalog models that exist but couldn't be matched to any
        // real Artificial Analysis data — shown honestly as UNSCORED in
        // /models --evidence instead of just vanishing with no trace.
        // Derived directly from the Complete Candidate Catalog's own real
        // evidenceStatus — model-intelligence.js's old listUnscoredModels
        // duplicated this exact same real AA-match check separately; this
        // catalog replaces it as the one real source of truth.
        const unscoredModels = completeCandidateCatalog
          // Same "not superseded" real rule the Recommendation Pool
          // applies to SCORED candidates (buildRecommendationPool) — an
          // unscored candidate with a real, proven newer same-lineage
          // successor is exactly as stale as a scored one would be, and
          // must never surface in /models --evidence's UNSCORED list or
          // the projectTeam edit catalog as if it were still current.
          .filter((candidate) => candidate.evidenceStatus === "unscored" && candidate.lifecycle !== "superseded")
          .map((candidate) => ({
            adapterId: candidate.adapterId, modelId: candidate.modelId, displayName: candidate.rawDisplayName,
            candidateKey: candidate.candidateKey, accessMode: candidate.accessMode, lifecycle: candidate.lifecycle
          }));

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
        const runRecords = await listRunRecordsCached("runs", null).catch(() => []);
        ingestKairoTelemetryEvidence(registry, runRecords);
        // Provider quota is a PROVIDER-level fact, never copied into the
        // per-model capability registry as if it were model evidence — see
        // subscription-pressure-source.js. buildEfficientTeam resolves it
        // separately, by adapterId, only as its very last tiebreak.
        const providerCapacity = buildProviderCapacity(remainingPercentByAdapter(codexUsage, claudeUsage, opencodeUsage));

        result.modelIntelligence = {
          status: aa.status, source: aa.source, age: aa.age,
          models: annotateWithRegistryEvidence(scored, registry), roles: bestModelPerRole(scored),
          eligibility, coverage, unscoredModels,
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
          aiTeam: buildAiTeam(scoredAll, eligibility, registry),
          efficientTeam: buildEfficientTeam(scoredAll, eligibility, registry, { providerCapacity }),
          // Raw ingredients (never rendered directly) so a caller that
          // needs a PROJECT-specific re-scoring (see analyzeProject below)
          // can call buildAiTeam/buildEfficientTeam again with the
          // project's own real roleCapabilities, instead of only ever
          // filtering the generic global team by role name. `scoredAll`
          // here is the Recommendation Pool (superseded generations
          // already excluded), not the raw scoreAvailableModels() output
          // — see scoredAllRaw/completeCandidateCatalog above.
          scoredAll, registry, providerCapacity,
          // The real subset Kairo can actually launch itself — exposed
          // for the real task router (not yet built) to consume; never
          // used by QUALITY/EFFICIENT TEAM or ProjectStrategy, which only
          // ever filter by capability/portfolio, never by accessMode.
          automaticExecutionPool
        };
      }
      return result;
    },
    async submitArchitecture({ cwd, task, model = null }) {
      const projectRoot = await root(cwd);
      const result = await createPlan({ cwd: projectRoot, task, model });
      return { ...publicPlan(result.status), reused: result.reused === true, projectRoot };
    },
    /**
     * Real read-only question -> real answer, via whichever provider is
     * actually available/quota-healthy — no task, no plan, no approval
     * gate. Throws (never returns a fabricated answer) if no provider can
     * answer or the call itself fails.
     */
    async askQuestion({ cwd, task }) {
      const projectRoot = await root(cwd);
      const adapters = inspectAdapters({ cwd: projectRoot });
      let codexUsage = null;
      let claudeUsage = null;
      let codexCatalog = {};
      let claudeCatalog = {};
      if (enableProviderProbes) {
        [codexUsage, claudeUsage, codexCatalog] = await Promise.all([
          readCodexUsageCached(projectRoot, { cwd: projectRoot }),
          readClaudeUsageCached("global", {}),
          readCodexModelsImpl()
        ]);
        claudeCatalog = readClaudeModelsImpl();
      }
      const decision = routeAsk({ adapters, codexUsage, claudeUsage, catalogs: { codex: codexCatalog, claude: claudeCatalog }, taskText: task });
      if (decision.decision !== "ROUTED") throw new Error(`Cannot answer: ${decision.why}`);
      const result = await askProviderImpl({ provider: decision.provider, question: task, model: decision.model, cwd: projectRoot });
      if (result.status !== "answered") throw new Error(result.error ?? `${decision.provider} gave no answer.`);
      return { provider: decision.provider, model: decision.model, answer: result.answer, projectRoot };
    },
    /**
     * The composer's real entry point. When the cockpit's explicit WorkMode
     * is given, it decides outright — ASK always answers read-only, never
     * creating a plan; PLAN/AGENT always create a plan (submitArchitecture),
     * never answering directly — replacing the old isLikelyQuestion guess
     * with what the user actually told Kairo they're doing. `mode` is
     * optional only for backward compatibility with any caller that
     * predates WorkMode; the real cockpit always passes it.
     * @param {object} args
     * @param {string} args.cwd
     * @param {string} args.task
     * @param {"ask"|"plan"|"agent"|null} [args.mode]
     */
    async submitTask({ cwd, task, mode = null }) {
      const isQuestion = mode ? mode === "ask" : isLikelyQuestion(task);
      if (isQuestion) {
        const answer = await this.askQuestion({ cwd, task });
        return { kind: "answer", ...answer };
      }
      const plan = await this.submitArchitecture({ cwd, task });
      return { kind: "plan", ...plan };
    },
    /**
     * Real, persisted KairoSession for this project — right now just the
     * current WorkMode ("ask" | "plan" | "agent"). A session that predates
     * WorkMode (or has no file yet) reads as "ask", the strictly read-only
     * default — see session-store.js's readSession.
     */
    async getSession({ cwd }) {
      const projectRoot = await root(cwd);
      return readSessionImpl(homeDir, projectRoot);
    },
    /**
     * Persists a new WorkMode for this project — pure local state, no
     * provider I/O, so Shift+Tab/`/plan` stay instant.
     * @param {{cwd: string, mode: "ask"|"plan"|"agent"}} args
     */
    async setMode({ cwd, mode }) {
      const projectRoot = await root(cwd);
      return writeSessionModeImpl(homeDir, projectRoot, mode);
    },
    /**
     * `/project analyze` (LOCAL_PREFLIGHT -> AWAITING_ANALYST): computes a
     * real, read-only ProjectProfile and real Bootstrap Analyst
     * alternatives (quality/efficient, restricted to providers Kairo can
     * actually run read-only — see project-strategy.js's
     * ASK_SUPPORTED_ADAPTERS) — no provider call yet, no ProjectStrategy
     * created yet. The human picks and confirms one of these via
     * runBootstrapAnalysis below; nothing is persisted until that real
     * analysis actually runs and validates.
     *
     * `analystCatalog` is the full real analyst catalog (every real
     * scored AND unscored ask-supported candidate, see
     * project-strategy.js's computeBootstrapAnalystCatalog) — additive,
     * for a future richer analyst picker; `alternatives` (the existing
     * plain quality/efficient pair) stays unchanged for today's overlay
     * and analyst-run callers, which don't consume the fuller catalog yet.
     */
    async preflightProject({ cwd }) {
      const projectRoot = await root(cwd);
      const profile = await computeProjectProfileImpl({ cwd: projectRoot });
      const snap = await this.snapshot({ cwd: projectRoot });
      const { scoredAll = [], eligibility = {}, registry = null, providerCapacity = null, unscoredModels = [] } = snap.modelIntelligence ?? {};
      const candidates = { scoredAll, eligibility, registry, providerCapacity };
      const alternatives = computeBootstrapAnalystAlternatives(candidates);
      const analystCatalog = computeBootstrapAnalystCatalog({ ...candidates, unscoredModels });
      return { profile, alternatives, candidates, analystCatalog, projectRoot };
    },
    /**
     * `/project analyst quality|efficient --confirm` (ANALYZING -> SUGGESTED):
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
     * @param {{choice: "quality"|"efficient", model: object}} args.analyst
     */
    async runBootstrapAnalysis({ cwd, profile, candidates, analyst }) {
      const projectRoot = await root(cwd);
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
        const prompt = buildAnalystPrompt(profile);
        const adapter = createBootstrapAnalyzerAdapterImpl(analyst.model.adapterId, {
          modelId: analyst.model.modelId,
          deps: {
            askProvider: askProviderImpl, runCodexSandboxedBootstrap: runCodexSandboxedBootstrapImpl, isolationDeps: codexIsolationDeps,
            verifyClaudeSubscriptionAuth: verifyClaudeSubscriptionAuthImpl, readClaudeModels: readClaudeModelsImpl
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
        const response = await adapter.analyze({
          question: prompt, snapshotRoot: snapshot.snapshotRoot, timeoutMs: BOOTSTRAP_ANALYST_TIMEOUT_MS
        });
        if (response.status !== "answered") {
          throw new Error(`Bootstrap Analyst did not answer: ${response.error ?? response.status}`);
        }
        const parsed = parseProjectAnalysisImpl(response.answer);
        if (!parsed.valid) throw new Error(`Bootstrap Analyst response failed validation: ${parsed.error}`);
        // Real-evidence gate, checked PER recommendedRoleNeeds entry (see
        // deriveRoleRequirements): a role need is only trusted when its
        // OWN evidence cites at least one real file the analyst actually
        // had access to — one well-evidenced role need can no longer
        // vouch for every other role need in the same response.
        const roleRequirements = deriveRoleRequirementsImpl(parsed.analysis, profile.roleRequirements, snapshot.copiedFiles);
        const strategy = buildProjectStrategy({ ...profile, roleRequirements }, candidates, analyst);
        await writeProjectStrategyImpl(homeDir, projectRoot, strategy);
        return {
          ...strategy, projectRoot, analysis: parsed.analysis,
          sanitization: { filesCopied: snapshot.filesCopied, secretsRedacted: snapshot.secretsRedacted, excludedPrivatePaths: snapshot.excludedPrivatePaths.length }
        };
      } finally {
        await snapshot.cleanup();
      }
    },
    /** `/project approve`: SUGGESTED -> ACTIVE. Requires a real suggested strategy to already exist — the Bootstrap Analyst choice is already locked in by the time a strategy exists at all (see runBootstrapAnalysis), so there's nothing left to confirm here. */
    async approveProjectStrategy({ cwd }) {
      const projectRoot = await root(cwd);
      const existing = await readProjectStrategyImpl(homeDir, projectRoot);
      if (!existing) throw new Error("No suggested project strategy yet — run /project analyze first.");
      const approved = { ...existing, status: "active", approvedAt: new Date().toISOString() };
      await writeProjectStrategyImpl(homeDir, projectRoot, approved);
      return { ...approved, projectRoot };
    },
    /**
     * `/project refresh`: a strategy that was never approved (no strategy
     * yet, or still just "suggested") is left as-is — the interactive
     * AWAITING_ANALYST/ANALYZING flow (preflightProject + a fresh
     * /project analyze) is the only way to get a new suggestion; refresh
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
        await writeProjectStrategyImpl(homeDir, projectRoot, stale);
        return { ...stale, projectRoot, profile };
      }
      return { ...existing, projectRoot, profile };
    },
    /**
     * The real projectTeam edit catalog for one role (section 4 —
     * "Edición persistida del PROJECT TEAM") — every real, non-superseded
     * candidate from all four real adapters, with its own real
     * availability/evidenceStatus/role evaluation. Read-only; never
     * writes anything, never consumes quota.
     */
    async getProjectTeamEditCatalog({ cwd, role }) {
      const projectRoot = await root(cwd);
      const snap = await this.snapshot({ cwd: projectRoot });
      const { scoredAll = [], eligibility = {}, registry = null, unscoredModels = [] } = snap.modelIntelligence ?? {};
      return computeProjectTeamEditCatalog(role, { scoredAll, eligibility, registry, unscoredModels });
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
      await writeProjectStrategyImpl(homeDir, projectRoot, updated);
      return updated;
    },
    /**
     * Real persisted chat history for this project, kept globally under
     * `~/.harness/sessions/<projectKey>/transcript.json` (not inside the
     * repo — matches Claude Code/Codex/OpenCode's own convention) — loaded
     * once at cockpit startup so a restart never silently drops the
     * conversation, the way plan/task state already survives restarts.
     */
    async loadTranscript({ cwd }) {
      const projectRoot = await root(cwd);
      return readTranscriptImpl(homeDir, projectRoot);
    },
    /** Persists one chat entry; a write failure throws so the caller can surface it. */
    async appendTranscript({ cwd, role, text }) {
      const projectRoot = await root(cwd);
      await appendTranscriptImpl(homeDir, projectRoot, { role, text });
    },
    /** Persists an empty transcript so `/clear` stays cleared across a restart. */
    async clearTranscript({ cwd }) {
      const projectRoot = await root(cwd);
      await clearTranscriptImpl(homeDir, projectRoot);
    },
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
    async decidePlan({ cwd, taskId, decision }) {
      if (![PLAN_STATES.APPROVED, PLAN_STATES.REJECTED].includes(decision)) {
        throw new Error("Decision must be approved or rejected.");
      }
      const projectRoot = await root(cwd);
      const record = await transition(projectRoot, taskId, decision);
      return { ...publicPlan(record, await executionFor(projectRoot, taskId)), projectRoot };
    },
    /**
     * Read-only preview of what executePlan would do right now: runs the
     * real router against the plan's real task text and returns its
     * decision (provider/model/why/fallback), without reserving or
     * launching anything. The cockpit shows this before asking for
     * confirmation, and passes the same provider/model back to executePlan
     * so the preview and the actual launch never disagree.
     */
    async planExecution({ cwd, taskId }) {
      const projectRoot = await root(cwd);
      const record = await readPlan(projectRoot, taskId);
      if (!record) throw new Error(`Plan "${taskId}" not found.`);
      const decision = await routeExecution(projectRoot, record.taskMarkdown ?? record.planMarkdown ?? "");
      return { ...decision, projectRoot, taskId };
    },
    /**
     * @param {object} args
     * @param {string} args.cwd
     * @param {string} args.taskId
     * @param {string|null} [args.model] - explicit model override
     * @param {string|null} [args.agentId] - explicit provider override (e.g. from the cockpit's
     *   manual confirm-execute choice); when omitted, the real router decides.
     */
    async executePlan({ cwd, taskId, model = null, agentId = null }) {
      const projectRoot = await root(cwd);
      const existing = await executionFor(projectRoot, taskId);
      const record = await verifyExecution(projectRoot, taskId, { checkWorkingTree: !existing });
      if (existing) return { ...publicPlan(record, existing), projectRoot, reused: true };

      let resolvedAgentId = agentId;
      let resolvedModel = model;
      if (!resolvedAgentId) {
        const decision = await routeExecution(projectRoot, record.taskMarkdown ?? record.planMarkdown ?? "");
        if (decision.decision !== "ROUTED") {
          throw new Error(`Cannot auto-execute "${taskId}": ${decision.why}`);
        }
        resolvedAgentId = decision.provider;
        resolvedModel = resolvedModel ?? decision.model;
      }

      const runId = newRunId();
      const createdAt = new Date().toISOString();
      try {
        await reserveExecution(projectRoot, taskId, { runId, agentId: resolvedAgentId, state: "reserved", createdAt, updatedAt: createdAt });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const raced = await executionFor(projectRoot, taskId);
        if (!raced) throw error;
        return { ...publicPlan(record, raced), projectRoot, reused: true };
      }
      const task = [
        "Implement the explicitly approved architecture plan below.",
        "Follow repository AGENTS.md and Gentle governance. Do not treat plan approval as any additional governance receipt.",
        "Use safe, non-bypassed permissions for this session.",
        "",
        record.planMarkdown
      ].join("\n");
      try {
        const started = await launchRun({
          homeDir, runId, agentId: resolvedAgentId, task, cwd: projectRoot, model: resolvedModel,
          permissions: [], allowUnsafePermissions: false, permissionSource: "cockpit",
          captureTranscript: false, strategy: "direct", wait: false
        });
        await updateExecution(projectRoot, taskId, {
          runId, agentId: resolvedAgentId, state: started.metadata.state, createdAt, updatedAt: new Date().toISOString()
        });
        return {
          ...publicPlan(record, {
            runId, provider: resolvedAgentId, state: started.metadata.state, active: true,
            error: null, startedAt: started.metadata.startedAt, updatedAt: started.metadata.updatedAt,
            message: `${resolvedAgentId} run is ${started.metadata.state}.`
          }),
          projectRoot,
          reused: false
        };
      } catch (error) {
        await updateExecution(projectRoot, taskId, {
          runId, agentId: resolvedAgentId, state: "failed", error: error.message ?? String(error), createdAt,
          updatedAt: new Date().toISOString()
        });
        throw error;
      }
    },
    async cancelExecution({ cwd, taskId }) {
      const projectRoot = await root(cwd);
      const link = await readExecution(projectRoot, taskId);
      if (!link) throw new Error(`Plan "${taskId}" has no Claude execution.`);
      await cancelRun(homeDir, link.runId);
      const record = await readPlan(projectRoot, taskId);
      return { ...publicPlan(record, await executionFor(projectRoot, taskId)), projectRoot };
    }
  };
}
