import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GLOBAL_AGENTS, detectGlobalAgents } from "./agents.js";
import { listBackupSnapshots } from "./backups.js";
import { harnessHomePaths } from "./paths.js";
import { hasManagedSection } from "./managed-section.js";
import { readGlobalState } from "./state.js";

export async function runGlobalDoctorChecks(homeDir) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);
  const checks = [stateCheck(state), ...coreFileChecks(paths, state)];

  checks.push(...await agentChecks(homeDir, state));
  checks.push(await backupsCheck(paths));

  const hasMissingRequired = checks.some((check) => check.status === "missing");
  return { checks, ok: !hasMissingRequired, state, paths };
}

function stateCheck(state) {
  if (!state) {
    return {
      name: "~/.harness/state.json",
      status: "missing",
      detail: 'Not found. Run "harness install" to configure the local ecosystem.'
    };
  }

  return {
    name: "~/.harness/state.json",
    status: "ok",
    detail: `cliVersion=${state.cliVersion ?? "unknown"}, agents=${state.agents?.length ?? 0}`
  };
}

function coreFileChecks(paths, state) {
  const coreFiles = Object.keys(state?.coreFiles ?? {});

  if (coreFiles.length === 0) {
    return [{
      name: "~/.harness/core",
      status: state ? "warning" : "missing",
      detail: "No managed core files recorded."
    }];
  }

  return coreFiles.map((relativePath) => {
    const exists = existsSync(join(paths.root, relativePath));
    return {
      name: `~/.harness/${relativePath}`,
      status: exists ? "ok" : "missing",
      detail: exists ? undefined : "Tracked core file missing on disk."
    };
  });
}

async function agentChecks(homeDir, state) {
  const detected = new Set(detectGlobalAgents(homeDir));
  const installed = new Set(state?.agents?.map((agent) => agent.id) ?? []);
  const checks = [];

  for (const agent of GLOBAL_AGENTS) {
    const configPath = join(homeDir, agent.configFile);
    const isRelevant = detected.has(agent.id) || installed.has(agent.id);
    if (!isRelevant) {
      checks.push({ name: `agent:${agent.id}`, status: "info", detail: "Not detected on this machine." });
      continue;
    }

    if (!existsSync(configPath)) {
      checks.push({
        name: `agent:${agent.id}`,
        status: installed.has(agent.id) ? "missing" : "warning",
        detail: `Config not found: ~/${agent.configFile}`
      });
      continue;
    }

    const content = await readFile(configPath, "utf8");
    const managed = hasManagedSection(content);
    checks.push({
      name: `agent:${agent.id}`,
      status: managed ? "ok" : "warning",
      detail: managed
        ? `Managed section present in ~/${agent.configFile}`
        : `No managed section in ~/${agent.configFile}. Run "harness install".`
    });
  }

  return checks;
}

async function backupsCheck(paths) {
  const snapshots = await listBackupSnapshots(paths.backupsDir);

  return {
    name: "~/.harness/backups",
    status: "ok",
    detail: snapshots.length > 0 ? `${snapshots.length} snapshot(s)` : "No snapshots yet."
  };
}
