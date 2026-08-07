import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  runComponentsConfigure,
  runComponentsRollback,
  runComponentsVerify
} from "./global/component-integration-cli.js";
import {
  printGlobalComponents,
  printGlobalDetect,
  runComponentsImport,
  runComponentsInit,
  runComponentsPack,
  runComponentsValidate,
  runGlobalAdapters,
  runGlobalBackups,
  runGlobalDoctor,
  runGlobalInstall,
  runGlobalRollback,
  runGlobalSetup,
  runGlobalStatus,
  runGlobalSync,
  runGlobalUninstall,
  runGlobalUpgrade,
  runGlobalExplain,
  runGlobalDiff,
  runGlobalPolicy,
  runGlobalHistory,
  runGlobalReport
} from "./global/global-cli.js";
import { runEcosystemUpdatesCheck } from "./global/updates-cli.js";
import { applyPolicyToOptions, loadPolicyFile } from "./global/policy.js";
import { resolveHomeDir } from "./global/paths.js";
import { runWorkspaceDetect, runWorkspaceDoctor, runWorkspaceInit, runWorkspaceUpdate } from "./workspace-cli.js";
import { runOrchestratorDiagnostics, runOrchestratorShell } from "./global/orchestrator.js";
import { runIntelligenceCli } from "./global/intelligence-cli.js";
import { runGlobalRun, runGlobalRuns } from "./global/runtime/run-cli.js";
import { runGlobalReview, runGlobalReviews } from "./global/runtime/review/review-cli.js";
import { runGlobalMonitor } from "./global/runtime/monitor/monitor-cli.js";
import { runGlobalAlerts } from "./global/runtime/alerts/alert-cli.js";
import { runGraphifyCli } from "./global/observability/graphify-ops.js";
import { normalizeRunStrategy } from "./global/runtime/run-strategy.js";
import {
  formatCliCommand,
  maybeWarnLegacyCli,
  resolveSuggestedInvocation
} from "./global/brand/cli.js";
import {
  INITIAL_EXPERIENCE,
  hasConfiguredGlobalState,
  resolveInitialExperience
} from "./global/initial-experience.js";
import { printHelp } from "./global/cli-help.js";

export { resolveSuggestedInvocation };

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const SCOPES = new Set(["agent-global", "workspace"]);

