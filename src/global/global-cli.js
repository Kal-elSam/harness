import { GLOBAL_AGENT_IDS, detectInstalledAdapters } from "./registry.js";
import { describeBundledComponentCatalog, describeWorkspaceComponentCatalog } from "./component-registry.js";
import { initWorkspaceComponent, validateWorkspaceComponentsCatalog } from "./component-authoring.js";
import { importWorkspaceComponent, packWorkspaceComponent } from "./component-distribution.js";
import { installGlobalHarness, uninstallGlobalHarness, updateGlobalHarness } from "./global-installer.js";
import { resolveHomeDir, harnessHomePaths } from "./paths.js";
import { runGlobalDoctorChecks } from "./global-doctor.js";
import { describeBackupSnapshots, applyRollback, previewRollback } from "./rollback.js";
import { buildAdapterMatrixReport } from "./adapter-matrix.js";
import { buildControlPlaneJson, printJson } from "./json-output.js";
import { runHarnessSetup } from "./setup.js";
import { buildStatusReport } from "./status.js";
import { runHarnessSync } from "./sync.js";
import { runHarnessUpgrade } from "./upgrade.js";
import { buildExplainJson, buildExplainReport } from "./explain.js";
import { buildDiffJson, buildDiffReport } from "./diff.js";
import {
  applyPolicyToOptions,
  buildPolicyJson,
  formatPolicyProfileLabel,
  formatPolicySourceLabel,
  loadPolicyFile,
  resetPolicyFile,
  resolvePolicy,
  savePolicyField
} from "./policy.js";
import {
  buildCheckSnapshot,
  formatHistoryEvent,
  getHistoryPath,
  readHistoryEvents,
  readLastHistoryEvent,
  recordPolicyHistory,
  recordRollbackHistory,
  recordSetupHistory,
  recordSyncHistory,
  recordUninstallHistory,
  recordUpgradeHistory
} from "./history.js";
import { buildDiagnosticsReport, buildReportJson, DEFAULT_HISTORY_LIMIT, writeReportFile } from "./report.js";
import { BRAND, commandHeader } from "./brand/index.js";
import { formatCliCommand } from "./brand/cli.js";

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

  printInstallResult(result, { update, dryRun: options.dryRun });
  return result;
}

export async function runGlobalSetup(options, packageManifest, packageRoot) {
  const homeDir = resolveHomeDir();
  const preReport = await buildStatusReport(homeDir, { packageRoot, workspaceRoot: options.cwd });
  const checksBefore = buildCheckSnapshot(preReport.counts);

  const outcome = await runHarnessSetup({
    packageRoot,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    homeDir,
    workspaceRoot: options.cwd,
    agents: options.adapters,
    components: options.components,
    noDefaultComponents: options.noDefaultComponents,
    dryRun: options.dryRun,
    yes: options.yes,
    confirm: options.confirm,
    preflight: options.preflight,
    preflightExplicit: options.preflightExplicit,
    yesExplicit: options.yesExplicit,
    confirmExplicit: options.confirmExplicit,
    json: options.json,
    interactive: options.interactive,
    simple: options.simple
  });

  await recordSetupHistory(homeDir, {
    cliVersion: packageManifest.version,
    options,
    outcome,
    checksBefore,
    packageRoot,
    workspaceRoot: options.cwd
  });

  if (outcome.cancelled) return outcome;

  if (!outcome.usedWizard) {
    printInstallResult(outcome.result, { update: false, dryRun: options.dryRun, command: "setup" });
  }
  return outcome;
}

export async function runGlobalStatus(packageRoot, {
  workspaceRoot = process.cwd(),
  setExitCode = true,
  json = false,
  cliVersion = null
} = {}) {
  const homeDir = resolveHomeDir();
  const report = await buildStatusReport(homeDir, { packageRoot, workspaceRoot });

  if (json) {
    printJson(buildControlPlaneJson(report, { cliVersion }));
  } else {
    printStatusReport(report);
  }

  if (setExitCode && !report.ok) process.exitCode = 1;
  return report;
}

