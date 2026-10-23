import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  runComponentsConfigure,
  runComponentsRollback,
  runComponentsVerify
} from "./global/component-integration-cli.js";
import {
  runComponentsAdopt,
  runComponentsDiff
} from "./global/components-resolve-cli.js";
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
import { runSelfUpdate } from "./global/self-update.js";
import { applyPolicyToOptions, loadPolicyFile } from "./global/policy.js";
import { resolveHomeDir } from "./global/paths.js";
import { runWorkspaceDetect, runWorkspaceDoctor, runWorkspaceInit, runWorkspaceUpdate } from "./workspace-cli.js";
import { runOrchestratorDiagnostics } from "./global/orchestrator.js";
import { runIntelligenceCli } from "./global/intelligence-cli.js";
import { runGlobalRun, runGlobalRuns } from "./global/runtime/run-cli.js";
import { runArchitectCli, runPlansCli } from "./global/architect/architect-cli.js";
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
import { formatHelpShort, formatHelpAll } from "./global/cli-help.js";
const RETIRED_UI_COMMANDS = new Set(["host", "shell", "ui", "start", "resume", "list", "conversation"]);
const RETIRED_PRODUCT_UI_MESSAGE =
  "The terminal UI was retired. Use `kairo status` or `kairo setup`.";

export { resolveSuggestedInvocation };

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const SCOPES = new Set(["agent-global", "workspace"]);