export async function runCli(argv) {
  const { command, options, isImplicitCommand } = parseArgs(argv);
  maybeWarnLegacyCli(process.argv, { json: options.json });

  if (options.help || command === "help") {
    printHelp({ all: options.helpAll === true });
    return;
  }

  const packageManifest = await readPackageManifest();

  if (options.version || command === "version") {
    console.log(packageManifest.version);
    return;
  }

  const optionsWithPolicy = await applyCommandPolicy(command, options);
  const invoke = resolveSuggestedInvocation(packageManifest.name);

  switch (command) {
    case "shell": {
      const homeDir = resolveHomeDir();
      const resolvedMode = resolveInitialExperience({
        interactive: optionsWithPolicy.interactive,
        isImplicitCommand,
        hasGlobalState: hasConfiguredGlobalState(homeDir)
      });
      await runOrchestratorShell({
        packageRoot,
        packageManifest,
        workspaceRoot: optionsWithPolicy.cwd,
        interactive: optionsWithPolicy.interactive,
        initialMode: resolvedMode ?? INITIAL_EXPERIENCE.DASHBOARD
      });
      return;
    }
    case "orchestrator":
      await runOrchestratorDiagnostics({
        homeDir: resolveHomeDir(),
        workspaceRoot: optionsWithPolicy.cwd,
        packageName: packageManifest.name,
        packageRoot,
        cliVersion: packageManifest.version,
        json: optionsWithPolicy.json
      });
      return;
    case "run":
      await runGlobalRun(optionsWithPolicy, packageManifest);
      return;
    case "runs":
      await runGlobalRuns(optionsWithPolicy, packageManifest);
      return;
    case "review":
      await runGlobalReview(optionsWithPolicy, packageManifest);
      return;
    case "reviews":
      await runGlobalReviews(optionsWithPolicy, packageManifest);
      return;
    case "monitor":
      await runGlobalMonitor(optionsWithPolicy, packageManifest, { packageRoot });
      return;
    case "alerts":
      await runGlobalAlerts(optionsWithPolicy);
      return;
    case "graphify":
      await runGraphifyCli(optionsWithPolicy, packageManifest);
      return;
    case "mcp": {
      // Lazy-load: MCP SDK is heavy and optional for day-to-day CLI (help/status/sync).
      const { runKairoMcp } = await import("./global/mcp/kairo-mcp.js");
      // stdout reserved for MCP protocol — no banners/logs here
      await runKairoMcp({
        cwd: optionsWithPolicy.cwd,
        packageRoot,
        packageName: packageManifest.name,
        version: packageManifest.version
      });
      return;
    }
    case "intelligence":
      await runIntelligenceCli(optionsWithPolicy, packageManifest);
      return;
    case "setup":
      await runGlobalSetup(optionsWithPolicy, packageManifest, packageRoot);
      return;
    case "status":
      await runGlobalStatus(packageRoot, {
        workspaceRoot: optionsWithPolicy.cwd,
        json: optionsWithPolicy.json,
        cliVersion: packageManifest.version
      });
      return;
    case "sync":
      await runGlobalSync(optionsWithPolicy, packageManifest, packageRoot);
      return;
    case "upgrade":
      await runGlobalUpgrade(optionsWithPolicy, packageManifest, packageRoot);
      return;
    case "updates":
      await runEcosystemUpdatesCheck(optionsWithPolicy, packageManifest);
      return;
    case "install":
      await dispatchByScope(options, "agent-global", {
        "agent-global": () => runGlobalInstall(options, packageManifest, packageRoot),
        workspace: () => runWorkspaceInit(options, packageManifest, packageRoot, invoke)
      });
      return;
    case "init":
      await dispatchByScope(options, "workspace", {
        "agent-global": () => runGlobalInstall(options, packageManifest, packageRoot),
        workspace: () => runWorkspaceInit(options, packageManifest, packageRoot, invoke)
      });
      return;
    case "update":
      await dispatchByScope(options, "agent-global", {
        "agent-global": () => runGlobalInstall(options, packageManifest, packageRoot, { update: true }),
        workspace: () => runWorkspaceUpdate(options, packageManifest, packageRoot)
      });
      return;
    case "doctor":
      await dispatchByScope(options, "agent-global", {
        "agent-global": () => runGlobalDoctor(packageRoot, {
          workspaceRoot: options.cwd,
          json: options.json,
          cliVersion: packageManifest.version
        }),
        workspace: () => runWorkspaceDoctor(options)
      });
      return;
    case "uninstall":
      if (options.scope === "workspace") {
        throw new Error('Workspace uninstall is not supported yet. Remove workspace files manually or via git.');
      }
      await runGlobalUninstall(options, packageManifest);
      return;
    case "detect":
      printGlobalDetect();
      console.log("");
      await runWorkspaceDetect(options, invoke);
      return;
    case "adapters":
      await runGlobalAdapters({
        json: options.json,
        cliVersion: packageManifest.version
      });
      return;
    case "explain":
      await runGlobalExplain({
        json: options.json,
        cliVersion: packageManifest.version
      });
      return;
    case "diff":
      await runGlobalDiff({
        packageManifest,
        packageRoot,
        json: options.json,
        workspaceRoot: options.cwd
      });
      return;
    case "backups":
      await runGlobalBackups();
      return;
    case "history":
      await runGlobalHistory(options, packageManifest);
      return;
    case "rollback":
      await runGlobalRollback(options, packageManifest);
      return;
    case "components":
      await dispatchComponentsCommand(options, invoke);
      return;
    case "policy":
      await runGlobalPolicy(options, packageManifest);
      return;
    case "report":
      await runGlobalReport({
        packageManifest,
        packageRoot,
        json: options.json,
        workspaceRoot: options.cwd,
        historyLimit: options.limit,
        outPath: options.outPath
      });
      return;
    default:
      throw new Error(`Unknown command "${command}". Run "${invoke} help".`);
  }
}

async function dispatchByScope(options, defaultScope, handlers) {
  const scope = options.scope ?? defaultScope;
  const handler = handlers[scope];
  await handler();
}

