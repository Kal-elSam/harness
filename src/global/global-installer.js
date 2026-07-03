import { rm } from "node:fs/promises";
import { join } from "node:path";
import { buildAdapterContext } from "./adapter-context.js";
import { backupTimestamp } from "./backups.js";
import { buildComponentStateEntries, resolveTargetComponents } from "./component-registry.js";
import { installComponentAssets, repairComponentAssets } from "./component-installer.js";
import { detectGlobalDrift, hasRepairableDrift } from "./drift.js";
import { harnessHomePaths } from "./paths.js";
import {
  buildAdapterStateEntry,
  detectInstalledAdapters,
  resolveAdapter,
  resolveTargetAdapters
} from "./registry.js";
import { createGlobalState, readGlobalState, writeGlobalState } from "./state.js";
import {
  getInstalledAdapterIds,
  getInstalledComponentIds,
  normalizeGlobalState
} from "./state-migration.js";

export async function installGlobalHarness({
  packageRoot,
  packageName,
  cliVersion,
  homeDir,
  workspaceRoot = null,
  agents = null,
  components = null,
  noDefaultComponents = false,
  dryRun = false
}) {
  const paths = harnessHomePaths(homeDir);
  const timestamp = backupTimestamp();
  const targetComponents = resolveTargetComponents({ components, noDefaultComponents, workspaceRoot });
  const context = buildAdapterContext({
    homeDir,
    packageName,
    packageRoot,
    workspaceRoot,
    components: targetComponents,
    dryRun,
    timestamp
  });
  const targetAdapters = resolveTargetAdapters(context, agents);
  const result = {
    scope: "agent-global",
    homeDir,
    stateRoot: paths.root,
    agents: targetAdapters.map((adapter) => adapter.id),
    components: targetComponents.map((component) => component.id),
    coreFiles: [],
    assetsRepaired: [],
    assetsUnchanged: [],
    configsCreated: [],
    configsUpdated: [],
    configsRepaired: [],
    configsUnchanged: [],
    backups: [],
    driftDetected: false
  };

  const componentFiles = await installComponentAssets({
    packageRoot,
    workspaceRoot,
    paths,
    components: targetComponents,
    dryRun
  });
  result.coreFiles.push(...Object.keys(componentFiles));
  result.assetsRepaired.push(...Object.keys(componentFiles));

  await applyAdapterPlans({ context, targetAdapters, result });

  if (!dryRun) {
    await persistGlobalState({
      paths,
      packageName,
      cliVersion,
      targetAdapters,
      targetComponents,
      homeDir,
      componentFiles,
      backups: result.backups
    });
  }

  return result;
}

export async function updateGlobalHarness(options) {
  const paths = harnessHomePaths(options.homeDir);
  const state = await readGlobalState(paths.statePath);

  if (!state) {
    throw new Error('No global state found at ~/.harness/state.json. Run "harness install" first.');
  }

  return syncGlobalHarness({
    ...options,
    agents: options.agents ?? getInstalledAdapterIds(state),
    components: options.components ?? getInstalledComponentIds(state)
  });
}

