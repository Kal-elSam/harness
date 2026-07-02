import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { detectProject } from "./project-detection.js";
import { installHarness } from "./template-installer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");

export async function runCli(argv) {
  const { command, options } = parseArgs(argv);

  if (options.help || command === "help") {
    printHelp();
    return;
  }

  if (options.version || command === "version") {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
    console.log(manifest.version);
    return;
  }

  if (command === "doctor") {
    await runDoctor(options);
    return;
  }

  if (!command || command === "init") {
    await runInit(options);
    return;
  }

  throw new Error(`Unknown command "${command}". Run "sgs-harness help".`);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args[0]?.startsWith("-") ? "init" : args.shift();
  const options = {
    cwd: process.cwd(),
    mode: "standard",
    force: false,
    dryRun: false,
    help: false,
    version: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--cwd") options.cwd = resolve(args[++index]);
    else if (arg === "--mode") options.mode = args[++index];
    else if (arg.startsWith("--mode=")) options.mode = arg.slice("--mode=".length);
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else throw new Error(`Unknown option "${arg}".`);
  }

  return { command, options };
}

async function runInit(options) {
  const project = await detectProject(options.cwd);
  const result = await installHarness({
    project,
    packageRoot,
    mode: options.mode,
    force: options.force,
    dryRun: options.dryRun
  });

  console.log(`SGS Harness ${options.dryRun ? "plan" : "installed"} for ${project.name}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Created: ${result.created.length}`);
  console.log(`Skipped: ${result.skipped.length}`);
  console.log(`Updated: ${result.updated.length}`);

  if (result.skipped.length > 0 && !options.force) {
    console.log("Existing files were preserved. Re-run with --force to overwrite.");
  }
}

async function runDoctor(options) {
  const project = await detectProject(options.cwd);
  const required = ["AGENTS.md", "docs/ai/harness.md", "docs/ai/memory.md"];
  const missing = [];

  for (const relativePath of required) {
    const { existsSync } = await import("node:fs");
    if (!existsSync(resolve(project.root, relativePath))) missing.push(relativePath);
  }

  console.log(`SGS Harness doctor for ${project.name}`);
  console.log(`Root: ${project.root}`);
  console.log(`Package manager: ${project.packageManager}`);
  console.log(`Stack: ${project.stack}`);

  if (missing.length > 0) {
    console.log(`Missing: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log("Status: OK");
}

function printHelp() {
  console.log(`SGS Harness

Install a reusable AI governance harness into any repository.

Usage:
  sgs-harness init [--mode minimal|standard|enterprise] [--force] [--dry-run]
  sgs-harness doctor

Examples:
  pnpm dlx @kal-elsam/harness init --mode enterprise
  npx @kal-elsam/harness init --mode standard
`);
}