async function dispatchComponentsCommand(options, invoke) {
  switch (options.componentsAction) {
    case null:
      printGlobalComponents({ workspaceRoot: options.cwd });
      return;
    case "validate":
      runComponentsValidate({ workspaceRoot: options.cwd });
      return;
    case "init":
      await runComponentsInit(options);
      return;
    case "pack":
      await runComponentsPack(options);
      return;
    case "import":
      await runComponentsImport(options);
      return;
    case "configure":
      await runComponentsConfigure({ ...options, packageRoot });
      return;
    case "verify":
      await runComponentsVerify({ ...options, packageRoot });
      return;
    case "rollback":
      await runComponentsRollback(options);
      return;
    default:
      throw new Error(
        `Unknown components action "${options.componentsAction}". Run "${invoke} help".`
      );
  }
}

async function applyCommandPolicy(command, options) {
  if (!new Set(["setup", "sync", "upgrade"]).has(command)) {
    return options;
  }

  const homeDir = resolveHomeDir();
  const rawPolicy = await loadPolicyFile(homeDir);
  return applyPolicyToOptions(options, rawPolicy);
}

async function readPackageManifest() {
  return JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
}

function resolveImplicitCommand(args) {
  if (argsWantsWorkspaceScope(args)) {
    return "init";
  }
  if (hasImplicitSetupFlags(args)) {
    return "setup";
  }
  return "shell";
}

function hasImplicitSetupFlags(args) {
  const setupFlags = new Set([
    "--dry-run",
    "--yes",
    "-y",
    "--confirm",
    "--simple",
    "--no-preflight",
    "--all-adapters",
    "--no-default-components",
    "--detect"
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (setupFlags.has(arg)) return true;
    if (arg.startsWith("--mode=")) return true;
    if (arg.startsWith("--adapters=") || arg.startsWith("--agents=")) return true;
    if (arg.startsWith("--components=")) return true;
    if (arg === "--mode" || arg === "--adapters" || arg === "--agents" || arg === "--components") {
      return true;
    }
  }

  return false;
}

function argsWantsWorkspaceScope(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--scope=workspace") return true;
    if (arg === "--scope" && args[index + 1] === "workspace") return true;
  }
  return false;
}