export async function runGlobalSync(options, packageManifest, packageRoot) {
  const homeDir = resolveHomeDir();
  const preReport = await buildStatusReport(homeDir, { packageRoot, workspaceRoot: options.cwd });
  const checksBefore = buildCheckSnapshot(preReport.counts);

  const outcome = await runHarnessSync({
    packageRoot,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    homeDir,
    workspaceRoot: options.cwd,
    dryRun: options.dryRun,
    yes: options.yes,
    confirm: options.confirm,
    preflight: options.preflight,
    preflightExplicit: options.preflightExplicit,
    yesExplicit: options.yesExplicit,
    confirmExplicit: options.confirmExplicit,
    json: options.json,
    interactive: options.interactive
  });

  await recordSyncHistory(homeDir, {
    cliVersion: packageManifest.version,
    options,
    outcome,
    checksBefore,
    packageRoot,
    workspaceRoot: options.cwd
  });

  if (options.json) {
    printJson(buildControlPlaneJson(outcome.report, {
      cliVersion: packageManifest.version,
      extras: buildSyncJsonExtras(outcome)
    }));
    if (!outcome.report.ok) process.exitCode = 1;
    return outcome;
  }

  console.log(commandHeader("sync — converge local AI ecosystem"));

  switch (outcome.action) {
    case "setup-required":
      console.log(`No managed state found. Run "${formatCliCommand("setup")}" first.`);
      if (options.dryRun) console.log("Dry run: nothing was written.");
      break;
    case "noop":
      console.log("Ecosystem already in sync. No changes needed.");
      if (options.dryRun) console.log("Dry run: nothing was written.");
      break;
    case "plan":
      printSyncRepairSummary(outcome.result, { dryRun: true });
      break;
    case "repaired":
      printSyncRepairSummary(outcome.result, { dryRun: false });
      break;
    case "cancelled":
      console.log("Sync cancelled. No changes were written.");
      break;
    default: {
      const _exhaustive = outcome.action;
      throw new Error(`Unknown sync action: ${_exhaustive}`);
    }
  }

  console.log("");
  printStatusReport(outcome.report);
  if (!outcome.report.ok) process.exitCode = 1;
  return outcome;
}

export async function runGlobalUpgrade(options, packageManifest, packageRoot) {
  const homeDir = resolveHomeDir();
  const preReport = await buildStatusReport(homeDir, { packageRoot, workspaceRoot: options.cwd });
  const checksBefore = buildCheckSnapshot(preReport.counts);

  const outcome = await runHarnessUpgrade({
    packageRoot,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    homeDir,
    workspaceRoot: options.cwd,
    dryRun: options.dryRun,
    yes: options.yes,
    confirm: options.confirm,
    preflight: options.preflight,
    preflightExplicit: options.preflightExplicit,
    yesExplicit: options.yesExplicit,
    confirmExplicit: options.confirmExplicit,
    json: options.json,
    interactive: options.interactive
  });

  await recordUpgradeHistory(homeDir, {
    cliVersion: packageManifest.version,
    options,
    outcome,
    checksBefore,
    packageRoot,
    workspaceRoot: options.cwd
  });

  if (outcome.cancelled) {
    console.log(commandHeader("upgrade — preview or apply managed ecosystem updates"));
    console.log("Upgrade cancelled. No changes were written.");
    return outcome;
  }

  console.log(commandHeader("upgrade — preview or apply managed ecosystem updates"));
  console.log(`Installed CLI: ${outcome.installedVersion}`);
  console.log(`Published latest: ${outcome.latestVersion}`);
  console.log("");

  if (outcome.dryRun) {
    console.log("Preview only. No configs or ~/.harness state were modified.");
    console.log(`Run latest package preview: ${outcome.previewCommand}`);
    console.log(`Apply with latest package:  ${outcome.latestCommand}`);
    console.log("");
    printInstallResult(outcome.result, { update: true, dryRun: true, command: "upgrade" });
    return outcome;
  }

  console.log("Applied upgrade with the current CLI package.");
  console.log(`To converge with npm latest, run: ${outcome.latestCommand}`);
  console.log("");
  printInstallResult(outcome.result, { update: true, dryRun: false, command: "upgrade" });
  return outcome;
}

function buildSyncJsonExtras(outcome) {
  const extras = {
    action: outcome.action,
    wrote: outcome.wrote
  };

  if (!outcome.result) return extras;

  return {
    ...extras,
    driftDetected: outcome.result.driftDetected,
    assetsRepaired: outcome.result.assetsRepaired,
    assetsUnchanged: outcome.result.assetsUnchanged,
    configsRepaired: outcome.result.configsRepaired,
    repairs: outcome.result.repairs ?? []
  };
}

