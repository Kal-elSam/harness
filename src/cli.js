import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { ADAPTERS } from "./harness-files.js";
import { GLOBAL_AGENT_IDS } from "./global/registry.js";
import { COMPONENT_IDS, DEFAULT_COMPONENT_IDS } from "./global/component-registry.js";
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
  runGlobalDiff
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
    case "setup":
      await runGlobalSetup(options, packageManifest, packageRoot);
      return;
    case "status":
      await runGlobalStatus(packageRoot, {
        workspaceRoot: options.cwd,
        json: options.json,
        cliVersion: packageManifest.version
      });
      return;
    case "sync":
      await runGlobalSync(options, packageManifest, packageRoot);
      return;
    case "upgrade":
      await runGlobalUpgrade(options, packageManifest, packageRoot);
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
      await runGlobalUninstall(options);
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
    case "pack":
      await runComponentsPack(options);
      return;
    case "import":
      await runComponentsImport(options);
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
    outPath: null,
    bundlePath: null,
    noDefaultComponents: false,
    force: false,
    dryRun: false,
    yes: false,
    confirm: false,
    preflight: true,
    json: false,
    apply: false,
    snapshot: null,
    help: false,
    version: false,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY)
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
    else if (arg === "--json") options.json = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--confirm") options.confirm = true;
    else if (arg === "--no-preflight") options.preflight = false;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--to") options.snapshot = args[++index];
    else if (arg.startsWith("--to=")) options.snapshot = arg.slice("--to=".length);
    else if (arg === "--label") options.label = args[++index];
    else if (arg.startsWith("--label=")) options.label = arg.slice("--label=".length);
    else if (arg === "--out") options.outPath = resolve(args[++index]);
    else if (arg.startsWith("--out=")) options.outPath = resolve(arg.slice("--out=".length));
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

  if (action === "init" || action === "pack") {
    const componentId = args[0];
    if (!componentId || componentId.startsWith("-")) {
      const usage = action === "init"
        ? 'harness components init <id> --label "My Label"'
        : "harness components pack <id> --out <file>";
      throw new Error(`Missing component id. Use: ${usage}`);
    }
    options.componentId = args.shift();
    return;
  }

  if (action === "import") {
    const bundlePath = args[0];
    if (!bundlePath || bundlePath.startsWith("-")) {
      throw new Error("Missing bundle path. Use: harness components import <file>");
    }
    options.bundlePath = resolve(args.shift());
    return;
  }

  if (action === "validate") return;

  throw new Error(`Unknown components action "${action}". Use validate, init, pack, or import.`);
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
  if (command === "setup") return "setup";
  if (command === "status") return "status";
  if (command === "sync") return "sync";
  if (command === "upgrade") return "upgrade";
  if (command === "init") return "init";
  if (command === "update" || command === "u") return "update";
  if (command === "doctor") return "doctor";
  if (command === "uninstall") return "uninstall";
  if (command === "detect" || command === "d") return "detect";
  if (command === "adapters") return "adapters";
  if (command === "explain") return "explain";
  if (command === "diff") return "diff";
  if (command === "backups") return "backups";
  if (command === "rollback") return "rollback";
  if (command === "components") return "components";
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

function printHelp() {
  console.log(`Agentic Harness (@kal-elsam/harness)

Local AI ecosystem configurator. Harness does not install AI apps — it powers and
coordinates agents you already have (Cursor, Codex, OpenCode, Claude) with managed
sections, components, backups, and drift repair under ~/.harness.

Bootstrap (no global install required):
  curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh
  curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --yes

Usage:
  harness --version
  harness setup [--dry-run] [--yes] [--confirm] [--no-preflight] [--agents <list|all>] [--components <list>]
  harness status [--json]
  harness sync [--dry-run] [--yes] [--confirm] [--json] [--no-preflight]
  harness upgrade [--dry-run] [--yes] [--confirm] [--no-preflight]
  harness install [--agents <list|all>] [--components <list>] [--dry-run]
  harness install --no-default-components
  harness doctor [--json]
  harness adapters [--json]
  harness explain [--json]
  harness diff [--json]
  harness update [--dry-run]
  harness install --scope=workspace [--mode minimal|standard|enterprise] (opt-in/legacy)
  harness init [--mode minimal|standard|enterprise] (workspace alias)
  harness detect
  harness backups
  harness rollback --to <snapshot> [--apply]
  harness components
  harness components validate|init|pack|import ...
  harness uninstall [--dry-run]

Scopes:
  agent-global (default)  Configure local agent roots and managed sections.
                          Primary product path. Writes ~/.harness state.
  workspace (opt-in)      Legacy repo scaffolding into the current project.
                          Explicit --scope=workspace only.

Commands:
  setup      Interactive wizard: detect agents, choose integrations, apply plan.
  status     Control panel: agents, components, drift, backups, next action.
  sync       Converge managed content (repair drift), then show status.
  upgrade    Preview or apply ecosystem updates (apply requires --yes).
  install    Non-interactive configure (agent-global) or legacy workspace scaffold.
  doctor     Detailed health checks for managed state and configs.
  update     Technical repair alias (prefer sync for day-to-day use).
  detect     Inspect global agents and the current project. Read-only.
  adapters   Official adapter matrix: roots, config files, detected/managed.
  explain    Read-only audit of managed adapters, configs, markers, and backups.
  diff       Read-only preview of managed content changes (sync/setup plan).
  backups    List config snapshots under ~/.harness/backups.
  rollback   Preview or restore a prior config snapshot (--apply to write).
  components List, validate, scaffold, pack, or import workspace components.
  uninstall  Remove managed sections and global state. Backups are preserved.
  init       Alias for install --scope=workspace (legacy).

JSON output (--json on status, sync, doctor):
  Machine-readable envelope for CI, tooling, and debugging. Human text remains default.
  Stable fields: ok, overall, agents, components, checks, backups, nextAction, cliVersion.

Version:
  harness --version                         Installed CLI version
  npm view @kal-elsam/harness version       Latest published version
  npx @kal-elsam/harness@latest sync        Update / converge managed content
  harness upgrade --dry-run                 Preview upgrade plan (no writes)
  npx @kal-elsam/harness@latest setup --yes Apply latest package to ecosystem

Examples:
  npx @kal-elsam/harness setup
  harness status
  harness status --json
  harness adapters --json
  harness explain
  harness explain --json
  harness diff
  harness diff --json
  harness sync
  harness sync --dry-run --json
  harness upgrade --dry-run
  harness doctor --json
  npx @kal-elsam/harness install --agents cursor,codex --components orchestrator,sdd-core
  harness install --scope=workspace --mode enterprise
  harness uninstall --dry-run

Aliases: agentic-harness, sgs-harness, harness-sgs
Global agents: ${GLOBAL_AGENT_IDS.join(", ")}
Global components: ${COMPONENT_IDS.join(", ")} (default: ${DEFAULT_COMPONENT_IDS.join(", ")})
Workspace adapters: ${[...ADAPTERS].join(", ")}
`);
}
