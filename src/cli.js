import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { detectProject } from "./project-detection.js";
import { installHarness } from "./template-installer.js";
import { updateHarness } from "./harness-updater.js";
import { runDoctorChecks } from "./doctor.js";

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
  const command = args[0]?.startsWith("-") ? "init" : args.shift();
  const options = {
    cwd: process.cwd(),
    mode: "standard",
    modeExplicit: false,
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
    } else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else throw new Error(`Unknown option "${arg}".`);
  }

  return { command, options };
}

async function runInit(options, packageManifest) {
  const project = await detectProject(options.cwd);
  const result = await installHarness({
    project,
    packageRoot,
    mode: options.mode,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    force: options.force,
    dryRun: options.dryRun
  });

  console.log(`Agentic Harness ${options.dryRun ? "plan" : "installed"} for ${project.name}`);
  console.log(`Mode: ${result.mode}`);
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
  const result = await updateHarness({
    project,
    packageRoot,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    mode: options.modeExplicit ? options.mode : undefined,
    force: options.force,
    dryRun: options.dryRun
  });

  console.log(`Agentic Harness ${options.dryRun ? "update plan" : "updated"} for ${project.name}`);
  console.log(`Mode: ${result.mode}`);
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

function printHelp() {
  console.log(`Agentic Harness (@kal-elsam/harness)

Install and maintain AI governance in any repository: SDD, TDD, evals, adapters and human approval gates.

Usage:
  harness init   [--mode minimal|standard|enterprise] [--force] [--dry-run]
  harness update [--mode minimal|standard|enterprise] [--force] [--dry-run]
  harness doctor

Commands:
  init      Install the harness. Writes .harness/manifest.json.
  update    Reapply the current harness templates. Preserves files you
            changed locally unless --force is passed. Use --dry-run to preview.
  doctor    Check harness health. Never modifies files.

Examples:
  npx @kal-elsam/harness init --mode enterprise
  npx @kal-elsam/harness update --dry-run
  npx @kal-elsam/harness update --force
  harness doctor

Aliases: agentic-harness, sgs-harness, harness-sgs
`);
}
