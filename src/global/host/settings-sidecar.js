/**
 * U5b: Settings snapshot for the ratatui host.
 *
 * Reuses cockpit-settings formatters, profile resolution, and connections
 * report. Interactive setup has no safe ratatui path yet — honest stub.
 */

import { buildConnectionsReport } from "../connections.js";
import {
  formatSettingsLines,
  listCuratedIntegrations
} from "../ink/cockpit-settings.js";
import { loadCockpitScanBundle } from "../ink/cockpit-scan.js";
import { buildReadOnlyDiagnostics } from "../action-planner.js";
import { buildControlPlaneSnapshot } from "../control-plane-snapshot.js";
import { resolveHomeDir } from "../paths.js";
import { resolveProfile } from "../profile.js";
import { buildRuntimeDashboardData } from "../runtime/run-cli.js";
import { PACKAGE_NAME } from "../brand/cli.js";

/** Honest label — no interactive setup chrome in ratatui yet. Keep short for 60-col wrap. */
export const SETUP_NOT_WIRED_LABEL = "use `kairo setup` (UI not wired)";

export const SETTINGS_HINTS_DEFAULT =
  "Esc → Work · ↑↓ browse · Enter preview · y/n confirm";

export function formatSettingsHints() {
  return SETTINGS_HINTS_DEFAULT;
}

function errorLines(section, error) {
  const detail = error instanceof Error ? error.message : String(error ?? "unavailable");
  return [`${section} unavailable.`, detail];
}

function formatProfileLines(resolved) {
  if (!resolved?.profile || typeof resolved.profile !== "object") {
    return ["Profile unavailable."];
  }
  const p = resolved.profile;
  const sources = resolved.sources ?? {};
  const sourceLabel = [sources.global ? "global" : null, sources.project ? "project" : null]
    .filter(Boolean)
    .join(", ") || "none";
  return [
    "PROFILE",
    `applyMode · ${p.applyMode ?? "n/a"}`,
    `tokenBudget · ${p.tokenBudget ?? "n/a"}`,
    `preferredModel · ${p.preferredModel ?? "none"}`,
    `preferredBackend · ${p.preferredBackend ?? "none"}`,
    `sources · ${sourceLabel}`
  ];
}

function formatConnectionLines(report) {
  const list = Array.isArray(report?.connections) ? report.connections : [];
  if (list.length === 0) return ["No connections reported."];
  return [
    "CONNECTIONS (read-only)",
    ...list.map((c) => {
      const label = c.label ?? c.id ?? "connection";
      const state = c.state ?? c.status ?? "unknown";
      return `${state} · ${label}`;
    })
  ];
}

function formatIntegrationLines(integrations) {
  if (!Array.isArray(integrations) || integrations.length === 0) {
    return ["No curated integrations available."];
  }
  return [
    "CURATED INTEGRATIONS (confirm = intent only; no auto-install)",
    ...integrations.map(
      (entry) =>
        `${entry.status ?? "?"} · ${entry.name ?? entry.id} · ${entry.version ?? "?"} · ${entry.license ?? "?"}`
    )
  ];
}

/**
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function buildSettingsSnapshot({
  homeDir = resolveHomeDir(),
  workspaceRoot = process.cwd(),
  packageName = PACKAGE_NAME,
  packageRoot,
  cliVersion,
  resolveProfileFn = resolveProfile,
  listIntegrations = listCuratedIntegrations,
  buildConnections = buildConnectionsReport,
  loadScanBundle = null
} = {}) {
  const errors = [];

  let profile;
  let resolvedProfile = null;
  try {
    resolvedProfile = await resolveProfileFn({ homeDir, workspaceRoot });
    profile = formatProfileLines(resolvedProfile);
  } catch (error) {
    errors.push(error);
    profile = errorLines("Profile", error);
  }

  let integrations;
  try {
    integrations = formatIntegrationLines(listIntegrations());
  } catch (error) {
    errors.push(error);
    integrations = errorLines("Integrations", error);
  }

  let connections;
  try {
    const report = await buildConnections({ homeDir, workspaceRoot });
    connections = formatConnectionLines(report);
  } catch (error) {
    errors.push(error);
    connections = errorLines("Connections", error);
  }

  let catalogLines = [];
  try {
    const loadBundle =
      loadScanBundle ??
      (() =>
        loadCockpitScanBundle({
          homeDir,
          workspaceRoot,
          packageName,
          packageRoot,
          cliVersion,
          buildDashboard: buildRuntimeDashboardData,
          buildDiagnostics: buildReadOnlyDiagnostics,
          buildSnapshot: buildControlPlaneSnapshot
        }));
    const bundle = await loadBundle();
    catalogLines = formatSettingsLines({
      listIndex: 0,
      settingsAction: null,
      snapshot: bundle?.snapshot ?? null,
      diagnostics: bundle?.diagnostics ?? null
    });
  } catch (error) {
    errors.push(error);
    catalogLines = errorLines("Settings catalog", error);
  }

  return {
    ok: errors.length === 0,
    error:
      errors.length > 0
        ? errors[0] instanceof Error
          ? errors[0].message
          : String(errors[0])
        : null,
    profile,
    integrations,
    connections,
    catalog: catalogLines,
    setup: {
      wired: false,
      label: SETUP_NOT_WIRED_LABEL
    },
    hints: formatSettingsHints()
  };
}
