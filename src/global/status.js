import { listBackupSnapshots } from "./backups.js";
import { runGlobalDoctorChecks } from "./global-doctor.js";
import { harnessHomePaths } from "./paths.js";
import { GLOBAL_AGENT_IDS, detectInstalledAdapters } from "./registry.js";
import { readGlobalState } from "./state.js";

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

  const components = (state?.components ?? []).map((entry) => {
    const related = doctor.checks.filter((check) => check.componentId === entry.id);
    const status = summarizeCheckStatuses(related);
    return {
      id: entry.id,
      version: entry.version,
      source: entry.source ?? "bundled",
      status
    };
  });

  const counts = {
    ok: doctor.checks.filter((check) => check.status === "ok").length,
    stale: doctor.checks.filter((check) => check.status === "stale").length,
    missing: doctor.checks.filter((check) => check.status === "missing").length,
    warning: doctor.checks.filter((check) => check.status === "warning").length
  };

  const overall = resolveOverallStatus({ state, doctor });
  const nextAction = resolveNextAction(overall, { backups: backups.length });

  return {
    homeDir,
    stateRoot: paths.root,
    state,
    agents,
    components,
    backups: backups.length,
    counts,
    overall,
    nextAction,
    ok: overall === "ok"
  };
}

function summarizeCheckStatuses(checks) {
  if (checks.length === 0) return "ok";
  if (checks.some((check) => check.status === "missing")) return "missing";
  if (checks.some((check) => check.status === "stale")) return "stale";
  return "ok";
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
      return 'Run "harness setup" (or "harness install") to configure the local ecosystem.';
    case "drift":
      return backups > 0
        ? 'Run "harness sync" to repair managed content. Use "harness rollback" to restore a prior snapshot.'
        : 'Run "harness sync" to repair managed content.';
    case "failed":
      return 'Run "harness doctor" for details, then "harness sync" or "harness setup".';
    case "ok":
      return backups > 0
        ? 'Ecosystem healthy. Use "harness rollback" if you need a prior snapshot.'
        : "Ecosystem healthy. No action required.";
    default: {
      const _exhaustive = overall;
      return _exhaustive;
    }
  }
}