export function parseArgs(argv) {
  const args = [...argv];
  const firstArg = args[0];
  const implicitCommand = !firstArg || firstArg.startsWith("-");
  const rawCommand = implicitCommand ? resolveImplicitCommand(args) : args.shift();
  const command = normalizeCommand(rawCommand);
  const options = {
    cwd: process.cwd(),
    scope: null,
    mode: "standard",
    modeExplicit: false,
    detect: implicitCommand,
    adapters: null,
    allAdapters: false,
    components: null,
    componentsAction: null,
    componentId: null,
    receiptId: null,
    persona: null,
    label: null,
    outPath: null,
    bundlePath: null,
    noDefaultComponents: false,
    force: false,
    dryRun: false,
    yes: false,
    confirm: false,
    preflight: true,
    preflightExplicit: false,
    yesExplicit: false,
    confirmExplicit: false,
    adaptersExplicit: false,
    componentsExplicit: false,
    json: false,
    apply: false,
    snapshot: null,
    policyAction: null,
    policyKey: null,
    policyValue: null,
    historyAction: null,
    historyCommand: null,
    historyEventAction: null,
    limit: null,
    simple: false,
    help: false,
    helpAll: false,
    version: false,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    intelligenceAction: null,
    intelligenceTask: null,
    intelligencePrompt: null,
    intelligencePaths: [],
    runsAction: null,
    runId: null,
    reviewId: null,
    lineage: null,
    reviewsAction: null,
    confirmImport: false,
    alertsAction: null,
    alertId: null,
    confirmResolve: false,
    confirmDismiss: false,
    graphifyAction: null, graphifyArgs: [], graphifyBudget: null, graphPath: null,
    updatesAction: "check",
    base: null,
    commit: null,
    staged: false,
    failOn: null,
    agent: null,
    task: null,
    model: null,
    strategy: "direct",
    intelligenceBackend: null,
    permissions: null,
    allowUnsafePermissions: false,
    captureTranscript: false,
    follow: false,
    wait: true,
    activeOnly: false,
    timeoutMs: null,
    includePrivate: false,
    cloudConsent: false
  };

  if (command === "components") {
    parseComponentsAction(args, options);
  }

  if (command === "policy") {
    parsePolicyAction(args, options);
  }

  if (command === "history") {
    parseHistoryAction(args, options);
  }

  if (command === "runs") {
    parseRunsAction(args, options);
  }

  if (command === "reviews") {
    parseReviewsAction(args, options);
  }

  if (command === "intelligence") {
    parseIntelligenceAction(args, options);
  }

  if (command === "monitor") {
    parseMonitorAction(args, options);
  }

  if (command === "alerts") {
    parseAlertsAction(args, options);
  }

  if (command === "graphify") parseGraphifyAction(args, options);
  if (command === "updates") parseUpdatesAction(args, options);

  if (command === "help") {
    while (args[0] === "all" || args[0] === "--all") {
      options.helpAll = true;
      args.shift();
    }
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--cwd") options.cwd = resolve(args[++index]);
    else if (arg === "--scope") options.scope = parseScope(args[++index]);
    else if (arg.startsWith("--scope=")) options.scope = parseScope(arg.slice("--scope=".length));
    else if (arg === "--mode") {
      options.mode = args[++index];
      options.modeExplicit = true;
    } else if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
      options.modeExplicit = true;
    } else if (arg === "--detect") options.detect = true;
    else if (arg === "--all-adapters") {
      options.allAdapters = true;
      options.adapters = null;
      options.adaptersExplicit = true;
    } else if (arg === "--adapters" || arg === "--agents") {
      options.adapters = parseAdapters(args[++index]);
      options.adaptersExplicit = true;
    } else if (arg.startsWith("--adapters=")) {
      options.adapters = parseAdapters(arg.slice("--adapters=".length));
      options.adaptersExplicit = true;
    } else if (arg.startsWith("--agents=")) {
      options.adapters = parseAdapters(arg.slice("--agents=".length));
      options.adaptersExplicit = true;
    } else if (arg === "--components") {
      options.components = parseAdapters(args[++index]);
      options.componentsExplicit = true;
    } else if (arg.startsWith("--components=")) {
      options.components = parseAdapters(arg.slice("--components=".length));
      options.componentsExplicit = true;
    } else if (arg === "--no-default-components") {
      options.noDefaultComponents = true;
      options.componentsExplicit = true;
    } else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      options.yesExplicit = true;
    } else if (arg === "--confirm") {
      options.confirm = true;
      options.confirmExplicit = true;
    } else if (arg === "--no-preflight") {
      options.preflight = false;
      options.preflightExplicit = true;
    } else if (arg === "--apply") options.apply = true;
    else if (arg === "--to") options.snapshot = args[++index];
    else if (arg.startsWith("--to=")) options.snapshot = arg.slice("--to=".length);
    else if (arg === "--receipt") options.receiptId = args[++index];
    else if (arg.startsWith("--receipt=")) options.receiptId = arg.slice("--receipt=".length);
    else if (arg === "--persona") options.persona = parsePersona(args[++index]);
    else if (arg.startsWith("--persona=")) options.persona = parsePersona(arg.slice("--persona=".length));
    else if (arg === "--limit") options.limit = parsePositiveInt(args[++index], "limit");
    else if (arg.startsWith("--limit=")) options.limit = parsePositiveInt(arg.slice("--limit=".length), "limit");
    else if (arg === "--command") options.historyCommand = args[++index];
    else if (arg.startsWith("--command=")) options.historyCommand = arg.slice("--command=".length);
    else if (arg === "--action") options.historyEventAction = args[++index];
    else if (arg.startsWith("--action=")) options.historyEventAction = arg.slice("--action=".length);
    else if (arg === "--label") options.label = args[++index];
    else if (arg.startsWith("--label=")) options.label = arg.slice("--label=".length);
    else if (arg === "--out") options.outPath = resolve(args[++index]);
    else if (arg.startsWith("--out=")) options.outPath = resolve(arg.slice("--out=".length));
    else if (arg === "--simple") options.simple = true;
    else if (arg === "--task" || arg.startsWith("--task=")) {
      const taskValue = arg.startsWith("--task=") ? arg.slice("--task=".length) : args[++index];
      if (command === "run") options.task = taskValue;
      else options.intelligenceTask = taskValue;
    }
    else if (arg === "--prompt") options.intelligencePrompt = args[++index];
    else if (arg.startsWith("--prompt=")) options.intelligencePrompt = arg.slice("--prompt=".length);
    else if (arg === "--paths") options.intelligencePaths = parsePathList(args[++index]);
    else if (arg.startsWith("--paths=")) options.intelligencePaths = parsePathList(arg.slice("--paths=".length));
    else if (arg === "--agent") options.agent = args[++index];
    else if (arg.startsWith("--agent=")) options.agent = arg.slice("--agent=".length);
    else if (arg === "--model") options.model = args[++index];
    else if (arg.startsWith("--model=")) options.model = arg.slice("--model=".length);
    else if (arg === "--strategy") {
      options.strategy = normalizeRunStrategy(requireFlagValue("--strategy", args[++index]));
    } else if (arg.startsWith("--strategy=")) {
      options.strategy = normalizeRunStrategy(
        requireFlagValue("--strategy", arg.slice("--strategy=".length))
      );
    }
    else if (arg === "--backend") options.intelligenceBackend = args[++index] ?? "";
    else if (arg.startsWith("--backend=")) options.intelligenceBackend = arg.slice("--backend=".length);
    else if (arg === "--permissions") options.permissions = parsePathList(args[++index]);
    else if (arg.startsWith("--permissions=")) options.permissions = parsePathList(arg.slice("--permissions=".length));
    else if (arg === "--bundle") options.bundlePath = resolve(args[++index]);
    else if (arg.startsWith("--bundle=")) options.bundlePath = resolve(arg.slice("--bundle=".length));
    else if (arg === "--graph") options.graphPath = resolve(args[++index]);
    else if (arg.startsWith("--graph=")) options.graphPath = resolve(arg.slice("--graph=".length));
    else if (arg === "--budget") options.graphifyBudget = requireFlagValue("--budget", args[++index]);
    else if (arg.startsWith("--budget=")) options.graphifyBudget = requireFlagValue("--budget", arg.slice("--budget=".length));
    else if (arg === "--confirm-import") options.confirmImport = true;
    else if (arg === "--confirm-resolve") options.confirmResolve = true;
    else if (arg === "--confirm-dismiss") options.confirmDismiss = true;
    else if (arg === "--allow-unsafe-permissions") options.allowUnsafePermissions = true;
    else if (arg === "--capture-transcript") options.captureTranscript = true;
    else if (arg === "--follow") options.follow = true;
    else if (arg === "--no-wait") options.wait = false;
    else if (arg === "--active-only") options.activeOnly = true;
    else if (arg === "--timeout") options.timeoutMs = parsePositiveInt(args[++index], "timeout") * 1000;
    else if (arg.startsWith("--timeout=")) options.timeoutMs = parsePositiveInt(arg.slice("--timeout=".length), "timeout") * 1000;
    else if (arg === "--include-private") options.includePrivate = true;
    else if (arg === "--cloud-consent") options.cloudConsent = true;
    else if (arg === "--base") options.base = requireFlagValue("--base", args[++index]);
    else if (arg.startsWith("--base=")) options.base = requireFlagValue("--base", arg.slice("--base=".length));
    else if (arg === "--commit") options.commit = requireFlagValue("--commit", args[++index]);
    else if (arg.startsWith("--commit=")) {
      options.commit = requireFlagValue("--commit", arg.slice("--commit=".length));
    } else if (arg === "--staged") options.staged = true;
    else if (arg === "--fail-on") options.failOn = requireFlagValue("--fail-on", args[++index]);
    else if (arg.startsWith("--fail-on=")) {
      options.failOn = requireFlagValue("--fail-on", arg.slice("--fail-on=".length));
    }
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--all") options.helpAll = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else throw new Error(`Unknown option "${arg}".`);
  }

  if (command === "run" && !options.task && args.length > 0) {
    options.task = args.join(" ").trim();
  }

  if (command === "reviews" && options.reviewsAction === "import" && !options.bundlePath) {
    throw new Error(
      `Missing --bundle. Use: ${formatCliCommand("reviews import --bundle <path> --confirm-import")}`
    );
  }

  if (command === "graphify" && !options.graphPath) {
    throw new Error(`Missing --graph. Use: ${formatCliCommand("graphify <query|path|explain> ... --graph <path>")}`);
  }

  return { command, options, isImplicitCommand: implicitCommand };
}

