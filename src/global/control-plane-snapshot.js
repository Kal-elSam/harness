import { buildAdapterMatrixReport } from "./adapter-matrix.js";
import { listBackupSnapshots } from "./backups.js";
import { buildDiffReport } from "./diff.js";
import { buildExplainReport } from "./explain.js";
import { getHistoryPath, readHistoryEvents } from "./history.js";
import { harnessHomePaths } from "./paths.js";
import { buildStatusReport } from "./status.js";
import { buildControlPlaneJson } from "./json-output.js";
import { formatCliCommand } from "./brand/cli.js";
import { buildRuntimeDashboardData } from "./runtime/run-cli.js";
import { describeBackupSnapshots } from "./rollback.js";

/**
 * Global control-plane health. Optional intelligence absence must never
 * degrade these states by itself.
 */
export const CONTROL_PLANE_HEALTH = {
  NOT_CONFIGURED: "NOT_CONFIGURED",
  ACTION_REQUIRED: "ACTION_REQUIRED",
  HEALTHY_WITH_NOTES: "HEALTHY_WITH_NOTES",
  HEALTHY: "HEALTHY",
  CHECK_FAILED: "CHECK_FAILED"
};

export const CONTROL_PLANE_CTA = {
  SETUP: "setup",
  REPAIR: "repair",
  VERIFY: "verify",
  REVIEW: "review",
  IDLE: "idle"
};

/**
 * Pure mapping from status.overall + warning counts to control-plane health.
 * Does not inspect intelligence backends.
 */
export function resolveControlPlaneHealth(status) {
  if (!status || status.state == null || status.overall === "missing") {
    return CONTROL_PLANE_HEALTH.NOT_CONFIGURED;
  }

  if (status.overall === "failed") {
    return CONTROL_PLANE_HEALTH.CHECK_FAILED;
  }

  if (status.overall === "drift") {
    return CONTROL_PLANE_HEALTH.ACTION_REQUIRED;
  }

  if ((status.counts?.warning ?? 0) > 0) {
    return CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES;
  }

  return CONTROL_PLANE_HEALTH.HEALTHY;
}

/**
 * Prefer setup / repairs / verification before launching runs.
 */
export function resolveControlPlaneCta({ health, status, diff } = {}) {
  switch (health) {
    case CONTROL_PLANE_HEALTH.NOT_CONFIGURED:
      return {
        kind: CONTROL_PLANE_CTA.SETUP,
        title: "Finish local setup",
        detail: status?.nextAction
          ?? `Run ${formatCliCommand("setup")} to configure the local ecosystem.`,
        destination: "changes"
      };
    case CONTROL_PLANE_HEALTH.ACTION_REQUIRED:
      return {
        kind: CONTROL_PLANE_CTA.REPAIR,
        title: "Review and repair drift",
        detail: status?.nextAction
          ?? `Preview repairs with ${formatCliCommand("diff")}, then confirm sync.`,
        destination: "changes"
      };
    case CONTROL_PLANE_HEALTH.CHECK_FAILED:
      return {
        kind: CONTROL_PLANE_CTA.VERIFY,
        title: "Investigate failed checks",
        detail: status?.nextAction
          ?? `Run ${formatCliCommand("doctor")} for details.`,
        destination: "control-center"
      };
    case CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES:
      return {
        kind: CONTROL_PLANE_CTA.REVIEW,
        title: "Review notes",
        detail: diff?.hasChanges
          ? "Some notes remain after a healthy scan. Open Changes to inspect."
          : "Ecosystem is healthy with non-blocking notes.",
        destination: "control-center"
      };
    case CONTROL_PLANE_HEALTH.HEALTHY:
      return {
        kind: CONTROL_PLANE_CTA.IDLE,
        title: "Ecosystem healthy",
        detail: status?.nextAction ?? "No governance action required.",
        destination: "control-center"
      };
    default: {
      const _exhaustive = health;
      return {
        kind: CONTROL_PLANE_CTA.VERIFY,
        title: "Review control plane",
        detail: String(_exhaustive),
        destination: "control-center"
      };
    }
  }
}

/**
 * Read-only control-plane snapshot composed from existing engines.
 * Never writes. Optional intelligence is intentionally omitted from health.
 */
export async function buildControlPlaneSnapshot({
  homeDir,
  workspaceRoot = null,
  packageName,
  packageRoot,
  cliVersion,
  includeDiff = true,
  includeExplain = false,
  includeRuntime = true,
  historyLimit = 20
} = {}) {
  const status = await buildStatusReport(homeDir, { packageRoot, workspaceRoot });
  const adapters = await buildAdapterMatrixReport(homeDir);
  const history = await readHistoryEvents(homeDir, { limit: historyLimit });
  const backupSnapshots = await describeBackupSnapshots(
    harnessHomePaths(homeDir).backupsDir
  ).catch(async () => {
    const names = await listBackupSnapshots(harnessHomePaths(homeDir).backupsDir);
    return names.map((name) => ({ name, fileCount: null }));
  });

  const diff = includeDiff
    ? await buildDiffReport(homeDir, {
      packageRoot,
      packageName,
      cliVersion,
      workspaceRoot
    })
    : null;

  const explain = includeExplain
    ? await buildExplainReport(homeDir)
    : null;

  const runtime = includeRuntime
    ? await buildRuntimeDashboardData({ homeDir, workspaceRoot, cliVersion })
    : null;

  const health = resolveControlPlaneHealth(status);
  const cta = resolveControlPlaneCta({ health, status, diff });

  const governedAgents = (adapters.adapters ?? []).filter((entry) => entry.managed).length;
  const detectedAgents = (adapters.adapters ?? []).filter((entry) => entry.detected).length;

  return {
    readOnly: true,
    scannedAt: new Date().toISOString(),
    cliVersion,
    packageName,
    homeDir,
    workspaceRoot,
    health,
    cta,
    coverage: {
      detectedAgents,
      governedAgents,
      components: status.components?.length ?? 0,
      activeModules: (status.components ?? [])
        .filter((entry) => entry.status === "ok")
        .map((entry) => entry.id)
    },
    status,
    adapters,
    policy: status.policy,
    backups: {
      count: status.backups,
      snapshots: backupSnapshots
    },
    history: {
      path: getHistoryPath(homeDir),
      limit: historyLimit,
      events: history.events,
      warnings: history.warnings
    },
    diff,
    explain,
    runtime: runtime
      ? {
        activeRuns: runtime.activeRuns?.length ?? 0,
        recentRuns: runtime.recentRuns?.length ?? 0,
        providers: runtime.providers ?? []
      }
      : null,
    envelope: buildControlPlaneJson(status, { cliVersion })
  };
}
