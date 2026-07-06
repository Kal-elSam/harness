import { writeFile } from "node:fs/promises";
import { buildAdapterMatrixReport } from "./adapter-matrix.js";
import { buildDiffJson, buildDiffReport } from "./diff.js";
import { getHistoryPath, readHistoryEvents } from "./history.js";
import { buildEffectivePolicy } from "./policy.js";
import { buildStatusReport } from "./status.js";

export const DEFAULT_HISTORY_LIMIT = 20;

export async function buildDiagnosticsReport(homeDir, {
  packageRoot,
  packageName,
  cliVersion,
  workspaceRoot = null,
  historyLimit = DEFAULT_HISTORY_LIMIT
} = {}) {
  const statusReport = await buildStatusReport(homeDir, { packageRoot, workspaceRoot });
  const adapterReport = await buildAdapterMatrixReport(homeDir);
  const diffReport = await buildDiffReport(homeDir, {
    packageRoot,
    packageName,
    cliVersion,
    workspaceRoot
  });
  const policy = await buildEffectivePolicy(homeDir);
  const { events, warnings } = await readHistoryEvents(homeDir, { limit: historyLimit });

  return {
    homeDir,
    cliVersion,
    adapters: summarizeAdapters(adapterReport),
    policy,
    status: summarizeStatus(statusReport),
    diff: summarizeDiff(diffReport),
    history: {
      path: getHistoryPath(homeDir),
      limit: historyLimit,
      events,
      warnings
    },
    ok: statusReport.ok
  };
}

function summarizeAdapters(report) {
  return {
    supportedCount: report.supportedCount,
    detectedCount: report.detectedCount,
    managedCount: report.managedCount,
    adapters: report.adapters.map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      detected: adapter.detected,
      managed: adapter.managed,
      rootDir: adapter.rootDir,
      configFile: adapter.configFile,
      managedTargets: adapter.managedTargets
    }))
  };
}

function summarizeStatus(report) {
  return {
    overall: report.overall,
    ok: report.ok,
    stateRoot: report.stateRoot,
    installed: report.state != null,
    stateCliVersion: report.state?.cliVersion ?? null,
    agents: report.agents,
    components: report.components,
    counts: report.counts,
    backups: report.backups,
    nextAction: report.nextAction
  };
}

function summarizeDiff(report) {
  return {
    installed: report.installed,
    status: report.status,
    hasChanges: report.hasChanges,
    summary: report.summary,
    nextAction: report.nextAction,
    changeCount: report.changes.length,
    changes: report.changes.map((change) => ({
      kind: change.kind,
      action: change.action,
      target: change.target,
      status: change.status
    })),
    preservedCount: report.preserved.length
  };
}

export function buildReportJson(report) {
  return {
    ok: report.ok,
    cliVersion: report.cliVersion,
    homeDir: report.homeDir,
    adapters: report.adapters,
    policy: report.policy,
    status: report.status,
    diff: report.diff,
    history: report.history
  };
}

export async function writeReportFile(outPath, content) {
  await writeFile(outPath, content, "utf8");
}