function parseComponentsAction(args, options) {
  const action = args[0];
  if (!action || action.startsWith("-")) return;

  args.shift();
  options.componentsAction = action;

  if (action === "init" || action === "pack") {
    const componentId = args[0];
    if (!componentId || componentId.startsWith("-")) {
      const usage = action === "init"
        ? `${formatCliCommand("components init <id> --label \"My Label\"")}`
        : formatCliCommand("components pack <id> --out <file>");
      throw new Error(`Missing component id. Use: ${usage}`);
    }
    options.componentId = args.shift();
    return;
  }

  if (action === "import") {
    const bundlePath = args[0];
    if (!bundlePath || bundlePath.startsWith("-")) {
      throw new Error(`Missing bundle path. Use: ${formatCliCommand("components import <file>")}`);
    }
    options.bundlePath = resolve(args.shift());
    return;
  }

  if (action === "validate") return;

  if (action === "configure" || action === "verify" || action === "rollback") {
    const componentId = args[0];
    if (!componentId || componentId.startsWith("-")) {
      throw new Error(
        `Missing component id. Use: ${formatCliCommand(`components ${action} <component-id>`)}`
      );
    }
    options.componentId = args.shift();
    return;
  }

  throw new Error(`Unknown components action "${action}". Use validate, init, pack, import, configure, verify, or rollback.`);
}

