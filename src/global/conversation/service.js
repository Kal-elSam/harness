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
import { readArtificialAnalysisModels } from "../observability/artificial-analysis-models.js";
import { bestModelPerRole, scoreAvailableModels, summarizeCatalogCoverage } from "../intelligence/model-intelligence.js";

export const CONVERSATION_SCHEMA = "kairo.conversation/v1";

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
    modelIntelligence: { status: "unknown", source: null, age: null, models: [], roles: [], eligibility: {}, coverage: [] },
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
      if (enableProviderProbes) {
        const [codexCatalog, opencodeGoCatalog, cursorCatalog, aa] = await Promise.all([
          readCodexModelsCached(projectRoot, { cwd: projectRoot }),
          readOpenCodeGoModelsCached("global", {}),
          readCursorModelsCached(projectRoot, { cwd: projectRoot }),
          readArtificialAnalysisModelsCached("global", {})
        ]);
        // Same eligibility policy the execution/ask router uses: FIT can
        // never recommend a provider that isn't actually available,
        // launchable, or has usable quota right now — capability alone
        // never overrides that. Zen and Cursor are always excluded here
        // (PAYG risk / manual-only), independent of any benchmark score.
        const eligibility = {};
        const candidates = [];
        for (const adapterId of ["codex", "claude", "opencode-go", "opencode-zen", "cursor"]) {
          const check = checkCandidate(adapterId, { adapters, codexUsage, claudeUsage, opencodeGoUsage: opencodeUsage?.go });
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
        result.modelIntelligence = {
          status: aa.status, source: aa.source, age: aa.age, models: scored, roles: bestModelPerRole(scored), eligibility, coverage
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
     * The composer's real entry point: classifies free text as a read-only
     * question (answered directly, no task/plan) or a change request
     * (creates a Codex plan, same as submitArchitecture) — so a simple
     * question no longer forces a plan + approval gate onto the user.
     */
    async submitTask({ cwd, task }) {
      if (isLikelyQuestion(task)) {
        const answer = await this.askQuestion({ cwd, task });
        return { kind: "answer", ...answer };
      }
      const plan = await this.submitArchitecture({ cwd, task });
      return { kind: "plan", ...plan };
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
