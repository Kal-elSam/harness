import { GLOBAL_AGENT_IDS, detectInstalledAdapters } from "./registry.js";
import { describeBundledComponentCatalog, describeWorkspaceComponentCatalog } from "./component-registry.js";
import { installGlobalHarness, uninstallGlobalHarness, updateGlobalHarness } from "./global-installer.js";
import { resolveHomeDir, harnessHomePaths } from "./paths.js";
import { runGlobalDoctorChecks } from "./global-doctor.js";
import { describeBackupSnapshots, applyRollback, previewRollback } from "./rollback.js";

export async function runGlobalInstall(options, packageManifest, packageRoot, { update = false } = {}) {
  const homeDir = resolveHomeDir();
  const workspaceRoot = options.cwd;
  const run = update ? updateGlobalHarness : installGlobalHarness;
  const result = await run({
    packageRoot,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    homeDir,
    workspaceRoot,
    agents: options.adapters,
    components: options.components,
    noDefaultComponents: options.noDefaultComponents,
    dryRun: options.dryRun
  });

  const verb = update ? "update" : "install";
  const pastLabel = update ? "updated" : "installed";
  console.log(`Agentic Harness global ${options.dryRun ? `${verb} plan` : pastLabel} (scope: agent-global)`);
  console.log(`State root: ${result.stateRoot}`);
  console.log(`Agents: ${result.agents.join(", ")}`);
  console.log(`Components: ${result.components.join(", ") || "none (core plumbing only)"}`);
  console.log(`Core files: ${result.coreFiles.join(", ") || "none"}`);

  if (update) {
    console.log(`Drift detected: ${result.driftDetected ? "yes" : "no"}`);
    console.log(`Assets repaired: ${result.assetsRepaired.length}`);
    console.log(`Assets unchanged: ${result.assetsUnchanged.length}`);
    console.log(`Sections repaired: ${result.configsRepaired.length}`);
  }

  console.log(`Configs created: ${result.configsCreated.length}`);
  console.log(`Configs updated: ${result.configsUpdated.length}`);
  console.log(`Configs unchanged: ${result.configsUnchanged.length}`);
  console.log(`Backups: ${result.backups.length}`);

  if (options.dryRun) {
    if (result.repairs?.length) {
      console.log(`Planned repairs: ${result.repairs.length}`);
      for (const repair of result.repairs) {
        console.log(`  - [${repair.status.toUpperCase()}] ${repair.name}`);
      }
    }
    console.log("Dry run: nothing was written.");
    return;
  }

  console.log('State tracked in ~/.harness/state.json. Run "harness doctor" to verify.');
}

export async function runGlobalUninstall(options) {
  const homeDir = resolveHomeDir();
  const result = await uninstallGlobalHarness({
    homeDir,
    dryRun: options.dryRun
  });

  console.log(`Agentic Harness global ${options.dryRun ? "uninstall plan" : "uninstalled"} (scope: agent-global)`);
  console.log(`Configs cleaned: ${result.configsCleaned.join(", ") || "none"}`);
  console.log(`Backups: ${result.backups.length}`);
  console.log(`State removed: ${result.stateRemoved ? "yes" : "no state found"}`);
  console.log("Backups under ~/.harness/backups were preserved.");
}

export async function runGlobalDoctor(packageRoot, { workspaceRoot = process.cwd() } = {}) {
  const homeDir = resolveHomeDir();
  const { checks, ok, hasDrift } = await runGlobalDoctorChecks(homeDir, { packageRoot, workspaceRoot });

  console.log("Agentic Harness doctor (scope: agent-global)");
  console.log(`Home: ${homeDir}`);
  console.log("");

  for (const check of checks) {
    const label = check.status.toUpperCase().padEnd(8);
    const detail = check.detail ? ` — ${check.detail}` : "";
    console.log(`[${label}] ${check.name}${detail}`);
  }

  console.log("");
  if (ok) {
    console.log("Status: OK");
  } else if (hasDrift) {
    console.log('Status: DRIFT DETECTED — run "harness update" to auto-repair managed content');
  } else {
    console.log("Status: FAILED (missing managed state or configs)");
  }

  if (!ok) process.exitCode = 1;
}

export function printGlobalDetect() {
  const homeDir = resolveHomeDir();
  const detected = detectInstalledAdapters({ homeDir });

  console.log("Global agents (scope: agent-global)");
  console.log(`Home: ${homeDir}`);
  console.log(`Detected: ${detected.join(", ") || "none"}`);
  console.log(`Supported: ${GLOBAL_AGENT_IDS.join(", ")}`);
}

export function printGlobalComponents({ workspaceRoot = process.cwd() } = {}) {
  const bundled = describeBundledComponentCatalog();
  const workspace = describeWorkspaceComponentCatalog(workspaceRoot);

  console.log("Harness components (scope: agent-global)");
  console.log(`Bundled: ${bundled.length}`);

  for (const component of bundled) {
    printComponentEntry(component);
  }

  console.log("");
  console.log(`Workspace: ${workspace.length}`);

  if (workspace.length === 0) {
    console.log("No workspace catalog at .harness/components/catalog.json");
    return;
  }

  for (const component of workspace) {
    printComponentEntry(component, { workspace: true });
  }
}

function printComponentEntry(component, { workspace = false } = {}) {
  const defaultLabel = workspace ? "workspace" : (component.defaultEnabled ? "default" : "optional");
  console.log("");
  console.log(`${component.id} (${component.version}) [${defaultLabel}]`);
  console.log(`  Label: ${component.label}`);
  console.log(`  Assets: ${component.assetFiles.join(", ")}`);

  if (component.instructions) {
    console.log(`  Instructions: ${component.instructions}`);
  }

  if (component.adapterHints.length > 0) {
    console.log(`  Adapter hints: ${component.adapterHints.join(", ")}`);
  }
}

export async function runGlobalBackups() {
  const homeDir = resolveHomeDir();
  const { backupsDir } = harnessHomePaths(homeDir);
  const snapshots = await describeBackupSnapshots(backupsDir);

  console.log("Harness backups");
  console.log("Directory: ~/.harness/backups");
  console.log(`Snapshots: ${snapshots.length}`);

  if (snapshots.length === 0) {
    console.log("No snapshots yet. Backups are created before config changes.");
    return;
  }

  for (const snapshot of snapshots) {
    console.log(`- ${snapshot.name} (${snapshot.fileCount} file${snapshot.fileCount === 1 ? "" : "s"})`);
  }
}

export async function runGlobalRollback(options) {
  if (!options.snapshot) {
    throw new Error('Missing snapshot. Use: harness rollback --to <snapshot>');
  }

  const homeDir = resolveHomeDir();

  if (options.apply) {
    const result = await applyRollback({ homeDir, snapshot: options.snapshot });

    console.log("Harness rollback applied");
    console.log(`Snapshot: ${result.snapshot}`);
    console.log(`Restored: ${result.restored.length}`);

    if (result.noop) {
      console.log("No files to restore.");
      return;
    }

    if (result.safetyBackup) {
      console.log(`Safety backup: ${result.safetyBackup}`);
    }
    return;
  }

  const result = await previewRollback({ homeDir, snapshot: options.snapshot });

  console.log("Harness rollback preview");
  console.log(`Snapshot: ${result.snapshot}`);
  console.log(`Files: ${result.plans.length}`);

  if (result.noop) {
    console.log("No files to restore.");
    return;
  }

  console.log("Would restore:");
  for (const plan of result.plans) {
    console.log(`- ${plan.displayPath}`);
  }

  console.log("");
  console.log("Run with --apply to restore.");
}
