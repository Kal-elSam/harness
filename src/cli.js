import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { ADAPTERS } from "./harness-files.js";
import { GLOBAL_AGENT_IDS } from "./global/registry.js";
import { COMPONENT_IDS, DEFAULT_COMPONENT_IDS } from "./global/component-registry.js";
import {
  printGlobalComponents,
  printGlobalDetect,
  runComponentsInit,
  runComponentsValidate,
  runGlobalBackups,
  runGlobalDoctor,
  runGlobalInstall,
  runGlobalRollback,
  runGlobalUninstall
} from "./global/global-cli.js";
import { runWorkspaceDetect, runWorkspaceDoctor, runWorkspaceInit, runWorkspaceUpdate } from "./workspace-cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const KNOWN_CLI_NAMES = new Set(["harness", "agentic-harness", "sgs-harness", "harness-sgs"]);
const SCOPES = new Set(["agent-global", "workspace"]);

export function resolveSuggestedInvocation(packageName, argv = process.argv) {
  const invokedPath = argv[1] ?? "harness";
  const invokedBase = basename(invokedPath);

  if (!invokedBase.endsWith(".js") && KNOWN_CLI_NAMES.has(invokedBase)) {
    return invokedBase;
  }

  const packageManager = detectInvocationPackageManager();

  switch (packageManager) {
    case "pnpm":
      return `pnpm dlx ${packageName}`;
    case "yarn":
      return `yarn dlx ${packageName}`;
    case "bun":
      return `bunx ${packageName}`;
    default:
      return `npx ${packageName}`;
  }
}

function detectInvocationPackageManager() {
  const execPath = process.env.npm_execpath ?? "";
  const userAgent = process.env.npm_config_user_agent ?? "";

  if (execPath.includes("pnpm") || userAgent.startsWith("pnpm/")) return "pnpm";
  if (execPath.includes("yarn") || userAgent.startsWith("yarn/")) return "yarn";
  if (execPath.includes("bun") || userAgent.startsWith("bun/")) return "bun";
  return "npm";
}

export async function runCli(argv) {
  const { command, options } = parseArgs(argv);

  if (options.help || command === "help") {
    printHelp();
    return;
  }

  const packageManifest = await readPackageManifest();

  if (options.version || command === "version") {
    console.log(packageManifest.version);
    return;
  }

  const invoke = resolveSuggestedInvocation(packageManifest.name);

  switch (command) {
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
        "agent-global": () => runGlobalDoctor(packageRoot, { workspaceRoot: options.cwd }),
        workspace: () => runWorkspaceDoctor(options)
      });
      return;
    case "uninstall":
      if (options.scope === "workspace") {
        throw new Error('Workspace uninstall is not supported yet. Remove workspace files manually or via git.');
      }
      await runGlobalUninstall(options);
      return;
    case "detect":
      printGlobalDetect();
      console.log("");
      await runWorkspaceDetect(options, invoke);
      return;
    case "backups":
      await runGlobalBackups();
      return;
    case "rollback":
      await runGlobalRollback(options);
      return;
    case "components":
      await dispatchComponentsCommand(options, invoke);
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
    default:
      throw new Error(
        `Unknown components action "${options.componentsAction}". Run "${invoke} help".`
      );
  }
}

async function readPackageManifest() {
  return JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
}

function parseArgs(argv) {
  const args = [...argv];
  const firstArg = args[0];
  const implicitCommand = !firstArg || firstArg.startsWith("-");
  const rawCommand = implicitCommand ? "install" : args.shift();
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
    label: null,
    noDefaultComponents: false,
    force: false,
    dryRun: false,
    apply: false,
    snapshot: null,
    help: false,
    version: false
  };

  if (command === "components") {
    parseComponentsAction(args, options);
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
    } else if (arg === "--adapters" || arg === "--agents") {
      options.adapters = parseAdapters(args[++index]);
    } else if (arg.startsWith("--adapters=")) {
      options.adapters = parseAdapters(arg.slice("--adapters=".length));
    } else if (arg.startsWith("--agents=")) {
      options.adapters = parseAdapters(arg.slice("--agents=".length));
    } else if (arg === "--components") {
      options.components = parseAdapters(args[++index]);
    } else if (arg.startsWith("--components=")) {
      options.components = parseAdapters(arg.slice("--components=".length));
    } else if (arg === "--no-default-components") options.noDefaultComponents = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--to") options.snapshot = args[++index];
    else if (arg.startsWith("--to=")) options.snapshot = arg.slice("--to=".length);
    else if (arg === "--label") options.label = args[++index];
    else if (arg.startsWith("--label=")) options.label = arg.slice("--label=".length);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else throw new Error(`Unknown option "${arg}".`);
  }

  return { command, options };
}

