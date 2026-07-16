import { listBackupSnapshots } from "./backups.js";
import { buildComponentHealthEntries } from "./component-health.js";
import { runGlobalDoctorChecks } from "./global-doctor.js";
import { buildEffectivePolicy } from "./policy.js";
import { harnessHomePaths } from "./paths.js";
import { GLOBAL_AGENT_IDS, detectInstalledAdapters } from "./registry.js";
import { readGlobalState } from "./state.js";
import { formatCliCommand } from "./brand/cli.js";

export async function buildStatusReport(homeDir, { packageRoot, workspaceRoot = null } = {}) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);
  const detected = detectInstalledAdapters({ homeDir });
  const doctor = await runGlobalDoctorChecks(homeDir, { packageRoot, workspaceRoot });
  const backups = await listBackupSnapshots(paths.backupsDir);

  const installedAgentIds = new Set((state?.adapters ?? state?.agents ?? []).map((entry) => entry.id));
  const agents = GLOBAL_AGENT_IDS.map((id) => ({
    id,
    detected: detected.includes(id),
    managed: installedAgentIds.has(id)
  }));

  const components = buildComponentHealthEntries(state?.components ?? [], doctor.checks)
    .map(({ checks, ...entry }) => entry);

  const counts = {
    ok: doctor.checks.filter((check) => check.status === "ok").length,
    stale: doctor.checks.filter((check) => check.status === "stale").length,
    missing: doctor.checks.filter((check) => check.status === "missing").length,
    warning: doctor.checks.filter((check) => check.status === "warning").length
  };

  const overall = resolveOverallStatus({ state, doctor });
  const nextAction = resolveNextAction(overall, { backups: backups.length });
  const policy = await buildEffectivePolicy(homeDir);

  return {
    homeDir,
    stateRoot: paths.root,
    state,
    agents,
    components,
    componentHealth: doctor.componentHealth,
    checks: doctor.checks,
    backups: backups.length,
    counts,
    overall,
    nextAction,
    policy,
    ok: overall === "ok"
  };
}

function resolveOverallStatus({ state, doctor }) {
  if (!state) return "missing";
  if (doctor.hasDrift) return "drift";
  if (!doctor.ok) return "failed";
  return "ok";
}

function resolveNextAction(overall, { backups = 0 } = {}) {
  switch (overall) {
    case "missing":
      return `Run "${formatCliCommand("setup")}" (or "${formatCliCommand("install")}") to configure the local ecosystem.`;
    case "drift":
      return backups > 0
        ? `Run "${formatCliCommand("sync")}" to repair managed content. Use "${formatCliCommand("rollback")}" to restore a prior snapshot.`
        : `Run "${formatCliCommand("sync")}" to repair managed content.`;
    case "failed":
      return `Run "${formatCliCommand("doctor")}" for details, then "${formatCliCommand("sync")}" or "${formatCliCommand("setup")}".`;
    case "ok":
      return backups > 0
        ? `Ecosystem healthy. Use "${formatCliCommand("rollback")}" if you need a prior snapshot.`
        : "Ecosystem healthy. No action required.";
    default: {
      const _exhaustive = overall;
      return _exhaustive;
    }
  }
}
