import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { hashBuffer } from "../hash.js";
import { GLOBAL_AGENT_IDS, agentById, detectGlobalAgents } from "./agents.js";
import { backupFileBeforeChange, backupTimestamp } from "./backups.js";
import { harnessHomePaths } from "./paths.js";
import { removeManagedSection, upsertManagedSection } from "./managed-section.js";
import { createGlobalState, readGlobalState, writeGlobalState } from "./state.js";

export function buildManagedBody({ packageName, coreDir }) {
  return [
    "## Harness (managed)",
    "",
    `Managed by \`${packageName}\`. Content inside these markers is refreshed by`,
    "`harness update`. Everything outside the markers is yours and is preserved.",
    "",
    `- Orchestrator contract: ${join(coreDir, "orchestrator.md")}`,
    "- When working inside a repository, its AGENTS.md governs first.",
    "- Run `harness doctor` to check ecosystem health.",
    "- Run `harness uninstall` to remove managed sections safely."
  ].join("\n");
}

export async function installGlobalHarness({ packageRoot, packageName, cliVersion, homeDir, agents = null, dryRun = false }) {
  const paths = harnessHomePaths(homeDir);
  const selectedAgents = resolveAgents(homeDir, agents);
  const timestamp = backupTimestamp();
  const result = {
    scope: "agent-global",
    homeDir,
    stateRoot: paths.root,
    agents: selectedAgents,
    coreFiles: [],
    configsCreated: [],
    configsUpdated: [],
    configsUnchanged: [],
    backups: []
  };

  const coreFiles = await installCoreFiles({ packageRoot, paths, dryRun, result });

  for (const agentId of selectedAgents) {
    await applyManagedSection({ agentId, paths, packageName, timestamp, dryRun, result });
  }

  if (!dryRun) {
    const existingState = await readGlobalState(paths.statePath);
    await writeGlobalState(paths.statePath, createGlobalState({
      packageName,
      cliVersion,
      agents: buildAgentStateEntries(selectedAgents, homeDir),
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

  const agents = options.agents ?? state.agents.map((agent) => agent.id);
  return installGlobalHarness({ ...options, agents });
}

export async function uninstallGlobalHarness({ homeDir, dryRun = false }) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);
  const agents = state?.agents?.map((agent) => agent.id) ?? detectGlobalAgents(homeDir);
  const timestamp = backupTimestamp();
  const result = { scope: "agent-global", agents, configsCleaned: [], backups: [], stateRemoved: false };

  for (const agentId of agents) {
    const configPath = join(homeDir, agentById(agentId).configFile);
    if (!existsSync(configPath)) continue;

    const content = await readFile(configPath, "utf8");
    const { content: cleaned, removed } = removeManagedSection(content);
    if (!removed) continue;

    const backupPath = await backupFileBeforeChange({
      backupsDir: paths.backupsDir,
      homeDir,
      filePath: configPath,
      timestamp,
      dryRun
    });

    if (backupPath) result.backups.push(backupPath);
    if (!dryRun) await writeFile(configPath, cleaned, "utf8");
    result.configsCleaned.push(relativeToHome(homeDir, configPath));
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

async function applyManagedSection({ agentId, paths, packageName, timestamp, dryRun, result }) {
  const agent = agentById(agentId);
  const configPath = join(paths.homeDir, agent.configFile);
  const exists = existsSync(configPath);
  const current = exists ? await readFile(configPath, "utf8") : "";
  const body = buildManagedBody({ packageName, coreDir: paths.coreDir });
  const { content: next, changed } = upsertManagedSection(current, body);
  const configLabel = agent.configFile;

  if (!changed) {
    result.configsUnchanged.push(configLabel);
    return;
  }

  if (exists) {
    const backupPath = await backupFileBeforeChange({
      backupsDir: paths.backupsDir,
      homeDir: paths.homeDir,
      filePath: configPath,
      timestamp,
      dryRun
    });
    if (backupPath) result.backups.push(backupPath);
  }

  if (!dryRun) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, next, "utf8");
  }

  result[exists ? "configsUpdated" : "configsCreated"].push(configLabel);
}

function resolveAgents(homeDir, agents) {
  if (agents == null) {
    const detected = detectGlobalAgents(homeDir);
    return detected.length > 0 ? detected : [...GLOBAL_AGENT_IDS];
  }

  return agents.map((agentId) => agentById(agentId).id);
}

function buildAgentStateEntries(agentIds, homeDir) {
  return agentIds.map((agentId) => {
    const agent = agentById(agentId);
    return { id: agent.id, configFile: agent.configFile, present: existsSync(join(homeDir, agent.configFile)) };
  });
}

function relativeToHome(homeDir, filePath) {
  return relative(homeDir, filePath).split(sep).join("/");
}