function parsePolicyAction(args, options) {
  const action = args[0];

  if (!action || action.startsWith("-")) {
    options.policyAction = "show";
    return;
  }

  args.shift();

  if (action === "set") {
    options.policyAction = "set";
    const key = args[0];
    const value = args[1];

    if (!key || key.startsWith("-") || !value || value.startsWith("-")) {
      throw new Error(`Missing policy key or value. Use: ${formatCliCommand("policy set <key> <value>")}`);
    }

    options.policyKey = args.shift();
    options.policyValue = args.shift();
    return;
  }

  if (action === "reset") {
    options.policyAction = "reset";
    return;
  }

  throw new Error(`Unknown policy action "${action}". Use set or reset.`);
}

function parseHistoryAction(args, options) {
  const action = args[0];

  if (!action || action.startsWith("-")) {
    options.historyAction = "list";
    return;
  }

  if (action === "last") {
    args.shift();
    options.historyAction = "last";
    return;
  }

  throw new Error(`Unknown history action "${action}". Use last or omit for the full log.`);
}

function parseRunsAction(args, options) {
  const action = args[0];

  if (!action || action.startsWith("-")) {
    options.runsAction = "list";
    return;
  }

  if (!new Set(["list", "show", "stop"]).has(action)) {
    throw new Error(`Unknown runs action "${action}". Use list, show, or stop.`);
  }

  args.shift();
  options.runsAction = action;

  if (action === "show" || action === "stop") {
    const runId = args[0];
    if (!runId || runId.startsWith("-")) {
      throw new Error(`Missing run id. Use: ${formatCliCommand(`runs ${action} <runId>`)}`);
    }
    options.runId = args.shift();
  }
}

function parseReviewsAction(args, options) {
  const action = args[0];
  if (!action || action.startsWith("-")) {
    options.reviewsAction = "list";
    return;
  }
  if (!new Set(["list", "show", "verify", "export", "import"]).has(action)) {
    throw new Error(`Unknown reviews action "${action}". Use list, show, verify, export, or import.`);
  }
  args.shift();
  options.reviewsAction = action;
  if (action === "show" || action === "verify") {
    const reviewId = args[0];
    if (!reviewId || reviewId.startsWith("-")) {
      throw new Error(`Missing review id. Use: ${formatCliCommand(`reviews ${action} <reviewId>`)}`);
    }
    options.reviewId = args.shift();
  }
  if (action === "export") {
    const lineage = args[0];
    if (!lineage || lineage.startsWith("-")) {
      throw new Error(
        `Missing lineage. Use: ${formatCliCommand("reviews export <lineage> --out <path>")}`
      );
    }
    options.lineage = args.shift();
  }
}

function parseMonitorAction(args, options) {
  const action = args[0];
  if (!action || action.startsWith("-")) {
    options.monitorAction = "status";
    return;
  }
  if (!new Set(["enable", "disable", "status", "tick"]).has(action)) {
    throw new Error(`Unknown monitor action "${action}". Use enable, disable, status, or tick.`);
  }
  args.shift();
  options.monitorAction = action;
}

function parseAlertsAction(args, options) {
  const action = args[0];
  if (!action || action.startsWith("-") || !new Set(["resolve", "dismiss"]).has(action)) {
    throw new Error(`Unknown alerts action "${action ?? ""}". Use resolve or dismiss.`);
  }
  args.shift();
  options.alertsAction = action;
  const alertId = args[0];
  if (!alertId || alertId.startsWith("-")) {
    throw new Error(`Missing alert id. Use: ${formatCliCommand(`alerts ${action} <alertId>`)}`);
  }
  options.alertId = args.shift();
}

