import { resolveHomeDir } from "./paths.js";
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

export async function runIntelligenceCli(options, packageManifest) {
  const action = options.intelligenceAction ?? "status";
  const homeDir = resolveHomeDir();
  const workspaceRoot = options.cwd;
  const { profile, sources } = await resolveProfile({ homeDir, workspaceRoot });

  switch (action) {
    case "status":
      return printIntelligenceStatus({
        homeDir,
        workspaceRoot,
        profile,
        sources,
        json: options.json,
        env: process.env
      });
    case "models":
      return printIntelligenceModels({
        profile,
        json: options.json,
        env: process.env
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
        env: process.env
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
        packageManifest
      });
    default:
      throw new Error(
        `Unknown intelligence action "${action}". Use status, models, context, route, or ask.`
      );
  }
}

async function printIntelligenceStatus({ homeDir, workspaceRoot, profile, sources, json, env }) {
  const backends = await inspectIntelligenceBackends({
    env,
    customProviders: profile.customProviders
  });
  const summary = summarizeIntelligenceBackends(backends);
  const routing = resolveRoutingDecision({
    backends,
    profile,
    cloudConsent: false
  });

  const payload = {
    readOnly: true,
    homeDir,
    workspaceRoot,
    profile: buildProfileJson({ profile, sources }),
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

async function printIntelligenceModels({ profile, json, env }) {
  const backends = await inspectIntelligenceBackends({
    env,
    customProviders: profile.customProviders
  });

  const models = backends.flatMap((backend) =>
    (backend.models ?? []).map((model) => ({
      ...model,
      backendState: backend.state,
      available: backend.available
    }))
  );

  const payload = { readOnly: true, models, backends: backends.map((entry) => ({
    id: entry.id,
    state: entry.state,
    available: entry.available
  })) };

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
  env
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
    cloudConsent: Boolean(cloudConsent)
  });

  const payload = {
    readOnly: true,
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
  env
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
    env
  });

  if (json) {
    console.log(JSON.stringify({
      ok: outcome.ok,
      mode: outcome.mode,
      diagnosticsOnly: outcome.diagnosticsOnly,
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
