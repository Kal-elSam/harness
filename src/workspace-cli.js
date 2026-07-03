import { detectProject } from "./project-detection.js";
import { installHarness } from "./template-installer.js";
import { updateHarness } from "./harness-updater.js";
import { runDoctorChecks } from "./doctor.js";

export async function runWorkspaceInit(options, packageManifest, packageRoot, suggestedInvocation) {
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

  console.log(`Agentic Harness ${options.dryRun ? "plan" : "installed"} for ${project.name} (scope: workspace)`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Adapters: ${formatAdapters(result.adapters)}`);
  console.log(`Created: ${result.created.length}`);
  console.log(`Skipped: ${result.skipped.length}`);
  console.log(`Updated: ${result.updated.length}`);

  if (result.skipped.length > 0 && !options.force) {
    console.log("Existing files were preserved. Re-run with --force to overwrite.");
  }

  if (!options.dryRun) {
    console.log(`Tracked in .harness/manifest.json. Run "${suggestedInvocation} update --scope=workspace" to apply future harness releases.`);
  }
}

export async function runWorkspaceUpdate(options, packageManifest, packageRoot) {
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

  console.log(`Agentic Harness ${options.dryRun ? "update plan" : "updated"} for ${project.name} (scope: workspace)`);
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

export async function runWorkspaceDoctor(options) {
  const project = await detectProject(options.cwd);
  const { checks, ok } = await runDoctorChecks(project);

  console.log(`Agentic Harness doctor for ${project.name} (scope: workspace)`);
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

export async function runWorkspaceDetect(options, suggestedInvocation) {
  const project = await detectProject(options.cwd);
  const adapters = options.allAdapters ? null : options.adapters ?? project.detectedAdapters;

  console.log(`Workspace project: ${project.name}`);
  console.log(`Root: ${project.root}`);
  console.log(`Package manager: ${project.packageManager}`);
  console.log(`Stack: ${project.stack}`);
  console.log(`Detected adapters: ${formatAdapters(project.detectedAdapters)}`);
  console.log(`Recommended adapters: ${formatAdapters(adapters)}`);
  console.log(`Suggested workspace install: ${suggestedInvocation} install --scope=workspace --mode standard${adapters?.length ? ` --adapters ${adapters.join(",")}` : ""}`);
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
