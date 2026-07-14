import { createDefaultBackends, inspectIntelligenceBackends, resolveBackendById } from "./registry.js";
import { compileContextPack } from "./context-compiler.js";
import { resolveRoutingDecision } from "./router.js";
import { createUsageTelemetry, PRIVACY_CLASSES } from "./types.js";

/**
 * Orchestrates detect → context → route → privacy gate → invoke.
 * Cloud transmission requires explicit consent. Credentials never touch disk.
 */
export async function runIntelligenceRequest({
  workspaceRoot,
  profile = {},
  task = null,
  prompt = null,
  relevantPaths = [],
  includePrivate = false,
  cloudConsent = false,
  confirmed = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
  backends = null,
  tokenBudget = null,
  sessionOverride = null
} = {}) {
  const customProviders = Array.isArray(profile.customProviders) ? profile.customProviders : [];
  const backendInstances = backends ?? createDefaultBackends({ env, fetchImpl, customProviders });
  const inspections = await inspectIntelligenceBackends({
    env,
    fetchImpl,
    customProviders,
    backends: backendInstances
  });

  const privateConfirmationRequired = includePrivate && !confirmed;
  const contextPack = await compileContextPack({
    workspaceRoot,
    task: task ?? prompt,
    relevantPaths,
    includePrivate: includePrivate && confirmed,
    stableBudgetTokens: profile.stableContextBudget ?? undefined,
    requestBudgetTokens: profile.requestContextBudget ?? undefined
  });

  const routing = resolveRoutingDecision({
    backends: inspections,
    profile,
    contextPack,
    task: task ?? prompt,
    cloudConsent: Boolean(cloudConsent),
    tokenBudget: tokenBudget ?? profile.tokenBudget ?? null,
    sessionOverride
  });

  const explanation = explainRouting(routing, contextPack, inspections);
  const base = {
    routing,
    explanation,
    contextPack: summarizeContextPack(contextPack),
    backends: inspections
  };

  if (privateConfirmationRequired) {
    return {
      ...base,
      ok: false,
      mode: routing.mode,
      diagnosticsOnly: true,
      result: null,
      telemetry: null,
      error: "Including private context requires explicit confirmation (--include-private --yes / --confirm)."
    };
  }

  if (!routing.canInvoke) {
    return {
      ...base,
      ok: false,
      mode: routing.mode,
      diagnosticsOnly: true,
      result: null,
      telemetry: null,
      error: routing.reason
    };
  }

  if (routing.privacyImpact === PRIVACY_CLASSES.CLOUD) {
    if (!cloudConsent) {
      return {
        ...base,
        ok: false,
        mode: routing.mode,
        diagnosticsOnly: true,
        result: null,
        telemetry: null,
        error: "Cloud transmission requires explicit consent."
      };
    }
    if (!confirmed) {
      return {
        ...base,
        ok: false,
        mode: routing.mode,
        diagnosticsOnly: true,
        result: null,
        telemetry: null,
        error: "Confirm cloud context transmission before invoke (--yes / --confirm)."
      };
    }
  }

  const backend = resolveBackendById(backendInstances, routing.backendId);
  if (!backend) {
    return {
      ...base,
      ok: false,
      mode: routing.mode,
      diagnosticsOnly: true,
      result: null,
      telemetry: null,
      error: `Backend ${routing.backendId} is not loaded.`
    };
  }

  const result = await backend.invoke(contextPack, {
    modelId: routing.model?.modelId,
    prompt: prompt ?? task,
    timeoutMs: profile.invokeTimeoutMs ?? undefined
  });

  const telemetry = createUsageTelemetry({
    ...(result.usage ?? {}),
    model: result.model ?? routing.model?.modelId,
    backendId: routing.backendId,
    fallbackUsed: Boolean(result.usage?.fallbackUsed)
  });

  return {
    ...base,
    ok: Boolean(result.ok),
    mode: routing.mode,
    diagnosticsOnly: false,
    result,
    telemetry,
    error: result.ok ? null : (result.error ?? "Invoke failed.")
  };
}

export function explainRouting(routing, contextPack, backends = []) {
  const evidencePaths = (contextPack?.evidence ?? [])
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.path);

  return {
    selectedBackend: routing.backendId,
    selectedModel: routing.model?.modelId ?? null,
    reason: routing.reason,
    mode: routing.mode,
    estimatedTokens: routing.estimatedTokens,
    privacyImpact: routing.privacyImpact,
    requiresCloudConsent: routing.requiresCloudConsent,
    canInvoke: routing.canInvoke,
    evidenceUsed: evidencePaths,
    excludedPrivate: contextPack?.privacy?.excludedPrivate ?? [],
    availableBackends: backends.map((entry) => ({
      id: entry.id,
      state: entry.state,
      available: entry.available,
      modelCount: entry.models?.length ?? 0
    })),
    fallback: routing.fallback
  };
}

function summarizeContextPack(contextPack) {
  if (!contextPack) return null;
  return {
    workspaceRoot: contextPack.workspaceRoot,
    estimatedTokens: contextPack.estimatedTokens,
    project: contextPack.stable?.project ?? null,
    evidenceCount: contextPack.evidence?.length ?? 0,
    evidence: contextPack.evidence,
    privacy: contextPack.privacy,
    budgets: contextPack.budgets,
    skills: contextPack.stable?.skills ?? [],
    sdd: contextPack.stable?.sdd ?? false,
    tdd: contextPack.stable?.tdd ?? false,
    graphify: contextPack.stable?.graphify ?? null,
    hasAgentsMd: Boolean(contextPack.stable?.agentsMd),
    relevantFiles: (contextPack.perRequest?.files ?? []).map((file) => file.path)
  };
}