export async function runCli(argv) {
  const { command, options, isImplicitCommand } = parseArgs(argv);
  maybeWarnLegacyCli(process.argv, { json: options.json });

  if (options.help || command === "help") {
    console.log("  team exec --provider P --model M [--cwd PATH] [--role R]  Run stdin task on a per-launch model through Kairo.\n  team roles init [--cwd PATH] [--yes] [--json]  After project-team analysis and approval, discover installed agents; preview roles.json unless --yes.\n  team detect-exhaustion --text TEXT [--adapter ID] [--exit-code N]  Read-only JSON provider-limit classification.\n  team record-outcome --agent NAME --adapter ID --model ID --status completed|failed|exhausted [--reason TEXT] [--result pass|fail] [--retry] [--cwd PATH]  Record outcome; pass means checks green and review accepted, retry repeats a failed task.\n  team verdict --agent NAME --result pass|fail [--retry] [--cwd PATH] [--json]  Verify latest unresolved outcome; --pending lists pending verdicts.\n  team record-launch --agent NAME --adapter ID --model ID [--cwd PATH]  Record subagent work for distribution.\n  team route --role ROLE_ID [--cwd PATH] [--json]  Read-only cached project route; no probes or recovery.\n  team route --agent NAME [--cwd PATH] [--json]  Resolve a catalog agent and return its provider-specific launch target; --provider P constrains qualified selection.\n  team route --refresh [--cwd PATH] [--json]  Refresh routing inputs (may probe providers).\n  team roles sync [--host ID|all] [--cwd PATH] [--yes] [--json]  Write Kairo-marked role files per host (project scope); preview without --yes.\n  team roles retire [--host ID|all] [--cwd PATH] [--yes] [--json]  Remove only Kairo-marked role files.");
    console.log("\nTeam setup:\n  kairo team analysts\n  kairo team analyze --analyst MODEL --yes [--goal TEXT]\n  kairo team approve --yes\n  kairo team roles init --yes\n  Omit --yes to preview. kairo team show lists the team.\n  kairo team pacing [--cwd PATH] [--json] shows quota, local resets and next writer; refreshes missing or stale routing inputs.\n  kairo team plan [--cwd PATH] [--json] shows quota phases (read-only). Add --json for machines.");
    printHelp({ all: options.helpAll === true });
    console.log("  intelligence aptitude-plan [--json] [--authorization request|request-stage-2]  Dry-run role probes, cheap-first stages and AA cost estimates; 'request' prints the stage-1 binding to authorize, 'request-stage-2' the stage-2 binding resolved from stored stage-1 results; no model runs. --roles A,B limits the plan (and its binding) to those case-sensitive role names; --read-only-roles limits it to roles whose probes have no editable paths.");
    console.log("  intelligence aptitude-run --authorization '<JSON>'  Check the authorization against the exact plan binding and call cap; fails closed until a production invoke bridge exists. Pass the same --roles/--read-only-roles used to request the authorization, otherwise the plan fingerprint mismatches and the run is refused.");
    return;
  }

  // Pure helper for independently installed host plugins: no policy/home reads.
  if (command === "team" && options.teamAction === "detect-exhaustion") {
    if (typeof options.text !== "string") throw new Error("Missing --text. Use kairo team detect-exhaustion --text TEXT [--adapter ID] [--exit-code N].");
    const { detectExhaustion } = await import("./global/team/exhaustion.js");
    console.log(JSON.stringify(detectExhaustion(options.text, { adapterId: options.adapter, exitCode: options.exitCode })));
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
    case "team": {
      if (optionsWithPolicy.teamAction === "exec") {
        const { runTeamExecCli } = await import("./global/team/team-exec.js");
        process.exitCode = await runTeamExecCli(optionsWithPolicy);
        return;
      }
      if (["analysts", "analyze", "show", "approve", "rebuild", "plan", "pacing"].includes(optionsWithPolicy.teamAction)) {
        const { runTeamCli } = await import("./global/team/team-cli.js");
        await runTeamCli(optionsWithPolicy);
        return;
      }
      if (optionsWithPolicy.teamAction === "roles") {
        if (optionsWithPolicy.rolesAction === "init") {
          const { runTeamRolesInitCli } = await import("./global/team/roles-init.js");
          await runTeamRolesInitCli(optionsWithPolicy);
          return;
        }
        const { runTeamRolesCli } = await import("./global/hosts/roles-cli.js");
        await runTeamRolesCli(optionsWithPolicy);
        return;
      }
      if (optionsWithPolicy.teamAction === "verdict") {
        const { runVerdictCli } = await import("./global/team/launch-ledger.js");
        await runVerdictCli(optionsWithPolicy);
        return;
      }
      if (optionsWithPolicy.teamAction === "record-outcome") {
        const { runRecordOutcomeCli } = await import("./global/team/launch-ledger.js");
        await runRecordOutcomeCli(optionsWithPolicy);
        return;
      }
      if (optionsWithPolicy.teamAction === "record-launch") {
        const { runRecordLaunchCli } = await import("./global/team/launch-ledger.js");
        await runRecordLaunchCli(optionsWithPolicy);
        return;
      }
      const { runTeamRouteCli } = await import("./global/team/routing-input-cache.js");
      await runTeamRouteCli(optionsWithPolicy);
      return;
    }
    case "host":
    case "shell":
    case "ui":
    case "start":
    case "resume":
    case "list":
    case "conversation":
      console.log(RETIRED_PRODUCT_UI_MESSAGE);
      process.exitCode = isImplicitCommand ? 0 : 1;
      return;
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
    case "architect":
      await runArchitectCli(optionsWithPolicy);
      return;
    case "plans":
      await runPlansCli(optionsWithPolicy);
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
      const { runMcpCli } = await import("./global/mcp-install.js");
      await runMcpCli(buildMcpCliOptions(optionsWithPolicy, {
        packageRoot,
        packageName: packageManifest.name,
        version: packageManifest.version
      }));
      return;
    }
    case "connections": {
      const { buildConnectionsReport } = await import("./global/connections.js");
      const { printJson } = await import("./global/json-output.js");
      const { commandHeader } = await import("./global/brand/index.js");
      const report = await buildConnectionsReport({
        workspaceRoot: optionsWithPolicy.cwd,
        packageRoot,
        packageName: packageManifest.name,
        cliVersion: packageManifest.version,
        client: optionsWithPolicy.mcpClient ?? "cursor"
      });
      if (optionsWithPolicy.json) {
        printJson(report);
      } else {
        console.log(commandHeader("Connections"));
        for (const c of report.connections) {
          console.log(`${c.label} · ${c.state}`);
          console.log(`  ${c.access}`);
          if (c.detail) console.log(`  ${c.detail}`);
        }
      }
      return;
    }
    case "next": {
      const { runNextCli } = await import("./global/next/next-cli.js");
      await runNextCli({
        cwd: optionsWithPolicy.cwd,
        json: optionsWithPolicy.json === true,
        mcpClient: optionsWithPolicy.mcpClient ?? "cursor"
      });
      return;
    }
    case "control-plane": {
      const { runControlPlaneCli } = await import("./global/control-plane/cli.js");
      await runControlPlaneCli({
        cwd: optionsWithPolicy.cwd,
        json: optionsWithPolicy.json === true,
        mcpClient: optionsWithPolicy.mcpClient ?? "cursor"
      });
      return;
    }
    case "fleet": {
      const fleetAction = optionsWithPolicy.fleetAction ?? "show";
      if (fleetAction === "set") {
        const { runFleetSet } = await import("./global/fleet-set.js");
        await runFleetSet({
          platform: optionsWithPolicy.fleetPlatform,
          agent: optionsWithPolicy.fleetAgent ?? optionsWithPolicy.agent,
          model: optionsWithPolicy.model,
          yes: optionsWithPolicy.yes === true,
          dryRun: optionsWithPolicy.dryRun === true,
          json: optionsWithPolicy.json === true
        });
        return;
      }
      if (fleetAction === "configure") {
        const { runFleetConfigure } = await import("./global/fleet-configure.js");
        await runFleetConfigure({
          yes: optionsWithPolicy.yes === true,
          json: optionsWithPolicy.json === true,
          platforms: optionsWithPolicy.fleetPlatforms ?? null,
          from: optionsWithPolicy.fleetFrom ?? "profile",
          assignmentsRaw: optionsWithPolicy.fleetAssignments ?? null,
          codexModel: optionsWithPolicy.fleetCodexModel ?? null
        });
        return;
      }
      if (fleetAction === "models") {
        const { runFleetModels } = await import("./global/fleet-configure.js");
        await runFleetModels({
          json: optionsWithPolicy.json === true,
          profile: optionsWithPolicy.fleetProfile === true
        });
        return;
      }
      const { buildFleetReport, formatFleetText } = await import("./global/observability/fleet-probe.js");
      const { printJson } = await import("./global/json-output.js");
      const report = await buildFleetReport({
        includeVariants: optionsWithPolicy.includeVariants === true
      });
      if (optionsWithPolicy.json) {
        printJson(report);
      } else {
        console.log(formatFleetText(report, {
          verbose: optionsWithPolicy.verbose === true || optionsWithPolicy.includeVariants === true
        }));
      }
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
      if (options.scope === "workspace") {
        await runWorkspaceUpdate(options, packageManifest, packageRoot);
        return;
      }
      await runSelfUpdate({
        packageName: packageManifest.name,
        cliVersion: packageManifest.version,
        yes: optionsWithPolicy.yes === true,
        json: optionsWithPolicy.json === true
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
    case "adopt":
      await runComponentsAdopt({ ...options, packageRoot });
      return;
    case "diff":
      await runComponentsDiff({ ...options, packageRoot });
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
  return "host";
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

export function buildMcpCliOptions(options = {}, extras = {}) {
  return {
    mcpAction: options.mcpAction ?? "serve",
    mcpClient: options.mcpClient ?? "cursor",
    mcpBind: options.mcpBind,
    mcpProjectScope: options.mcpProjectScope === true,
    yes: options.yes === true,
    json: options.json === true,
    cwd: options.cwd,
    cwdExplicit: options.cwdExplicit,
    workspaceBound: options.workspaceBound === true,
    ...extras
  };
}

/** Render legacy help without advertising retired launchers. */
function printHelp({ all = false } = {}) {
  const help = all ? formatHelpAll() : formatHelpShort();
  console.log(help
    .replace(/Open the unified workspace/g, "Terminal UI retired; use kairo status or kairo setup")
    .replace(/Unified Kairo workspace \(TTY, ratatui\)\./g, "Terminal UI retired; use kairo status or kairo setup.")
    .replace(/^.*(?:Unified workspace|unified workspace session|ratatui only).*\n/gm, "")
    .replace(/^.*\bui \[--cwd.*\n/gm, "")
    .replace("## Agents & runs", "Retired: host, shell, ui, start, resume, list and conversation no longer launch a terminal UI.\nUse kairo status or kairo setup.\n\n## Agents & runs"));
}

export function parseArgs(argv) {
  const args = [...argv];
  const firstArg = args[0];
  const implicitCommand = !firstArg || firstArg.startsWith("-");
  const rawCommand = implicitCommand ? resolveImplicitCommand(args) : args.shift();
  const command = normalizeCommand(rawCommand);
  const options = {
    cwd: process.cwd(),
    cwdExplicit: false,
    workspaceBound: false,
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
    overwriteConflicts: false,
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
    plansAction: null,
    taskId: null,
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
    mcpAction: "serve",
    mcpClient: "cursor",
    fleetAction: "show",
    fleetPlatform: null,
    fleetAgent: null,
    fleetPlatforms: null,
    fleetFrom: "profile",
    fleetAssignments: null,
    fleetCodexModel: null,
    fleetProfile: false,
    includeVariants: false,
    verbose: false,
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
    cloudConsent: false,
    port: null,
    legacyCockpit: false,
    ratatui: false,
    piHost: false
  };

  if (RETIRED_UI_COMMANDS.has(command)) {
    // Retired commands only print the retirement notice; ignore their old positional arguments.
    while (args.length > 0 && !args[0].startsWith("-")) args.shift();
  }

  if (command === "team") {
    const teamAction = args.shift();
    if (teamAction === "roles") {
      options.teamAction = "roles";
      options.rolesAction = args.shift();
    } else if (["exec", "record-launch", "record-outcome", "verdict", "detect-exhaustion", "analysts", "analyze", "show", "approve", "rebuild", "plan", "pacing"].includes(teamAction)) {
      options.teamAction = teamAction;
    } else if (teamAction !== "route") {
      throw new Error("Use kairo team exec --provider P --model M, kairo team analysts, kairo team analyze --analyst MODEL, kairo team show, kairo team plan, kairo team pacing, kairo team approve, kairo team route --role ROLE_ID, kairo team route --refresh, kairo team record-launch --agent NAME --adapter ID --model ID, kairo team record-outcome --agent NAME --adapter ID --model ID --status completed|failed|exhausted, kairo team verdict --agent NAME --result pass|fail or --pending, or kairo team roles init|sync|retire.");
    }
  }
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

  if (command === "plans") {
    parsePlansAction(args, options);
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
  if (command === "mcp") parseMcpAction(args, options);
  if (command === "fleet") parseFleetAction(args, options);

  if (command === "help") {
    while (args[0] === "all" || args[0] === "--all") {
      options.helpAll = true;
      args.shift();
    }
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--cwd") {
      options.cwd = resolve(args[++index]);
      options.cwdExplicit = true;
    }
    else if (arg === "--analyst") {
      if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Pick one with kairo team analyze --analyst MODEL.");
      options.analyst = args[++index];
    }
    else if (arg.startsWith("--analyst=")) {
      options.analyst = arg.slice("--analyst=".length);
      if (!options.analyst) throw new Error("Pick one with kairo team analyze --analyst MODEL.");
    }
    else if (arg === "--goal") {
      if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Use kairo team analyze --goal TEXT.");
      options.goal = args[++index];
    }
    else if (arg.startsWith("--goal=")) {
      options.goal = arg.slice("--goal=".length);
      if (!options.goal) throw new Error("Use kairo team analyze --goal TEXT.");
    }
    else if (arg === "--workspace-bound") options.workspaceBound = true;
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
    else if (arg === "--overwrite-conflicts") options.overwriteConflicts = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--include-variants") options.includeVariants = true;
    else if (arg === "--platforms") options.fleetPlatforms = args[++index];
    else if (arg.startsWith("--platforms=")) options.fleetPlatforms = arg.slice("--platforms=".length);
    else if (arg === "--from") options.fleetFrom = args[++index];
    else if (arg.startsWith("--from=")) options.fleetFrom = arg.slice("--from=".length);
    else if (arg === "--assignments") options.fleetAssignments = args[++index];
    else if (arg.startsWith("--assignments=")) options.fleetAssignments = arg.slice("--assignments=".length);
    else if (arg === "--codex-model") options.fleetCodexModel = args[++index];
    else if (arg.startsWith("--codex-model=")) options.fleetCodexModel = arg.slice("--codex-model=".length);
    else if (arg === "--profile") options.fleetProfile = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (arg === "--platform") options.fleetPlatform = args[++index];
    else if (arg.startsWith("--platform=")) options.fleetPlatform = arg.slice("--platform=".length);
    else if (arg === "--client") {
      options.mcpClient = args[++index];
    } else if (arg.startsWith("--client=")) {
      options.mcpClient = arg.slice("--client=".length);
    } else if (arg === "--bind") {
      options.mcpBind = args[++index] ?? "";
    } else if (arg.startsWith("--bind=")) {
      options.mcpBind = arg.slice("--bind=".length);
    } else if (arg === "--project-scope") {
      options.mcpProjectScope = true;
    } else if (arg === "--yes" || arg === "-y") {
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
      if (command === "run" || command === "architect") options.task = taskValue;
      else options.intelligenceTask = taskValue;
    }
    else if (arg === "--authorization" && command === "intelligence") options.aptitudeAuthorization = args[++index] ?? "";
    else if (arg.startsWith("--authorization=") && command === "intelligence") options.aptitudeAuthorization = arg.slice("--authorization=".length);
    else if (arg === "--roles" && command === "intelligence") options.aptitudeRoles = parseRoleList(args[++index]);
    else if (arg.startsWith("--roles=") && command === "intelligence") options.aptitudeRoles = parseRoleList(arg.slice("--roles=".length));
    else if (arg === "--read-only-roles" && command === "intelligence") options.aptitudeReadOnlyRoles = true;
    else if (arg === "--prompt") options.intelligencePrompt = args[++index];
    else if (arg.startsWith("--prompt=")) options.intelligencePrompt = arg.slice("--prompt=".length);
    else if (arg === "--paths") options.intelligencePaths = parsePathList(args[++index]);
    else if (arg.startsWith("--paths=")) options.intelligencePaths = parsePathList(arg.slice("--paths=".length));
    else if ((arg === "--text" || arg === "--exit-code") && command === "team" && options.teamAction === "detect-exhaustion") {
      if (args[index + 1] === undefined || args[index + 1].startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      const value = args[++index];
      if (arg === "--text") options.text = value;
      else {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid --exit-code. Use a nonnegative integer.");
        options.exitCode = Number(value);
      }
    }
    else if ((arg.startsWith("--text=") || arg.startsWith("--exit-code=")) && command === "team" && options.teamAction === "detect-exhaustion") {
      const value = arg.slice(arg.indexOf("=") + 1);
      if (arg.startsWith("--text=")) options.text = value;
      else {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid --exit-code. Use a nonnegative integer.");
        options.exitCode = Number(value);
      }
    }
    else if (arg === "--pending" && command === "team" && options.teamAction === "verdict") options.pending = true;
    else if (arg === "--retry" && command === "team" && ["record-outcome", "verdict"].includes(options.teamAction)) options.retry = true;
    else if ((arg === "--status" || arg === "--reason" || arg === "--result") && command === "team" && (options.teamAction === "record-outcome" || (options.teamAction === "verdict" && arg === "--result"))) {
      if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      options[arg.slice(2)] = args[++index];
    }
    else if ((arg.startsWith("--status=") || arg.startsWith("--reason=") || arg.startsWith("--result=")) && command === "team" && (options.teamAction === "record-outcome" || (options.teamAction === "verdict" && arg.startsWith("--result=")))) {
      const [name, ...value] = arg.slice(2).split("=");
      if (!value.join("=")) throw new Error(`Missing value for --${name}.`);
      options[name] = value.join("=");
    }
    else if (arg === "--provider" && command === "team" && [undefined, "exec", "route"].includes(options.teamAction)) options.provider = args[++index];
    else if (arg.startsWith("--provider=") && command === "team" && [undefined, "exec", "route"].includes(options.teamAction)) options.provider = arg.slice("--provider=".length);
    else if (arg === "--adapter" && command === "team") options.adapter = args[++index];
    else if (arg.startsWith("--adapter=") && command === "team") options.adapter = arg.slice("--adapter=".length);
    else if (arg === "--agent") options.agent = args[++index];
    else if (arg.startsWith("--agent=")) options.agent = arg.slice("--agent=".length);
    else if (arg === "--model") options.model = args[++index];
    else if (arg.startsWith("--model=")) options.model = arg.slice("--model=".length);
    else if (arg === "--refresh" && command === "team") options.refresh = true;
    else if (arg === "--host" && command === "team") options.roleHost = args[++index];
    else if (arg.startsWith("--host=") && command === "team") options.roleHost = arg.slice("--host=".length);
    else if (arg === "--role") options.role = args[++index];
    else if (arg.startsWith("--role=")) options.role = arg.slice("--role=".length);
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
    else if (arg === "--port") options.port = parsePositiveInt(args[++index], "port");
    else if (arg.startsWith("--port=")) options.port = parsePositiveInt(arg.slice("--port=".length), "port");
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
    else if (arg === "--legacy-cockpit") {
      throw new Error(`--legacy-cockpit is no longer supported. ${RETIRED_PRODUCT_UI_MESSAGE}`);
    }
    else if (arg === "--ratatui") options.ratatui = true;
    else if (arg === "--pi" || arg === "--pi-host") {
      throw new Error(`--pi / --pi-host is no longer supported. ${RETIRED_PRODUCT_UI_MESSAGE}`);
    }
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--all") options.helpAll = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else throw new Error(`Unknown option "${arg}".`);
  }

  if ((command === "run" || command === "architect") && !options.task && args.length > 0) {
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

  if (action === "configure" || action === "verify" || action === "rollback"
    || action === "adopt" || action === "diff") {
    const componentId = args[0];
    if (!componentId || componentId.startsWith("-")) {
      throw new Error(
        `Missing component id. Use: ${formatCliCommand(`components ${action} <component-id>`)}`
      );
    }
    options.componentId = args.shift();
    return;
  }

  throw new Error(`Unknown components action "${action}". Use validate, init, pack, import, configure, verify, adopt, diff, or rollback.`);
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

function parsePlansAction(args, options) {
  const action = args[0];
  if (!action || action.startsWith("-")) {
    options.plansAction = "list";
    return;
  }
  if (!new Set(["list", "show", "approve", "reject", "execute", "cancel", "result"]).has(action)) {
    throw new Error(`Unknown plans action "${action}". Use list, show, approve, reject, execute, cancel, or result.`);
  }
  args.shift();
  options.plansAction = action;
  if (action !== "list") {
    const taskId = args[0];
    if (!taskId || taskId.startsWith("-")) {
      throw new Error(`Missing task id. Use: ${formatCliCommand(`plans ${action} <taskId>`)}`);
    }
    options.taskId = args.shift();
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
  const allowed = new Set(["status", "models", "context", "route", "ask", "aptitude-plan", "aptitude-run"]);
  if (!allowed.has(action)) {
    throw new Error(`Unknown intelligence action "${action}". Use status, models, context, route, ask, aptitude-plan, or aptitude-run.`);
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

function parseMcpAction(args, options) {
  const action = args[0];
  if (!action || action.startsWith("-")) {
    options.mcpAction = "serve";
    return;
  }
  if (!new Set(["serve", "install"]).has(action)) {
    throw new Error(
      `Unknown mcp action "${action}". Use: ${formatCliCommand("mcp")} or ${formatCliCommand("mcp install [--yes]")}`
    );
  }
  args.shift();
  options.mcpAction = action;
}

function parseFleetAction(args, options) {
  const action = args[0];
  if (!action || action.startsWith("-")) {
    options.fleetAction = "show";
    return;
  }
  if (!new Set(["show", "set", "activity", "configure", "models"]).has(action)) {
    throw new Error(
      `Unknown fleet action "${action}". Use: ${formatCliCommand("fleet")}, ${formatCliCommand("fleet models")}, ${formatCliCommand("fleet configure")}, or ${formatCliCommand("fleet set --platform opencode --agent <id> --model <id>")}`
    );
  }
  args.shift();
  options.fleetAction = action === "activity" ? "show" : action;
}

function parseRoleList(value) {
  return [...new Set((value ?? "").split(",").map(role => role.trim()).filter(Boolean))];
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
  if (command === "host") return "host";
  if (command === "shell") return "shell";
  if (command === "orchestrator") return "orchestrator";
  if (command === "run") return "run";
  if (command === "runs") return "runs";
  if (command === "architect") return "architect";
  if (command === "plans") return "plans";
  if (command === "conversation") return "conversation";
  if (command === "ui") return "ui";
  if (command === "start") return "start";
  if (command === "resume") return "resume";
  if (command === "list") return "list";
  if (command === "review") return "review";
  if (command === "reviews") return "reviews";
  if (command === "monitor") return "monitor";
  if (command === "alerts") return "alerts";
  if (command === "graphify") return "graphify";
  if (command === "mcp") return "mcp";
  if (command === "connections") return "connections";
  if (command === "next") return "next";
  if (command === "control-plane") return "control-plane";
  if (command === "fleet") return "fleet";
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
