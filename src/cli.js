import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { detectProject } from "./project-detection.js";
import { installHarness } from "./template-installer.js";
import { updateHarness } from "./harness-updater.js";
import { runDoctorChecks } from "./doctor.js";
import { ADAPTERS } from "./harness-files.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const cliName = basename(process.argv[1] ?? "harness");

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

  if (command === "doctor") {
    await runDoctor(options);
    return;
  }

  if (command === "detect") {
    await runDetect(options);
    return;
  }

  if (command === "update") {
    await runUpdate(options, packageManifest);
    return;
  }

  if (!command || command === "init") {
    await runInit(options, packageManifest);
    return;
  }

  throw new Error(`Unknown command "${command}". Run "${cliName} help".`);
}

async function readPackageManifest() {
  return JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
}

function parseArgs(argv) {
  const args = [...argv];
  const firstArg = args[0];
  const implicitCommand = !firstArg || firstArg.startsWith("-");
  const rawCommand = implicitCommand ? "init" : args.shift();
  const command = normalizeCommand(rawCommand);
  const options = {
    cwd: process.cwd(),
    mode: "standard",
    modeExplicit: false,
    detect: implicitCommand,
    adapters: null,
    allAdapters: false,
    force: false,
    dryRun: false,
    help: false,
    version: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--cwd") options.cwd = resolve(args[++index]);
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
    } else if (arg === "--adapters") {
      options.adapters = parseAdapters(args[++index]);
    } else if (arg.startsWith("--adapters=")) {
      options.adapters = parseAdapters(arg.slice("--adapters=".length));
    } else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else throw new Error(`Unknown option "${arg}".`);
  }

  return { command, options };
}

function normalizeCommand(command) {
  if (!command) return "init";

  if (command === "install" || command === "i") return "init";
  if (command === "update" || command === "u") return "update";
  if (command === "doctor") return "doctor";
  if (command === "detect" || command === "d") return "detect";
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

async function runInit(options, packageManifest) {
  const project = await detectProject(options.cwd);
  const adapters = resolveAdapters(project, options);
  const result = await installHarness({
    project,
    packageRoot,
    mode: options.mode,
    adapters,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    force: options.force,
    dryRun: options.dryRun
  });

  console.log(`Agentic Harness ${options.dryRun ? "plan" : "installed"} for ${project.name}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Adapters: ${formatAdapters(result.adapters)}`);
  console.log(`Created: ${result.created.length}`);
  console.log(`Skipped: ${result.skipped.length}`);
  console.log(`Updated: ${result.updated.length}`);

  if (result.skipped.length > 0 && !options.force) {
    console.log("Existing files were preserved. Re-run with --force to overwrite.");
  }

  if (!options.dryRun) {
    console.log('Tracked in .harness/manifest.json. Run "harness update" to apply future harness releases.');
  }
}

async function runUpdate(options, packageManifest) {
  const project = await detectProject(options.cwd);
  const adapters = resolveAdapters(project, options, { allowManifestFallback: true });
  const result = await updateHarness({
    project,
    packageRoot,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    mode: options.modeExplicit ? options.mode : undefined,
    adapters,
    force: options.force,
    dryRun: options.dryRun
  });

  console.log(`Agentic Harness ${options.dryRun ? "update plan" : "updated"} for ${project.name}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Adapters: ${formatAdapters(result.adapters)}`);
  console.log(`Created: ${result.created.length}`);
  console.log(`Updated: ${result.updated.length}`);
  console.log(`Unchanged: ${result.unchanged.length}`);

  if (result.skippedModified.length > 0) {
    console.log(`Skipped, modified locally: ${result.skippedModified.length}`);
    console.log("Re-run with --force to overwrite locally modified files.");
  }

  if (result.skippedUntracked.length > 0) {
    console.log(`Skipped, untracked pre-existing files: ${result.skippedUntracked.length}`);
  }
}

async function runDoctor(options) {
  const project = await detectProject(options.cwd);
  const { checks, ok } = await runDoctorChecks(project);

  console.log(`Agentic Harness doctor for ${project.name}`);
  console.log(`Root: ${project.root}`);
  console.log(`Package manager: ${project.packageManager}`);
  console.log(`Stack: ${project.stack}`);
  console.log("");

  for (const check of checks) {
    const label = check.status.toUpperCase().padEnd(8);
    const detail = check.detail ? ` — ${check.detail}` : "";
    console.log(`[${label}] ${check.name}${detail}`);
  }

  console.log("");
  console.log(ok ? "Status: OK" : "Status: FAILED (missing required files)");

  if (!ok) process.exitCode = 1;
}

async function runDetect(options) {
  const project = await detectProject(options.cwd);
  const adapters = options.allAdapters ? null : options.adapters ?? project.detectedAdapters;

  console.log(`Agentic Harness detect for ${project.name}`);
  console.log(`Root: ${project.root}`);
  console.log(`Package manager: ${project.packageManager}`);
  console.log(`Stack: ${project.stack}`);
  console.log(`Detected adapters: ${formatAdapters(project.detectedAdapters)}`);
  console.log(`Recommended adapters: ${formatAdapters(adapters)}`);
  console.log(`Suggested install: ${cliName} --mode standard${adapters?.length ? ` --adapters ${adapters.join(",")}` : ""}`);
}

function resolveAdapters(project, options, config = {}) {
  if (options.allAdapters) return null;
  if (options.adapters) return options.adapters;
  if (options.detect) return project.detectedAdapters;
  if (config.allowManifestFallback) return undefined;
  return null;
}

function formatAdapters(adapters) {
  if (adapters == null) return "all";
  if (adapters.length === 0) return "core only";
  return adapters.join(", ");
}

function printHelp() {
  console.log(`Agentic Harness (@kal-elsam/harness)

Install and maintain AI governance in any repository: SDD, TDD, evals, adapters and human approval gates.

Usage:
  harness [--mode minimal|standard|enterprise] [--detect] [--adapters <list>] [--force] [--dry-run]
  harness init|install [--mode minimal|standard|enterprise] [--detect] [--adapters <list>] [--force] [--dry-run]
  harness detect [--adapters <list>]
  harness update [--mode minimal|standard|enterprise] [--detect] [--adapters <list>] [--force] [--dry-run]
  harness doctor

Commands:
  init      Install the harness. Writes .harness/manifest.json.
  install   Alias for init.
  detect    Inspect the project and recommend adapters.
  update    Reapply the current harness templates. Preserves files you
            changed locally unless --force is passed. Use --dry-run to preview.
  doctor    Check harness health. Never modifies files.

Examples:
  npx @kal-elsam/harness
  npx @kal-elsam/harness detect
  npx @kal-elsam/harness init --mode enterprise --all-adapters
  npx @kal-elsam/harness update --dry-run
  harness detect
  harness --mode standard --adapters codex,cursor
  harness doctor

Aliases: agentic-harness, sgs-harness, harness-sgs
Adapters: ${[...ADAPTERS].join(", ")}
`);
}
