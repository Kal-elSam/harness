import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { hashBuffer } from "../hash.js";
import { buildAdapterContext } from "./adapter-context.js";
import { backupTimestamp } from "./backups.js";
import { harnessHomePaths } from "./paths.js";
import {
  buildAdapterStateEntry,
  detectInstalledAdapters,
  resolveAdapter,
  resolveTargetAdapters
} from "./registry.js";
import { createGlobalState, readGlobalState, writeGlobalState } from "./state.js";
import { getInstalledAdapterIds, normalizeGlobalState } from "./state-migration.js";

export async function installGlobalHarness({ packageRoot, packageName, cliVersion, homeDir, agents = null, dryRun = false }) {
  const paths = harnessHomePaths(homeDir);
  const timestamp = backupTimestamp();
  const context = buildAdapterContext({ homeDir, packageName, coreDir: paths.coreDir, dryRun, timestamp });
  const targetAdapters = resolveTargetAdapters(context, agents);
  const result = {
    scope: "agent-global",
    homeDir,
    stateRoot: paths.root,
    agents: targetAdapters.map((adapter) => adapter.id),
    coreFiles: [],
    configsCreated: [],
    configsUpdated: [],
    configsUnchanged: [],
    backups: []
  };

  const coreFiles = await installCoreFiles({ packageRoot, paths, dryRun, result });

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

    await writeGlobalState(paths.statePath, createGlobalState({
      packageName,
      cliVersion,
      adapters: adapterEntries,
      coreFiles,
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

  const agents = options.agents ?? getInstalledAdapterIds(state);
  return installGlobalHarness({ ...options, agents });
}

export async function uninstallGlobalHarness({ homeDir, dryRun = false }) {
  const paths = harnessHomePaths(homeDir);
  const rawState = await readGlobalState(paths.statePath);
  const state = normalizeGlobalState(rawState);
  const timestamp = backupTimestamp();
  const context = buildAdapterContext({ homeDir, packageName: "", coreDir: paths.coreDir, dryRun, timestamp });
  const adapterIds = state?.adapters?.map((entry) => entry.id)
    ?? detectInstalledAdapters(context);
  const result = { scope: "agent-global", agents: adapterIds, configsCleaned: [], backups: [], stateRemoved: false };

  for (const adapterId of adapterIds) {
    const adapter = resolveAdapter(adapterId);
    const stateEntry = state?.adapters?.find((entry) => entry.id === adapterId);
    const removed = await adapter.uninstall(context, stateEntry);

    if (removed.backupPath) result.backups.push(removed.backupPath);
    if (removed.cleaned) result.configsCleaned.push(removed.configFile);
  }

  if (state && !dryRun) {
    await rm(paths.statePath, { force: true });
    await rm(paths.coreDir, { recursive: true, force: true });
  }

  result.stateRemoved = Boolean(state);
  return result;
}

async function installCoreFiles({ packageRoot, paths, dryRun, result }) {
  const templateCoreDir = resolve(packageRoot, "global-template", "core");
  const entries = existsSync(templateCoreDir) ? await readdir(templateCoreDir) : [];
  const coreFiles = {};

  for (const entry of entries) {
    const sourcePath = join(templateCoreDir, entry);
    const destinationPath = join(paths.coreDir, entry);
    const content = await readFile(sourcePath);

    if (!dryRun) {
      await mkdir(dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, content);
    }

    coreFiles[`core/${entry}`] = hashBuffer(content);
    result.coreFiles.push(`core/${entry}`);
  }

  return coreFiles;
}