function parseComponentsAction(args, options) {
  const action = args[0];
  if (!action || action.startsWith("-")) return;

  args.shift();
  options.componentsAction = action;

  if (action === "init") {
    const componentId = args[0];
    if (!componentId || componentId.startsWith("-")) {
      throw new Error('Missing component id. Use: harness components init <id> --label "My Label"');
    }
    options.componentId = args.shift();
    return;
  }

  if (action === "validate") return;

  throw new Error(`Unknown components action "${action}". Use validate or init.`);
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
  if (command === "init") return "init";
  if (command === "update" || command === "u") return "update";
  if (command === "doctor") return "doctor";
  if (command === "uninstall") return "uninstall";
  if (command === "detect" || command === "d") return "detect";
  if (command === "backups") return "backups";
  if (command === "rollback") return "rollback";
  if (command === "components") return "components";
  if (command === "help") return "help";
  if (command === "version") return "version";

  return command;
}

function parseAdapters(value) {
  if (!value) return [];

  return [...new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  )];
}

function printHelp() {
  console.log(`Agentic Harness (@kal-elsam/harness)

Configure the local AI agent ecosystem (Cursor, Codex, OpenCode, Claude) or
install AI governance into a repository: SDD, TDD, evals, adapters and gates.

Usage:
  harness install [--scope=agent-global|workspace] [--components <list>] [--dry-run]
  harness install --no-default-components
  harness install --scope=workspace [--mode minimal|standard|enterprise] [--adapters <list>] [--force]
  harness init [--mode minimal|standard|enterprise] [--adapters <list>] (workspace alias)
  harness detect
  harness update [--scope=agent-global|workspace] [--dry-run]
  harness doctor [--scope=agent-global|workspace]
  harness backups
  harness rollback --to <snapshot> [--apply]
  harness components
  harness components validate [--cwd <path>]
  harness components init <id> --label "<label>" [--cwd <path>]
  harness uninstall [--dry-run]

Scopes:
  agent-global (default)  Configure local agent roots. Writes managed state to
                          ~/.harness, installs orchestrator + sdd-core by default,
                          and adds managed marker sections to agent configs with a
                          backup before every change. No project files.
  workspace               Scaffold governance files into the current repo
                          (previous default behavior). Writes .harness/manifest.json.

Commands:
  install    Configure the ecosystem (agent-global) or scaffold a repo (workspace).
  init       Alias for install --scope=workspace (compatibility).
  detect     Inspect global agents and the current project. Read-only.
  update     Refresh managed content without touching user-owned sections.
  doctor     Report installed agents, state, backups, and missing configs.
  backups    List config snapshots under ~/.harness/backups.
  rollback   Preview or restore a prior config snapshot (--apply to write).
  components List, validate, or scaffold workspace components.
  uninstall  Remove managed sections and global state. Backups are preserved.

Examples:
  npx @kal-elsam/harness install
  npx @kal-elsam/harness install --components orchestrator,sdd-core
  npx @kal-elsam/harness install --no-default-components
  npx @kal-elsam/harness install --dry-run
  npx @kal-elsam/harness install --scope=workspace --mode enterprise
  harness components init team-rules --label "Team Rules"
  harness components validate
  harness install --components team-rules
  harness doctor
  harness backups
  harness rollback --to <snapshot>
  harness uninstall --dry-run

Aliases: agentic-harness, sgs-harness, harness-sgs
Global agents: ${GLOBAL_AGENT_IDS.join(", ")}
Global components: ${COMPONENT_IDS.join(", ")} (default: ${DEFAULT_COMPONENT_IDS.join(", ")})
Workspace adapters: ${[...ADAPTERS].join(", ")}
`);
}
