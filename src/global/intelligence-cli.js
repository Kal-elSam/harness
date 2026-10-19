import { resolveHomeDir } from "./paths.js";
import { join } from "node:path";
import { resolveProfile, buildProfileJson } from "./profile.js";
import {
  compileContextPack,
  inspectIntelligenceBackends,
  resolveRoutingDecision,
  runIntelligenceRequest,
  summarizeIntelligenceBackends
} from "./intelligence/index.js";
import { BRAND } from "./brand/index.js";
import { formatCliCommand } from "./brand/cli.js";
import { resolveSessionOverride } from "./intelligence-session.js";

import { buildAptitudeAuthorizationRequest, executeAuthorizedAptitudeRun, stageOneResultsFromEvidence } from "./intelligence/role-aptitude-run.js";
import { createRunInvokeAdapter } from "./intelligence/role-aptitude-invoke.js";
import { startRun } from "./runtime/run-manager.js";
import { createPersistentRoleAptitudeEvidenceStore } from "./intelligence/role-aptitude-evidence.js";
import { buildAptitudePlan } from "./intelligence/role-aptitude-plan.js";
import { listRoleAptitudeProbes } from "./intelligence/role-aptitude-probes.js";
import { createSubscriptionBridge } from "./intelligence/role-aptitude-subscription-bridge.js";
import { assertOperationalAuthorization } from "./intelligence/role-aptitude-authorization.js";
import { ensureRegistry } from "./intelligence/model-intelligence.js";
import { computeRoleGapValue } from "./intelligence/capability-scoring.js";
import { ROLE_CAPABILITIES, ROLE_METRIC_WEIGHTS } from "./intelligence/role-profiles.js";
import { readAgentSessionTelemetry } from "./observability/agent-session-telemetry.js";
import { listRunRecords } from "./runtime/run-store.js";
import { buildRoleTelemetry, kairoRunToTelemetryRecord } from "./intelligence/role-telemetry.js";