export async function syncGlobalHarness({
  packageRoot,
  packageName,
  cliVersion,
  homeDir,
  workspaceRoot = null,
  agents,
  components,
  dryRun = false
}) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);
  const timestamp = backupTimestamp();
  const targetComponents = resolveTargetComponents({ components, workspaceRoot });
  const context = buildAdapterContext({
    homeDir,
    packageName: packageName ?? state.packageName,
    packageRoot,
    workspaceRoot,
    components: targetComponents,
    dryRun,
    timestamp
  });
  const targetAdapters = resolveTargetAdapters(context, agents);
  const driftChecks = await detectGlobalDrift({ homeDir, paths, state, packageRoot, workspaceRoot, context });
  const result = {
    scope: "agent-global",
    homeDir,
    stateRoot: paths.root,
    agents: targetAdapters.map((adapter) => adapter.id),
    components: targetComponents.map((component) => component.id),
    coreFiles: [],
    assetsRepaired: [],
    assetsUnchanged: [],
    configsCreated: [],
    configsUpdated: [],
    configsRepaired: [],
    configsUnchanged: [],
    backups: [],
    driftDetected: hasRepairableDrift(driftChecks),
    repairs: driftChecks.filter((check) => check.status === "missing" || check.status === "stale")
  };

  const { coreFiles, repaired, unchanged } = await repairComponentAssets({
    packageRoot,
    workspaceRoot,
    paths,
    components: targetComponents,
    state,
    dryRun
  });
  result.coreFiles = Object.keys(coreFiles);
  result.assetsRepaired = repaired;
  result.assetsUnchanged = unchanged;

  const driftedConfigs = new Set(
    driftChecks
      .filter((check) =>
        (check.category === "managed_section" || check.category === "component_section")
        && (check.status === "missing" || check.status === "stale")
        && check.configFile)
      .map((check) => check.configFile)
  );

  for (const adapter of targetAdapters) {
    const needsRepair = driftedConfigs.has(adapter.assets.configFile);
    if (!needsRepair) {
      result.configsUnchanged.push(adapter.assets.configFile);
      continue;
    }

    const plan = adapter.plan(context);
    const applied = await adapter.apply(context, plan);

    if (applied.backupPath) result.backups.push(applied.backupPath);
    if (applied.action === "create") result.configsCreated.push(applied.configFile);
    else if (applied.action === "update") result.configsUpdated.push(applied.configFile);
    if (applied.action !== "unchanged") result.configsRepaired.push(applied.configFile);
  }

  if (!dryRun) {
    await persistGlobalState({
      paths,
      packageName: packageName ?? state.packageName,
      cliVersion,
      targetAdapters,
      targetComponents,
      homeDir,
      componentFiles: coreFiles,
      backups: [...(state.backups ?? []), ...result.backups],
      installedAt: state.installedAt
    });
  }

  return result;
}

export async function uninstallGlobalHarness({ homeDir, dryRun = false }) {
  const paths = harnessHomePaths(homeDir);
  const rawState = await readGlobalState(paths.statePath);
  const state = normalizeGlobalState(rawState);
  const timestamp = backupTimestamp();
  const installedComponents = state?.components?.map((entry) => entry.id) ?? [];
  const context = buildAdapterContext({
    homeDir,
    packageName: state?.packageName ?? "",
    components: installedComponents.map((id) => ({ id })),
    dryRun,
    timestamp
  });
  const adapterIds = state?.adapters?.map((entry) => entry.id)
    ?? detectInstalledAdapters(context);
  const result = {
    scope: "agent-global",
    agents: adapterIds,
    components: installedComponents,
    configsCleaned: [],
    backups: [],
    stateRemoved: false
  };

  for (const adapterId of adapterIds) {
    const adapter = resolveAdapter(adapterId);
    const stateEntry = state?.adapters?.find((entry) => entry.id === adapterId);
    const removed = await adapter.uninstall(context, stateEntry);

    if (removed.backupPath) result.backups.push(removed.backupPath);
    if (removed.cleaned) result.configsCleaned.push(removed.configFile);
  }

  if (state && !dryRun) {
    await rm(paths.statePath, { force: true });
    await rm(join(paths.root, "components"), { recursive: true, force: true });
    await rm(paths.coreDir, { recursive: true, force: true });
  }

  result.stateRemoved = Boolean(state);
  return result;
}

async function applyAdapterPlans({ context, targetAdapters, result }) {
  for (const adapter of targetAdapters) {
    const plan = adapter.plan(context);
    const applied = await adapter.apply(context, plan);

    if (applied.backupPath) result.backups.push(applied.backupPath);

    if (applied.action === "create") result.configsCreated.push(applied.configFile);
    else if (applied.action === "update") result.configsUpdated.push(applied.configFile);
    else if (applied.action === "unchanged") result.configsUnchanged.push(applied.configFile);
  }
}

async function persistGlobalState({
  paths,
  packageName,
  cliVersion,
  targetAdapters,
  targetComponents,
  homeDir,
  componentFiles,
  backups,
  installedAt
}) {
  const existingState = installedAt ? { installedAt } : await readGlobalState(paths.statePath);
  const adapterEntries = targetAdapters.map((adapter) => buildAdapterStateEntry(adapter, homeDir));
  const componentEntries = buildComponentStateEntries(targetComponents, targetAdapters);

  await writeGlobalState(paths.statePath, createGlobalState({
    packageName,
    cliVersion,
    adapters: adapterEntries,
    components: componentEntries,
    coreFiles: componentFiles,
    backups,
    installedAt: existingState?.installedAt
  }));
}
