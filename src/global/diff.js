import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { updateGlobalHarness } from "./global-installer.js";
import { needsManagedRepair } from "./governance-repair.js";
import { harnessHomePaths } from "./paths.js";
import { readGlobalState } from "./state.js";
import { buildStatusReport } from "./status.js";
import { userOwnedContent } from "./managed-section.js";
import { formatCliCommand } from "./brand/cli.js";

export async function buildDiffReport(homeDir, {
  packageRoot,
  packageName,
  cliVersion,
  workspaceRoot = null
}) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);

  if (!state) {
    return {
      homeDir,
      installed: false,
      status: "setup-required",
      hasChanges: false,
      summary: "No managed state found.",
      nextAction: `Run "${formatCliCommand("setup --dry-run")}" to preview the initial managed plan.`,
      changes: [],
      preserved: []
    };
  }

  const statusReport = await buildStatusReport(homeDir, { packageRoot, workspaceRoot });
  if (!needsManagedRepair(statusReport)) {
    return {
      homeDir,
      installed: true,
      status: "clean",
      hasChanges: false,
      summary: "No managed changes.",
      nextAction: "Ecosystem in sync. No managed changes would be applied.",
      changes: [],
      preserved: await collectPreservedContent(homeDir, state)
    };
  }

  const plan = await updateGlobalHarness({
    packageRoot,
    packageName,
    cliVersion,
    homeDir,
    workspaceRoot,
    dryRun: true
  });

  const changes = buildChangesFromPlan(plan);
  const preserved = await collectPreservedForChanges(homeDir, plan);

  return {
    homeDir,
    installed: true,
    status: "drift",
    hasChanges: true,
    summary: `${changes.length} managed change(s) planned.`,
    nextAction: `Run "${formatCliCommand("sync")}" to apply these managed repairs.`,
    changes,
    preserved
  };
}

export async function summarizeInstallPreflight(homeDir, plan) {
  const changes = buildChangesFromPlan({ ...plan, repairs: plan.repairs ?? [] });

  for (const coreFile of plan.coreFiles ?? []) {
    if (changes.some((change) => change.target === coreFile)) continue;
    changes.push({
      kind: "component_asset",
      action: "create",
      target: coreFile,
      status: "planned",
      detail: `Component asset would be written to ~/.harness/${coreFile}.`
    });
  }

  const preserved = await collectPreservedForChanges(homeDir, plan);

  return {
    summary: changes.length > 0
      ? `${changes.length} managed change(s) planned.`
      : "No managed changes planned.",
    changes,
    preserved
  };
}

export function buildChangesFromPlan(plan) {
  const changes = [];

  for (const repair of plan.repairs ?? []) {
    changes.push({
      kind: repair.category,
      action: repairAction(repair),
      target: repairTarget(repair),
      status: repair.status,
      detail: repair.detail
    });
  }

  for (const configFile of plan.configsCreated ?? []) {
    if (changes.some((change) => change.target === configFile)) continue;
    changes.push({
      kind: "config",
      action: "create",
      target: configFile,
      status: "planned",
      detail: `Managed config would be created at ~/${configFile}.`
    });
  }

  for (const configFile of plan.configsUpdated ?? []) {
    if (changes.some((change) => change.target === configFile)) continue;
    changes.push({
      kind: "config",
      action: "update",
      target: configFile,
      status: "planned",
      detail: `Managed config would be updated at ~/${configFile}.`
    });
  }

  for (const configFile of plan.configsRepaired ?? []) {
    if (changes.some((change) => change.target === configFile)) continue;
    changes.push({
      kind: "config",
      action: "repair",
      target: configFile,
      status: "planned",
      detail: `Managed section would be repaired at ~/${configFile}.`
    });
  }

  return changes;
}

function repairAction(repair) {
  if (repair.status === "missing") {
    return repair.category === "managed_section" ? "create" : "repair";
  }

  if (repair.status === "stale") {
    return repair.category === "managed_section" || repair.category === "component_section"
      ? "replace"
      : "repair";
  }

  return "repair";
}

function repairTarget(repair) {
  if (repair.category === "component_asset") {
    return repair.name.replace(/^~\//, "");
  }

  return repair.configFile ?? repair.name;
}

async function collectPreservedContent(homeDir, state) {
  const preserved = [];
  const configFiles = new Set(
    (state.adapters ?? []).map((adapter) => adapter.configFile)
  );

  for (const configFile of configFiles) {
    const entry = await readPreservedEntry(homeDir, configFile);
    if (entry) preserved.push(entry);
  }

  return preserved;
}

async function collectPreservedForChanges(homeDir, plan) {
  const configFiles = new Set([
    ...(plan.configsCreated ?? []),
    ...(plan.configsUpdated ?? []),
    ...(plan.configsRepaired ?? []),
    ...(plan.repairs ?? [])
      .filter((repair) => repair.configFile)
      .map((repair) => repair.configFile)
  ]);

  const preserved = [];

  for (const configFile of configFiles) {
    const entry = await readPreservedEntry(homeDir, configFile);
    if (entry) preserved.push(entry);
  }

  return preserved;
}

async function readPreservedEntry(homeDir, configFile) {
  const configPath = join(homeDir, configFile);
  if (!existsSync(configPath)) return null;

  const content = await readFile(configPath, "utf8");
  const preserved = userOwnedContent(content).trim();

  if (preserved.length === 0) return null;

  return {
    path: configFile,
    preservedUserContent: preserved,
    intact: true
  };
}

export function buildDiffJson(report, { cliVersion = null } = {}) {
  return {
    ok: true,
    installed: report.installed,
    status: report.status,
    hasChanges: report.hasChanges,
    cliVersion,
    summary: report.summary,
    nextAction: report.nextAction,
    changes: report.changes,
    preserved: report.preserved
  };
}