function printStatusReport(report) {
  console.log(commandHeader("status — local AI ecosystem"));
  console.log(`Home: ${report.homeDir}`);
  console.log(`State root: ${report.stateRoot}`);
  console.log(
    report.state
      ? `State: installed (cliVersion=${report.state.cliVersion ?? "unknown"})`
      : "State: missing"
  );
  console.log("");

  console.log("Agents:");
  for (const agent of report.agents) {
    const detected = agent.detected ? "detected" : "not detected";
    const managed = agent.managed ? "managed" : "unmanaged";
    console.log(`  ${agent.id.padEnd(10)} ${detected.padEnd(13)} ${managed}`);
  }

  console.log("");
  console.log("Components:");
  if (report.components.length === 0) {
    console.log("  none");
  } else {
    for (const component of report.components) {
      console.log(
        `  ${component.id.padEnd(14)} ${String(component.version).padEnd(8)} ${component.status}`
      );
    }
  }

  console.log("");
  console.log("Policy:");
  console.log(`  Source: ${formatPolicySourceLabel(report.policy)}`);
  console.log(`  Profile: ${formatPolicyProfileLabel(report.policy.profile)}`);
  console.log(`  Apply mode: ${report.policy.applyMode}`);
  console.log(`  Preflight: ${report.policy.preflight ? "enabled" : "disabled"}`);
  console.log(`  Agents: ${report.policy.agents}`);
  console.log(`  Components: ${report.policy.components.join(", ") || "none"}`);
  console.log("");
  console.log(`Checks: ok=${report.counts.ok} missing=${report.counts.missing} stale=${report.counts.stale} warning=${report.counts.warning}`);
  console.log(`Backups: ${report.backups} snapshot(s)`);
  console.log(`Overall: ${report.overall.toUpperCase()}`);
  console.log(`Next: ${report.nextAction}`);
}

function printSyncRepairSummary(result, { dryRun = false } = {}) {
  console.log(dryRun ? "Planned repairs:" : "Applied repairs:");
  console.log(`  Drift detected: ${result.driftDetected ? "yes" : "no"}`);
  console.log(`  Assets repaired: ${result.assetsRepaired.length}`);
  console.log(`  Assets unchanged: ${result.assetsUnchanged.length}`);
  console.log(`  Sections repaired: ${result.configsRepaired.length}`);
  console.log(`${dryRun ? "Backups planned" : "Backups"}: ${result.backups.length}`);

  if (dryRun && result.repairs?.length) {
    for (const repair of result.repairs) {
      console.log(`  - [${repair.status.toUpperCase()}] ${repair.name}`);
    }
  }

  if (dryRun) {
    console.log("Dry run: nothing was written.");
  }
}

function printInstallResult(result, { update = false, dryRun = false, command = null } = {}) {
  const verb = update ? "update" : (command === "setup" ? "setup" : "install");
  const pastLabel = update ? "updated" : (command === "setup" ? "configured" : "installed");
  console.log(`${BRAND.displayName} global ${dryRun ? `${verb} plan` : pastLabel} (scope: agent-global)`);
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
  console.log(`${dryRun ? "Backups planned" : "Backups"}: ${result.backups.length}`);

  if (dryRun) {
    if (result.repairs?.length) {
      console.log(`Planned repairs: ${result.repairs.length}`);
      for (const repair of result.repairs) {
        console.log(`  - [${repair.status.toUpperCase()}] ${repair.name}`);
      }
    }
    console.log("Dry run: nothing was written.");
    return;
  }

  console.log(`State tracked in ~/.harness/state.json. Run "${formatCliCommand("status")}" or "${formatCliCommand("doctor")}" to verify.`);
}

export async function runGlobalUninstall(options, packageManifest) {
  const homeDir = resolveHomeDir();
  const result = await uninstallGlobalHarness({
    homeDir,
    dryRun: options.dryRun
  });

  await recordUninstallHistory(homeDir, {
    cliVersion: packageManifest?.version ?? null,
    options,
    result
  });

  console.log(`${BRAND.displayName} global ${options.dryRun ? "uninstall plan" : "uninstalled"} (scope: agent-global)`);
  console.log(`Configs cleaned: ${result.configsCleaned.join(", ") || "none"}`);
  console.log(`Backups: ${result.backups.length}`);
  console.log(`State removed: ${result.stateRemoved ? "yes" : "no state found"}`);
  console.log("Backups under ~/.harness/backups were preserved.");
}

