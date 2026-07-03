import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildAdapterContext } from "./adapter-context.js";
import { backupTimestamp } from "./backups.js";
import { buildComponentStateEntries, resolveTargetComponents } from "./component-registry.js";
import { installComponentAssets } from "./component-installer.js";
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
  agents = null,
  components = null,
  noDefaultComponents = false,
  dryRun = false
}) {
  const paths = harnessHomePaths(homeDir);
  const timestamp = backupTimestamp();
  const targetComponents = resolveTargetComponents({ components, noDefaultComponents });
  const context = buildAdapterContext({
    homeDir,
    packageName,
    packageRoot,
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
    configsCreated: [],
    configsUpdated: [],
    configsUnchanged: [],
    backups: []
  };

  const componentFiles = await installComponentAssets({
    packageRoot,
    paths,
    components: targetComponents,
    dryRun
  });
  result.coreFiles.push(...Object.keys(componentFiles));

  for (const adapter of targetAdapters) {
    const plan = adapter.plan(context);
    const applied = await adapter.apply(context, plan);

    if (applied.backupPath) result.backups.push(applied.backupPath);

    if (applied.action === "create") result.configsCreated.push(applied.configFile);
    else if (applied.action === "update") result.configsUpdated.push(applied.configFile);
    else if (applied.action === "unchanged") result.configsUnchanged.push(applied.configFile);
  }

  if (!dryRun) {
    const existingState = await readGlobalState(paths.statePath);
    const adapterEntries = targetAdapters.map((adapter) => buildAdapterStateEntry(adapter, homeDir));
    const componentEntries = buildComponentStateEntries(targetComponents, targetAdapters);

    await writeGlobalState(paths.statePath, createGlobalState({
      packageName,
      cliVersion,
      adapters: adapterEntries,
      components: componentEntries,
      coreFiles: componentFiles,
      backups: [...(existingState?.backups ?? []), ...result.backups],
      installedAt: existingState?.installedAt
    }));
  }

  return result;
}

export async function updateGlobalHarness(options) {
  const paths = harnessHomePaths(options.homeDir);
  const state = await readGlobalState(paths.statePath);

  if (!state) {
    throw new Error('No global state found at ~/.harness/state.json. Run "harness install" first.');
  }

  return installGlobalHarness({
    ...options,
    agents: options.agents ?? getInstalledAdapterIds(state),
    components: options.components ?? getInstalledComponentIds(state),
    noDefaultComponents: options.noDefaultComponents ?? false
  });
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