export async function runIntelligenceCli(options, packageManifest, deps = {}) {
  const action = options.intelligenceAction ?? "status";
  // Refuse before profile, catalog, telemetry or provider discovery.
  if (action === "aptitude-run") {
    let authorization = options.aptitudeAuthorization;
    if (typeof authorization === "string") {
      try { authorization = JSON.parse(authorization); }
      catch { throw new Error("aptitude-run: --authorization must be a JSON object"); }
    }
    if (!authorization) throw new Error("aptitude-run: explicit operational authorization is required");
    if (!Array.isArray(authorization.grants) || !authorization.planFingerprint) {
      throw new Error("aptitude-run: authorization requires an exact plan binding and grants");
    }
    // Production default: strict subscription billing bridge (S52); injected bridges win.
    const authorizationContext = deps.authorizationContext
      ?? { bridge: createSubscriptionBridge(deps.subscriptionBridgeOptions) };
    // Verify every identity/billing grant before catalog or telemetry discovery.
    for (const grant of authorization.grants) {
      const result = await assertOperationalAuthorization(grant, authorizationContext);
      if (!result.ok) throw new Error(`aptitude-run: authorization refused (${result.code}): ${result.reason}`);
    }
    const plan = await printAptitudePlan(options, deps, true);
    const evidenceStore = deps.evidenceStore ?? await createPersistentRoleAptitudeEvidenceStore({
      homeDir: deps.homeDir ?? resolveHomeDir()
    });
    let tokens = null;
    const captureTokens = adapter => {
      const wrapped = async context => {
        tokens = null;
        const output = await adapter(context);
        tokens = output?.tokenUsage?.total ?? output?.tokens ?? null;
        return output;
      };
      wrapped.executionKind = adapter.executionKind;
      return wrapped;
    };
    // Adapter construction stays behind the executor's exact binding checks.
    const createInvokeAdapter = () => captureTokens((deps.createRunInvokeAdapter ?? createRunInvokeAdapter)({
      homeDir: deps.homeDir ?? resolveHomeDir(), startRun: deps.startRun ?? startRun
    }));
    const report = await executeAuthorizedAptitudeRun({
      plan, stage: authorization.stage ?? 1, authorization,
      invokeAdapter: deps.invokeAdapter ? captureTokens(deps.invokeAdapter) : undefined,
      createInvokeAdapter,
      evidenceStore: { ...evidenceStore, recordAttempt: fields => {
        const recorded = evidenceStore.recordAttempt({ ...fields, tokens });
        tokens = null;
        return recorded;
      } },
      ...authorizationContext
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.evidencePersisted === false) {
      throw new Error(`aptitude-run: evidence was not persisted (${report.evidenceError ?? "flush failed"})`);
    }
    return report;
  }
  if (action === "aptitude-plan") return printAptitudePlan(options, deps);
  const homeDir = resolveHomeDir();
  const workspaceRoot = options.cwd;
  const { profile, sources } = await resolveProfile({ homeDir, workspaceRoot });
  const sessionOverride = resolveSessionOverride(options);

  switch (action) {
    case "status":
      return printIntelligenceStatus({
        homeDir,
        workspaceRoot,
        profile,
        sources,
        json: options.json,
        env: process.env,
        sessionOverride
      });
    case "models":
      return printIntelligenceModels({
        profile,
        json: options.json,
        env: process.env,
        sessionOverride
      });
    case "context":
      return printIntelligenceContext({
        workspaceRoot,
        profile,
        task: options.intelligenceTask,
        relevantPaths: options.intelligencePaths ?? [],
        includePrivate: options.includePrivate,
        confirmed: options.yes || options.confirm,
        json: options.json
      });
    case "route":
      return printIntelligenceRoute({
        workspaceRoot,
        profile,
        task: options.intelligenceTask,
        cloudConsent: options.cloudConsent,
        json: options.json,
        env: process.env,
        sessionOverride
      });
    case "ask":
      return runIntelligenceAsk({
        workspaceRoot,
        profile,
        task: options.intelligenceTask,
        prompt: options.intelligencePrompt,
        relevantPaths: options.intelligencePaths ?? [],
        includePrivate: options.includePrivate,
        cloudConsent: options.cloudConsent,
        confirmed: options.yes || options.confirm,
        json: options.json,
        env: process.env,
        packageManifest,
        sessionOverride
      });
    default:
      throw new Error(
        `Unknown intelligence action "${action}". Use status, models, context, route, ask, aptitude-plan, or aptitude-run.`
      );
  }
}

async function printIntelligenceStatus({
  homeDir,
  workspaceRoot,
  profile,
  sources,
  json,
  env,
  sessionOverride
}) {
  const backends = await inspectIntelligenceBackends({
    env,
    customProviders: profile.customProviders
  });
  const summary = summarizeIntelligenceBackends(backends);
  const routing = resolveRoutingDecision({
    backends,
    profile,
    cloudConsent: false,
    sessionOverride
  });

  const payload = {
    readOnly: true,
    homeDir,
    workspaceRoot,
    profile: buildProfileJson({ profile, sources }),
    sessionOverride,
    backends,
    summary,
    routing
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(`${BRAND.displayName} intelligence — status`);
  console.log(`Home: ${homeDir}`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("");
  for (const backend of backends) {
    const models = backend.models?.length ?? 0;
    console.log(
      `  ${backend.label.padEnd(14)} ${backend.state.padEnd(14)} models=${models}`
    );
  }
  console.log("");
  console.log(`Routing: ${routing.reason}`);
  console.log(`Can invoke: ${routing.canInvoke ? "yes" : "no"}`);
  if (!summary.localAvailable && !summary.cloudAuthenticated) {
    console.log("");
    console.log("Diagnostics mode: configure Ollama or OPENROUTER_API_KEY to enable inference.");
  }
  return payload;
}

async function printIntelligenceModels({ profile, json, env, sessionOverride }) {
  const backends = await inspectIntelligenceBackends({
    env,
    customProviders: profile.customProviders
  });
  const filterId = sessionOverride?.preferredBackend ?? null;
  const filtered = filterId
    ? backends.filter((backend) => backend.id === filterId)
    : backends;

  const models = filtered.flatMap((backend) =>
    (backend.models ?? []).map((model) => ({
      ...model,
      backendState: backend.state,
      available: backend.available
    }))
  );

  const payload = {
    readOnly: true,
    sessionOverride,
    models,
    backends: filtered.map((entry) => ({
      id: entry.id,
      state: entry.state,
      available: entry.available
    }))
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(`${BRAND.displayName} intelligence — models`);
  if (models.length === 0) {
    console.log("  No models detected. Start Ollama or set OPENROUTER_API_KEY.");
  } else {
    for (const model of models) {
      console.log(
        `  ${model.provider.padEnd(12)} ${model.modelId.padEnd(32)} ${model.privacyClass}/${model.costClass}`
      );
    }
  }
  return payload;
}

async function printIntelligenceContext({
  workspaceRoot,
  profile,
  task,
  relevantPaths,
  includePrivate,
  confirmed,
  json
}) {
  const privateConfirmationRequired = includePrivate && !confirmed;
  const pack = await compileContextPack({
    workspaceRoot,
    task,
    relevantPaths,
    includePrivate: includePrivate && confirmed,
    stableBudgetTokens: profile.stableContextBudget ?? undefined,
    requestBudgetTokens: profile.requestContextBudget ?? undefined
  });

  const payload = {
    readOnly: true,
    estimatedTokens: pack.estimatedTokens,
    project: pack.stable.project,
    evidence: pack.evidence,
    privacy: pack.privacy,
    skills: pack.stable.skills,
    sdd: pack.stable.sdd,
    tdd: pack.stable.tdd,
    graphify: pack.stable.graphify,
    hasAgentsMd: Boolean(pack.stable.agentsMd),
    relevantFiles: pack.perRequest.files.map((file) => file.path)
  };

  if (privateConfirmationRequired) {
    payload.privateConfirmationRequired = true;
    payload.error = "Including private context requires explicit confirmation (--include-private --yes / --confirm).";
  }

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(`${BRAND.displayName} intelligence — context`);
  console.log(`Estimated tokens: ${pack.estimatedTokens}`);
  console.log(`Project: ${pack.stable.project.name} (${pack.stable.project.stack})`);
  console.log(`Evidence files: ${pack.evidence.filter((entry) => entry.kind === "file").length}`);
  if (privateConfirmationRequired) {
    console.log(`Blocked: ${payload.error}`);
  }
  if (pack.privacy.excludedPrivate.length > 0) {
    console.log(`Excluded private: ${pack.privacy.excludedPrivate.join(", ")}`);
  }
  return payload;
}

async function printIntelligenceRoute({
  workspaceRoot,
  profile,
  task,
  cloudConsent,
  json,
  env,
  sessionOverride
}) {
  const backends = await inspectIntelligenceBackends({
    env,
    customProviders: profile.customProviders
  });
  const pack = await compileContextPack({ workspaceRoot, task });
  const routing = resolveRoutingDecision({
    backends,
    profile,
    contextPack: pack,
    task,
    cloudConsent: Boolean(cloudConsent),
    sessionOverride
  });

  const payload = {
    readOnly: true,
    sessionOverride,
    routing,
    estimatedTokens: pack.estimatedTokens,
    evidenceUsed: pack.evidence.filter((entry) => entry.kind === "file").map((entry) => entry.path)
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(`${BRAND.displayName} intelligence — routing`);
  console.log(`Backend: ${routing.backendId ?? "none"}`);
  console.log(`Model: ${routing.model?.modelId ?? "none"}`);
  console.log(`Reason: ${routing.reason}`);
  console.log(`Estimated tokens: ${routing.estimatedTokens}`);
  console.log(`Privacy: ${routing.privacyImpact}`);
  console.log(`Can invoke: ${routing.canInvoke ? "yes" : "no"}`);
  return payload;
}

async function runIntelligenceAsk({
  workspaceRoot,
  profile,
  task,
  prompt,
  relevantPaths,
  includePrivate,
  cloudConsent,
  confirmed,
  json,
  env,
  sessionOverride
}) {
  if (!prompt && !task) {
    throw new Error(`Missing prompt. Use: ${formatCliCommand("intelligence ask --prompt \"...\"")}`);
  }

  const outcome = await runIntelligenceRequest({
    workspaceRoot,
    profile,
    task,
    prompt: prompt ?? task,
    relevantPaths,
    includePrivate,
    cloudConsent,
    confirmed,
    env,
    sessionOverride
  });

  if (json) {
    console.log(JSON.stringify({
      ok: outcome.ok,
      mode: outcome.mode,
      diagnosticsOnly: outcome.diagnosticsOnly,
      sessionOverride,
      routing: outcome.routing,
      explanation: outcome.explanation,
      telemetry: outcome.telemetry,
      content: outcome.result?.content ?? null,
      error: outcome.error
    }, null, 2));
    return outcome;
  }

  console.log(`${BRAND.displayName} intelligence — ask`);
  console.log(`Routing: ${outcome.explanation.reason}`);
  console.log(`Estimated tokens: ${outcome.explanation.estimatedTokens}`);
  console.log(`Privacy: ${outcome.explanation.privacyImpact}`);
  console.log("");

  if (!outcome.ok) {
    console.log(`Blocked: ${outcome.error}`);
    if (outcome.routing?.requiresCloudConsent) {
      console.log(`Retry with --cloud-consent --yes after reviewing context (${formatCliCommand("intelligence context")}).`);
    }
    return outcome;
  }

  console.log(outcome.result.content);
  if (outcome.telemetry) {
    console.log("");
    console.log(
      `Usage: in=${outcome.telemetry.inputTokens ?? "?"} out=${outcome.telemetry.outputTokens ?? "?"} model=${outcome.telemetry.model}`
    );
  }
  return outcome;
}

async function printAptitudePlan(options, deps, silent = false) {
  const preflightProject = deps.preflightProject ?? (async args => {
    const { createConversationService } = await import("./conversation/service.js");
    return createConversationService().preflightProject(args);
  });
  const { candidates: inputs } = await preflightProject({ cwd: options.cwd, mode: "catalog" });
  const candidates = inputs.teamSelectionPool ?? inputs.scoredAll ?? [];
  const homeDir = deps.homeDir ?? resolveHomeDir();
  const [sessions, runs] = await Promise.all([
    Promise.resolve().then(() => (deps.readAgentSessionTelemetry ?? readAgentSessionTelemetry)({
      projectsDir: join(homeDir, ".claude", "projects"),
      sessionsDir: process.env.CODEX_HOME ? join(process.env.CODEX_HOME, "sessions") : join(homeDir, ".codex", "sessions")
    })).catch(() => ({ records: [] })),
    Promise.resolve().then(() => (deps.listRunRecords ?? listRunRecords)(homeDir)).catch(() => [])
  ]);
  let roleTelemetry = inputs.roleTelemetry ?? null;
  try {
    const records = [...(sessions?.records ?? []), ...(runs ?? []).map(kairoRunToTelemetryRecord).filter(Boolean)];
    if (records.length) roleTelemetry = buildRoleTelemetry(records, candidates);
  } catch { /* Optional telemetry must not interrupt dry-run planning. */ }
  const registry = ensureRegistry(candidates, inputs.registry);
  const probes = listRoleAptitudeProbes();
  const capabilityByRole = Object.fromEntries([...new Set(probes.map(probe => probe.role))].map(role => [
    role, computeRoleGapValue(registry, candidates, ROLE_CAPABILITIES[role]?.required ?? [], ROLE_METRIC_WEIGHTS[role])
  ]));
  const plan = (deps.buildAptitudePlan ?? buildAptitudePlan)({ probes, candidates, capabilityByRole,
    teamProviders: deps.teamProviders, providerCapacity: inputs.providerCapacity, roleTelemetry });
  if (silent) return plan;
  if (options.aptitudeAuthorization === "request-stage-2") {
    // Stage 2 is resolved from stored stage-1 results before authorization is requested.
    const store = deps.evidenceStore ?? await createPersistentRoleAptitudeEvidenceStore({ homeDir });
    const stageOneResults = stageOneResultsFromEvidence(plan, store, { accountKey: deps.accountKey });
    const request = buildAptitudeAuthorizationRequest({ plan, stage: 2, stageOneResults });
    console.log(JSON.stringify(request, null, 2));
    return request;
  }
  if (options.aptitudeAuthorization === "request") {
    const request = buildAptitudeAuthorizationRequest({ plan });
    console.log(JSON.stringify(request, null, 2));
    return request;
  }
  if (options.json) console.log(JSON.stringify(plan, null, 2));
  else {
    console.log("Role aptitude plan — dry run, no model invoked (Artificial Analysis prices)");
    console.log(`Most paced quota headroom: ${plan.headroomProvider ?? "unknown"}`);
    console.log(`Default tokens/call: ${plan.defaults.tokensPerCall} (conservative context/tool-turn allowance)`);
    for (const entry of plan.roles) {
      console.log(`\n${entry.role}: ${entry.probes.join(", ")}`);
      console.log(`  Cheap-first candidates: ${entry.candidates.map(model => `${model.adapterId}::${model.modelId}`).join(", ")}`);
      for (const model of entry.stage1) console.log(`  Stage 1: ${model.adapterId}::${model.modelId}`);
      for (const { model, reason } of entry.stage2) console.log(`  Stage 2 (conditional): ${model.adapterId}::${model.modelId} — ${reason}`);
      for (const [key, value] of Object.entries(entry.estimate)) {
        console.log(`  ${key}: calls=${value.calls}, tokens=${value.tokens} (${value.tokenSource}), USD=${value.usd ?? "unknown"}; ${value.priceAssumption}`);
      }
    }
    console.log(`\nTotals: calls=${plan.totals.calls}, tokens=${plan.totals.tokens}, USD=${plan.totals.usd ?? "unknown"}`);
    console.log(plan.totalsAssumption);
    console.log(plan.stage2Policy);
    console.log("Authorization binding: kairo intelligence aptitude-plan --authorization request --json");
    console.log("Run: kairo intelligence aptitude-run --authorization '<JSON binding plus grants>'");
    console.log("Grants require provider, modelId, accountKey, exact roles, maxCalls, absoluteTimeoutMs, maxOutputBytes, billingCertainty=no_additional_charge, verifiedIdentity; bridge receipts are mandatory.");
    console.log("Stage 2 binding (resolved from stored stage 1 results): kairo intelligence aptitude-plan --authorization request-stage-2");
    console.log("Stage 2 additionally requires stage=2 binding, stage1Report and issuedAt after stage1Report.completedAt.");
  }
  return plan;
}
