import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildAdapterMatrix } from "./adapter-matrix.js";
import { harnessHomePaths } from "./paths.js";
import { readGlobalState } from "./state.js";
import { describeBackupSnapshots } from "./rollback.js";
import {
  SECTION_END,
  SECTION_START,
  hasManagedSection,
  userOwnedContent
} from "./managed-section.js";

export async function buildExplainReport(homeDir) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);
  const adapters = await buildAdapterMatrix(homeDir);
  const backups = await describeBackupSnapshots(paths.backupsDir);
  const markers = {
    start: SECTION_START,
    end: SECTION_END
  };

  if (!state) {
    return {
      homeDir,
      installed: false,
      ok: false,
      nextAction: 'Run "harness setup" to see what Harness manages.',
      markers,
      stateRoot: paths.root,
      writesTo: [paths.root],
      adapters,
      configFiles: [],
      components: [],
      backups
    };
  }

  const configFiles = await analyzeConfigFiles(homeDir, adapters);
  const components = (state.components ?? []).map((entry) => ({
    id: entry.id,
    version: entry.version,
    source: entry.source ?? "bundled",
    assetDir: `components/${entry.id}`
  }));
  const writesTo = buildWritesTo(paths.root, configFiles);

  return {
    homeDir,
    installed: true,
    ok: true,
    nextAction: "Read-only audit. Harness did not modify any files.",
    markers,
    stateRoot: paths.root,
    writesTo,
    adapters,
    configFiles,
    components,
    backups,
    cliVersion: state.cliVersion ?? null
  };
}

async function analyzeConfigFiles(homeDir, adapters) {
  const files = [];

  for (const adapter of adapters) {
    const configPath = join(homeDir, adapter.configFile);
    const exists = existsSync(configPath);

    if (!exists) {
      files.push({
        adapterId: adapter.id,
        path: adapter.configFile,
        exists: false,
        managed: adapter.managed,
        hasManagedSection: false,
        hasPreservedUserContent: false,
        preservedUserContent: null
      });
      continue;
    }

    const content = await readFile(configPath, "utf8");
    const preserved = userOwnedContent(content).trim();

    files.push({
      adapterId: adapter.id,
      path: adapter.configFile,
      exists: true,
      managed: adapter.managed,
      hasManagedSection: hasManagedSection(content),
      hasPreservedUserContent: preserved.length > 0,
      preservedUserContent: preserved.length > 0 ? preserved : null
    });
  }

  return files;
}

function buildWritesTo(stateRoot, configFiles) {
  const targets = [stateRoot];

  for (const file of configFiles) {
    if (file.managed && file.exists) {
      targets.push(file.path);
    }
  }

  return targets;
}

export function buildExplainJson(report, { cliVersion = null } = {}) {
  return {
    ok: report.ok,
    installed: report.installed,
    cliVersion: cliVersion ?? report.cliVersion ?? null,
    nextAction: report.nextAction,
    markers: report.markers,
    stateRoot: report.stateRoot,
    writesTo: report.writesTo,
    adapters: report.adapters.map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      rootDir: adapter.rootDir,
      configFile: adapter.configFile,
      detected: adapter.detected,
      managed: adapter.managed,
      managedTargets: adapter.managedTargets
    })),
    configFiles: report.configFiles,
    components: report.components,
    backups: report.backups
  };
}