export async function runGlobalDoctor(packageRoot, {
  workspaceRoot = process.cwd(),
  json = false,
  cliVersion = null
} = {}) {
  const homeDir = resolveHomeDir();

  if (json) {
    const report = await buildStatusReport(homeDir, { packageRoot, workspaceRoot });
    printJson(buildControlPlaneJson(report, { cliVersion }));
    if (!report.ok) process.exitCode = 1;
    return report;
  }

  const { checks, ok, hasDrift, componentHealth } = await runGlobalDoctorChecks(homeDir, { packageRoot, workspaceRoot });

  console.log(`${BRAND.displayName} doctor (scope: agent-global)`);
  console.log(`Home: ${homeDir}`);
  console.log("");

  for (const check of checks) {
    const label = check.status.toUpperCase().padEnd(8);
    const detail = check.detail ? ` — ${check.detail}` : "";
    console.log(`[${label}] ${check.name}${detail}`);
  }

  if (componentHealth.length > 0) {
    console.log("");
    console.log("Components:");
    for (const entry of componentHealth) {
      console.log(`  ${entry.id.padEnd(16)} ${entry.status}`);
    }
  }

  console.log("");
  if (ok) {
    console.log("Status: OK");
  } else if (hasDrift) {
    console.log(`Status: DRIFT DETECTED — run "${formatCliCommand("sync")}" to auto-repair managed content`);
  } else {
    console.log("Status: FAILED (missing managed state or configs)");
  }

  if (!ok) process.exitCode = 1;
}

export async function runGlobalAdapters({ json = false, cliVersion = null } = {}) {
  const homeDir = resolveHomeDir();
  const report = await buildAdapterMatrixReport(homeDir);

  if (json) {
    printJson({
      adapters: report.adapters,
      managedCount: report.managedCount,
      detectedCount: report.detectedCount,
      supportedCount: report.supportedCount,
      cliVersion
    });
    return report;
  }

  printAdapterMatrixReport(report);
  return report;
}

export async function runGlobalExplain({ json = false, cliVersion = null } = {}) {
  const homeDir = resolveHomeDir();
  const report = await buildExplainReport(homeDir);

  if (json) {
    printJson(buildExplainJson(report, { cliVersion }));
    return report;
  }

  printExplainReport(report);
  return report;
}

function printExplainReport(report) {
  console.log(commandHeader("explain — managed ecosystem audit (read-only)"));
  console.log(`Home: ${report.homeDir}`);
  console.log(`State root: ${report.stateRoot}`);
  console.log("");

  console.log("Managed markers:");
  console.log(`  start: ${report.markers.start}`);
  console.log(`  end:   ${report.markers.end}`);
  console.log("");

  console.log("Policy:");
  console.log(`  Source: ${formatPolicySourceLabel(report.policy)}`);
  console.log(`  Profile: ${formatPolicyProfileLabel(report.policy.profile)}`);
  console.log(`  Apply mode: ${report.policy.applyMode}`);
  console.log(`  Preflight: ${report.policy.preflight ? "enabled" : "disabled"}`);
  console.log(`  Agents: ${report.policy.agents}`);
  console.log(`  Components: ${report.policy.components.join(", ") || "none"}`);
  console.log(`  File: ${report.policy.path}`);
  console.log("");

  console.log("Adapters:");
  for (const adapter of report.adapters) {
    const detected = adapter.detected ? "detected" : "not detected";
    const managed = adapter.managed ? "managed" : "unmanaged";
    console.log(`  ${adapter.id.padEnd(10)} ${detected.padEnd(13)} ${managed}`);
  }

  console.log("");
  console.log(`${BRAND.displayName} writes to:`);
  for (const target of report.writesTo) {
    console.log(`  - ~/${target.replace(/^\//, "")}`);
  }

  console.log("");
  console.log("Config files:");
  if (report.configFiles.length === 0) {
    console.log("  none (run setup to configure managed sections)");
  } else {
    for (const file of report.configFiles) {
      const managedLabel = file.managed ? "managed" : "unmanaged";
      const sectionLabel = file.hasManagedSection ? "has managed section" : "no managed section";
      console.log(`  ${file.path} — ${managedLabel}, ${sectionLabel}`);

      if (file.hasPreservedUserContent) {
        console.log("    user-owned preserved: yes");
      } else if (file.exists && file.hasManagedSection) {
        console.log("    user-owned preserved: no (managed markers only)");
      }
    }
  }

  console.log("");
  console.log("Components:");
  if (report.components.length === 0) {
    console.log("  none");
  } else {
    for (const component of report.components) {
      console.log(
        `  ${component.id.padEnd(14)} ${String(component.version).padEnd(8)} ${component.source} -> ~/.harness/${component.assetDir}`
      );
    }
  }

  console.log("");
  console.log("Backups:");
  if (report.backups.length === 0) {
    console.log("  none");
  } else {
    for (const snapshot of report.backups) {
      console.log(`  - ${snapshot.name} (${snapshot.fileCount} file${snapshot.fileCount === 1 ? "" : "s"})`);
    }
  }

  console.log("");
  console.log(`Next: ${report.nextAction}`);
}