function parseIntelligenceAction(args, options) {
  const action = args[0];
  if (!action || action.startsWith("-")) {
    options.intelligenceAction = "status";
    return;
  }

  args.shift();
  const allowed = new Set(["status", "models", "context", "route", "ask"]);
  if (!allowed.has(action)) {
    throw new Error(`Unknown intelligence action "${action}". Use status, models, context, route, or ask.`);
  }
  options.intelligenceAction = action;
}

function parseGraphifyAction(args, options) {
  const action = args[0];
  const usage = formatCliCommand("graphify <query|path|explain> ... --graph <path>");
  if (!action || action.startsWith("-")) throw new Error(`Missing graphify action. Use: ${usage}`);
  if (!["query", "path", "explain"].includes(action)) {
    throw new Error(`Unknown graphify action "${action}". Use query, path, or explain.`);
  }
  args.shift();
  options.graphifyAction = action;
  const positional = [];
  while (args.length && !String(args[0]).startsWith("-")) positional.push(args.shift());
  const need = action === "path" ? 2 : 1;
  if (positional.length < need) {
    throw new Error(action === "path"
      ? `Missing arguments. Use: ${formatCliCommand('graphify path "<A>" "<B>" --graph <path>')}`
      : `Missing argument. Use: ${formatCliCommand(`graphify ${action} "<text>" --graph <path>`)}`);
  }
  options.graphifyArgs = positional.slice(0, need);
}

function parseUpdatesAction(args, options) {
  const action = args[0];
  if (!action || action.startsWith("-")) {
    options.updatesAction = "check";
    return;
  }
  if (action !== "check") {
    throw new Error(`Unknown updates action "${action}". Use: kairo updates check`);
  }
  args.shift();
  options.updatesAction = "check";
}

function parsePathList(value) {
  if (!value) return [];
  return [...new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid --${label} value "${value}". Use a positive integer.`);
  }
  return parsed;
}

function requireFlagValue(flag, value) {
  if (value == null || value === "" || String(value).startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function parseScope(value) {
  if (!SCOPES.has(value)) {
    throw new Error(`Invalid scope "${value}". Use agent-global or workspace.`);
  }

  return value;
}

function normalizeCommand(command) {
  if (!command) return "install";

  if (command === "install" || command === "i") return "install";
  if (command === "shell") return "shell";
  if (command === "orchestrator") return "orchestrator";
  if (command === "run") return "run";
  if (command === "runs") return "runs";
  if (command === "review") return "review";
  if (command === "reviews") return "reviews";
  if (command === "monitor") return "monitor";
  if (command === "alerts") return "alerts";
  if (command === "graphify") return "graphify";
  if (command === "mcp") return "mcp";
  if (command === "intelligence" || command === "intel") return "intelligence";
  if (command === "setup") return "setup";
  if (command === "status") return "status";
  if (command === "sync") return "sync";
  if (command === "upgrade") return "upgrade";
  if (command === "updates") return "updates";
  if (command === "init") return "init";
  if (command === "update" || command === "u") return "update";
  if (command === "doctor") return "doctor";
  if (command === "uninstall") return "uninstall";
  if (command === "detect" || command === "d") return "detect";
  if (command === "adapters") return "adapters";
  if (command === "explain") return "explain";
  if (command === "diff") return "diff";
  if (command === "backups") return "backups";
  if (command === "history") return "history";
  if (command === "rollback") return "rollback";
  if (command === "components") return "components";
  if (command === "policy") return "policy";
  if (command === "report") return "report";
  if (command === "help") return "help";
  if (command === "version") return "version";

  return command;
}

function parseAdapters(value) {
  if (!value) return [];

  const items = [...new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  )];

  if (items.length === 1 && items[0] === "all") {
    return ["all"];
  }

  if (items.includes("all")) {
    throw new Error('Use --agents all alone to target all supported agents, not mixed with other ids.');
  }

  return items;
}

function parsePersona(value) {
  const persona = String(value ?? "").trim().toLowerCase();
  if (persona !== "off" && persona !== "teaching") {
    throw new Error('Invalid --persona. Use "off" or "teaching".');
  }
  return persona;
}