export async function runGlobalReport({
  packageManifest,
  packageRoot,
  json = false,
  workspaceRoot = process.cwd(),
  historyLimit = null,
  outPath = null
} = {}) {
  const homeDir = resolveHomeDir();
  const limit = historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const report = await buildDiagnosticsReport(homeDir, {
    packageRoot,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    workspaceRoot,
    historyLimit: limit
  });

  if (json) {
    const payload = buildReportJson(report);
    if (outPath) {
      await writeReportFile(outPath, `${JSON.stringify(payload)}\n`);
      console.log(`Diagnostics report written to: ${outPath}`);
    } else {
      printJson(payload);
    }
    if (!report.ok) process.exitCode = 1;
    return report;
  }

  const text = formatDiagnosticsReport(report);
  if (outPath) {
    await writeReportFile(outPath, text);
    console.log(`Diagnostics report written to: ${outPath}`);
  } else {
    console.log(text);
  }

  if (!report.ok) process.exitCode = 1;
  return report;
}

function formatDiagnosticsReport(report) {
  const lines = [];

  lines.push(commandHeader("report — local diagnostics (read-only)"));
  lines.push(`CLI version: ${report.cliVersion}`);
  lines.push(`Home: ${report.homeDir}`);
  lines.push("");

  lines.push("Adapters:");
  lines.push(
    `  Supported: ${report.adapters.supportedCount}  Detected: ${report.adapters.detectedCount}  Managed: ${report.adapters.managedCount}`
  );
  for (const adapter of report.adapters.adapters) {
    const detected = adapter.detected ? "detected" : "not detected";
    const managed = adapter.managed ? "managed" : "unmanaged";
    lines.push(`  ${adapter.id.padEnd(10)} ${detected.padEnd(13)} ${managed}`);
  }
  lines.push("");

  lines.push("Policy:");
  lines.push(`  Source: ${formatPolicySourceLabel(report.policy)}`);
  lines.push(`  Profile: ${formatPolicyProfileLabel(report.policy.profile)}`);
  lines.push(`  Apply mode: ${report.policy.applyMode}`);
  lines.push(`  Preflight: ${report.policy.preflight ? "enabled" : "disabled"}`);
  lines.push(`  Agents: ${report.policy.agents}`);
  lines.push(`  Components: ${report.policy.components.join(", ") || "none"}`);
  lines.push("");

  lines.push("Status:");
  lines.push(`  Overall: ${report.status.overall.toUpperCase()}`);
  lines.push(
    report.status.installed
      ? `  State: installed (cliVersion=${report.status.stateCliVersion ?? "unknown"})`
      : "  State: missing"
  );
  lines.push(
    `  Checks: ok=${report.status.counts.ok} missing=${report.status.counts.missing} stale=${report.status.counts.stale} warning=${report.status.counts.warning}`
  );
  lines.push(`  Backups: ${report.status.backups} snapshot(s)`);
  lines.push(`  Next: ${report.status.nextAction}`);
  lines.push("");

  lines.push("Diff:");
  lines.push(`  Summary: ${report.diff.summary}`);
  if (report.diff.hasChanges) {
    lines.push(`  Planned changes: ${report.diff.changeCount}`);
    for (const change of report.diff.changes) {
      lines.push(`    [${change.status}] ${change.kind} ${change.action} -> ${change.target}`);
    }
  } else {
    lines.push("  Drift: none");
  }
  lines.push(`  Next: ${report.diff.nextAction}`);
  lines.push("");

  lines.push(`History (last ${report.history.limit} events):`);
  lines.push(`  File: ${report.history.path}`);
  for (const warning of report.history.warnings) {
    lines.push(`  Warning: skipped invalid history line ${warning.line}: ${warning.message}`);
  }
  if (report.history.events.length === 0) {
    lines.push("  No managed operations recorded yet.");
  } else {
    for (const event of report.history.events) {
      lines.push(`  ${formatHistoryEvent(event)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function runGlobalDiff({
  packageManifest,
  packageRoot,
  json = false,
  workspaceRoot = process.cwd()
} = {}) {
  const homeDir = resolveHomeDir();
  const report = await buildDiffReport(homeDir, {
    packageRoot,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    workspaceRoot
  });

  if (json) {
    printJson(buildDiffJson(report, { cliVersion: packageManifest.version }));
    return report;
  }

  printDiffReport(report);
  return report;
}

function printDiffReport(report) {
  console.log(commandHeader("diff — managed content preview (read-only)"));
  console.log(`Home: ${report.homeDir}`);
  console.log(`Summary: ${report.summary}`);
  console.log("");

  if (!report.installed) {
    console.log(`Next: ${report.nextAction}`);
    return;
  }

  if (!report.hasChanges) {
    console.log("Managed changes: none");
    console.log("");
    if (report.preserved.length > 0) {
      console.log("User-owned preserved content:");
      for (const entry of report.preserved) {
        console.log(`  ${entry.path} — intact`);
      }
      console.log("");
    }
    console.log(`Next: ${report.nextAction}`);
    return;
  }

  console.log("Planned managed changes:");
  for (const change of report.changes) {
    console.log(
      `  [${change.status}] ${change.kind} ${change.action} -> ${change.target}`
    );
    console.log(`    ${change.detail}`);
  }

  console.log("");
  if (report.preserved.length > 0) {
    console.log("User-owned preserved content (outside managed markers):");
    for (const entry of report.preserved) {
      console.log(`  ${entry.path} — intact`);
    }
    console.log("");
  } else {
    console.log("User-owned preserved content: none detected in affected configs.");
    console.log("");
  }

  console.log(`Next: ${report.nextAction}`);
}

function printAdapterMatrixReport(report) {
  console.log(commandHeader("adapters — supported agent integrations"));
  console.log(`Home: ${report.homeDir}`);
  console.log("");
  console.log(`${BRAND.displayName} does not install Cursor, Codex, OpenCode, or Claude Code.`);
  console.log("It configures managed sections in each agent's config files.");
  console.log("");
  console.log(`Supported: ${report.supportedCount}  Detected: ${report.detectedCount}  Managed: ${report.managedCount}`);
  console.log("");

  for (const adapter of report.adapters) {
    const detected = adapter.detected ? "detected" : "not detected";
    const managed = adapter.managed ? "managed" : "unmanaged";
    console.log(`${adapter.id.padEnd(10)} ${adapter.label.padEnd(12)} ${detected.padEnd(13)} ${managed}`);
    console.log(`  root:    ~/${adapter.rootDir}`);
    console.log(`  config:  ~/${adapter.configFile}`);
    console.log(`  targets: ${adapter.managedTargets.join(", ")}`);
    console.log("");
  }
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

  console.log(commandHeader("components (scope: agent-global)"));
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
  console.log(`  Kind: ${component.kind ?? "component"}`);
  console.log(`  Assets: ${component.assetFiles.join(", ")}`);
  if ((component.dependencies ?? []).length > 0) {
    console.log(`  Dependencies: ${component.dependencies.join(", ")}`);
  }
  if ((component.healthChecks ?? []).length > 0) {
    console.log(`  Health checks: ${component.healthChecks.map((check) => check.id).join(", ")}`);
  }

  if (component.instructions) {
    console.log(`  Instructions: ${component.instructions}`);
  }

  if (component.adapterHints.length > 0) {
    console.log(`  Adapter hints: ${component.adapterHints.join(", ")}`);
  }
}

export function runComponentsValidate({ workspaceRoot = process.cwd() } = {}) {
  const result = validateWorkspaceComponentsCatalog(workspaceRoot);

  console.log("Workspace component catalog is valid");
  console.log(`Catalog: .harness/components/catalog.json`);
  console.log(`Components: ${result.components.length}`);

  for (const component of result.components) {
    console.log(`- ${component.id} (${component.version}) — ${component.assetFiles.join(", ")}`);
  }
}

export async function runComponentsInit(options) {
  const result = await initWorkspaceComponent({
    workspaceRoot: options.cwd,
    id: options.componentId,
    label: options.label
  });

  console.log("Workspace component created");
  console.log(`Id: ${result.entry.id}`);
  console.log(`Label: ${result.entry.label}`);
  console.log(`Version: ${result.entry.version}`);
  console.log(`Catalog: .harness/components/catalog.json`);
  console.log(`Asset: .harness/components/${result.entry.id}/README.md`);
  console.log("");
  console.log("Next:");
  console.log(`  1. Edit .harness/components/${result.entry.id}/README.md`);
  console.log(`  2. ${formatCliCommand("components validate")}`);
  console.log(`  3. ${formatCliCommand(`install --components ${result.entry.id}`)}`);
}

export async function runComponentsPack(options) {
  const result = await packWorkspaceComponent({
    workspaceRoot: options.cwd,
    id: options.componentId,
    outPath: options.outPath
  });

  console.log("Workspace component packed");
  console.log(`Id: ${result.entry.id}`);
  console.log(`Version: ${result.entry.version}`);
  console.log(`Bundle: ${result.outPath}`);
  console.log(`Assets: ${result.entry.assetFiles.join(", ")}`);
}

export async function runComponentsImport(options) {
  const result = await importWorkspaceComponent({
    workspaceRoot: options.cwd,
    bundlePath: options.bundlePath
  });

  console.log("Workspace component imported");
  console.log(`Id: ${result.entry.id}`);
  console.log(`Label: ${result.entry.label}`);
  console.log(`Version: ${result.entry.version}`);
  console.log(`Catalog: .harness/components/catalog.json`);
  console.log(`Assets: ${result.entry.assetFiles.map((asset) => `.harness/components/${result.entry.id}/${asset}`).join(", ")}`);
  console.log("");
  console.log("Next:");
  console.log(`  1. ${formatCliCommand("components validate")}`);
  console.log(`  2. ${formatCliCommand(`install --components ${result.entry.id}`)}`);
}

export async function runGlobalBackups() {
  const homeDir = resolveHomeDir();
  const { backupsDir } = harnessHomePaths(homeDir);
  const snapshots = await describeBackupSnapshots(backupsDir);

  console.log(commandHeader("backups"));
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

export async function runGlobalHistory(options, packageManifest) {
  const homeDir = resolveHomeDir();
  const historyPath = getHistoryPath(homeDir);
  const query = {
    command: options.historyCommand ?? null,
    action: options.historyEventAction ?? null,
    limit: options.limit
  };

  if (options.historyAction === "last") {
    const { event, warnings } = await readLastHistoryEvent(homeDir, query);
    printHistoryWarnings(warnings);

    if (options.json) {
      printJson({
        path: historyPath,
        event,
        warnings,
        cliVersion: packageManifest?.version ?? null
      });
      return { event, warnings };
    }

    console.log(commandHeader("history last — most recent managed operation"));
    console.log(`Home: ${homeDir}`);
    console.log(`File: ${historyPath}`);
    printHistoryFiltersLabel(query);

    if (!event) {
      console.log("No managed operations recorded yet.");
      return { event: null, warnings };
    }

    console.log("");
    console.log(formatHistoryEvent(event));
    printHistoryEventDetails(event);
    return { event, warnings };
  }

  const { events, warnings } = await readHistoryEvents(homeDir, query);
  printHistoryWarnings(warnings);

  if (options.json) {
    printJson({
      path: historyPath,
      events,
      warnings,
      filters: buildHistoryFiltersJson(query),
      cliVersion: packageManifest?.version ?? null
    });
    return { events, warnings };
  }

  console.log(commandHeader("history — local operation audit log"));
  console.log(`Home: ${homeDir}`);
  console.log(`File: ${historyPath}`);
  console.log(`Events: ${events.length}`);
  printHistoryFiltersLabel(query);

  if (events.length === 0) {
    console.log("No managed operations recorded yet.");
    return { events, warnings };
  }

  console.log("");
  for (const event of events) {
    console.log(formatHistoryEvent(event));
  }

  return { events, warnings };
}

function printHistoryWarnings(warnings) {
  for (const warning of warnings) {
    console.warn(`Warning: skipped invalid history line ${warning.line}: ${warning.message}`);
  }
}

function buildHistoryFiltersJson({ command, action, limit }) {
  const filters = {};
  if (command) filters.command = command;
  if (action) filters.action = action;
  if (limit != null) filters.limit = limit;
  return Object.keys(filters).length > 0 ? filters : null;
}

function printHistoryFiltersLabel({ command, action, limit }) {
  const parts = [];
  if (command) parts.push(`command=${command}`);
  if (action) parts.push(`action=${action}`);
  if (limit != null) parts.push(`limit=${limit}`);
  if (parts.length > 0) {
    console.log(`Filters: ${parts.join(", ")}`);
  }
}

function printHistoryEventDetails(event) {
  console.log(`  wrote: ${event.wrote ? "yes" : "no"}`);
  console.log(`  cliVersion: ${event.cliVersion ?? "unknown"}`);

  if (event.consentSource) {
    console.log(`  consent: ${event.consentSource}`);
  }

  if (Array.isArray(event.backupsCreated) && event.backupsCreated.length > 0) {
    console.log(`  backups: ${event.backupsCreated.join(", ")}`);
  }

  if (Array.isArray(event.snapshotsUsed) && event.snapshotsUsed.length > 0) {
    console.log(`  snapshots: ${event.snapshotsUsed.join(", ")}`);
  }
}

export async function runGlobalRollback(options, packageManifest) {
  if (!options.snapshot) {
    throw new Error(`Missing snapshot. Use: ${formatCliCommand("rollback --to <snapshot>")}`);
  }

  const homeDir = resolveHomeDir();

  if (options.apply) {
    const result = await applyRollback({ homeDir, snapshot: options.snapshot });

    await recordRollbackHistory(homeDir, {
      cliVersion: packageManifest?.version ?? null,
      snapshot: options.snapshot,
      result
    });

    console.log(commandHeader("rollback applied"));
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

  console.log(commandHeader("rollback preview"));
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

export async function runGlobalPolicy(options, packageManifest) {
  const homeDir = resolveHomeDir();

  switch (options.policyAction) {
    case "show": {
      const rawPolicy = await loadPolicyFile(homeDir);

      if (options.json) {
        printJson(buildPolicyJson(homeDir, rawPolicy));
        return;
      }

      printPolicyReport(homeDir, rawPolicy);
      return;
    }
    case "set": {
      const resolved = await savePolicyField(homeDir, options.policyKey, options.policyValue);

      await recordPolicyHistory(homeDir, {
        cliVersion: packageManifest?.version ?? null,
        action: "set"
      });

      if (options.json) {
        printJson({
          ok: true,
          action: "set",
          key: options.policyKey,
          value: resolved[options.policyKey],
          policy: buildPolicyJson(homeDir, await loadPolicyFile(homeDir))
        });
        return;
      }

      console.log(`Policy updated: ${options.policyKey}=${formatPolicyValue(resolved[options.policyKey])}`);
      printPolicyReport(homeDir, await loadPolicyFile(homeDir));
      return;
    }
    case "reset": {
      const removed = await resetPolicyFile(homeDir);

      if (removed) {
        await recordPolicyHistory(homeDir, {
          cliVersion: packageManifest?.version ?? null,
          action: "reset"
        });
      }

      if (options.json) {
        printJson({
          ok: true,
          action: "reset",
          removed,
          policy: buildPolicyJson(homeDir, null)
        });
        return;
      }

      console.log(removed ? "Policy reset. Using CLI defaults." : "No policy file found.");
      if (removed) {
        printPolicyReport(homeDir, null);
      }
      return;
    }
    default: {
      const _exhaustive = options.policyAction;
      throw new Error(`Unknown policy action "${_exhaustive}".`);
    }
  }
}

function printPolicyReport(homeDir, rawPolicy) {
  const resolved = resolvePolicy(rawPolicy ?? {});
  const policyPath = harnessHomePaths(homeDir).policyPath;

  console.log(commandHeader("policy — local operation preferences"));
  console.log(`Home: ${homeDir}`);
  console.log(`File: ${rawPolicy ? policyPath : "(none — using CLI defaults)"}`);
  console.log("");

  if (resolved.profile) {
    console.log(`Profile: ${resolved.profile}`);
  }

  console.log(`Apply mode: ${resolved.applyMode}`);
  console.log(`Preflight: ${resolved.preflight ? "enabled" : "disabled"}`);
  console.log(`Agents: ${formatPolicyAgents(resolved.agents)}`);
  console.log(`Components: ${resolved.components.join(", ") || "none"}`);
  console.log("");
  console.log("Precedence: CLI flags > policy file > internal defaults.");
  console.log(`Commands: ${formatCliCommand("policy set <key> <value>")} | ${formatCliCommand("policy reset")}`);
}

function formatPolicyAgents(agents) {
  if (agents === "detected") return "detected";
  if (agents === "all") return "all";
  return agents.join(", ");
}

function formatPolicyValue(value) {
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}
