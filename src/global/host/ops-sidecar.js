/**
 * U5a: thin read-only Operations snapshot for the ratatui host.
 *
 * Reuses existing scanners — no new routers/stores:
 *   loadCockpitScanBundle + buildReadOnlyDiagnostics + buildRuntimeDashboardData
 *   + buildControlPlaneSnapshot + buildFleetReport + slash usage formatters.
 *
 * Honest labeling: fleet section is `kairo fleet` topology, NOT slash `/providers`.
 * Fail-closed: each section degrades to honest empty/error lines when a local
 * read-only service is unavailable.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReadOnlyDiagnostics } from "../action-planner.js";
import { PACKAGE_NAME } from "../brand/cli.js";
import { buildControlPlaneSnapshot } from "../control-plane-snapshot.js";
import { loadCockpitScanBundle } from "../ink/cockpit-scan.js";
import { formatUsageLines } from "../ink/cockpit-control-center.js";
import { formatSystemHealthLines } from "../ink/orchestrator-state.js";
import { resolveHomeDir } from "../paths.js";
import { buildRuntimeDashboardData } from "../runtime/run-cli.js";
import { buildFleetReport, formatFleetText } from "../observability/fleet-probe.js";
import { CockpitView } from "../cockpit/view.js";

/** First fleet line — must never be confused with slash `/providers`. */
export const FLEET_SECTION_TITLE =
  "Fleet topology (kairo fleet) — not slash /providers";

export const OPS_HINTS = "Esc → Work · r refresh";

const require = createRequire(import.meta.url);
const DEFAULT_PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Stub actions so CockpitView usageLines work without a TUI. */
const SLASH_VIEW_ACTIONS = Object.freeze({
  onApprove() {},
  onReject() {},
  onExecute() {},
  onCancel() {},
  onRefresh() {},
  onQuit() {}
});

function readPackageIdentity(packageRoot = DEFAULT_PACKAGE_ROOT) {
  try {
    const manifest = require(join(packageRoot, "package.json"));
    return {
      packageName: typeof manifest?.name === "string" ? manifest.name : PACKAGE_NAME,
      cliVersion: typeof manifest?.version === "string" ? manifest.version : "unknown"
    };
  } catch {
    return { packageName: PACKAGE_NAME, cliVersion: "unknown" };
  }
}

function errorLines(section, error) {
  const detail = error instanceof Error ? error.message : String(error ?? "unavailable");
  return [`${section} unavailable.`, detail];
}

/** Slash `/usage` lines from a conversation snapshot (same formatter as U4d). */
export function slashUsageLinesFromSnapshot(snap) {
  const view = new CockpitView({ actions: SLASH_VIEW_ACTIONS });
  view.snapshot = snap ?? {};
  return view.usageLines();
}

/**
 * @param {object|null|undefined} snapshot
 * @returns {string[]}
 */
export function formatOpsHealthLines(snapshot) {
  const health = typeof snapshot?.health === "string" ? snapshot.health.trim() : "";
  if (!health) return ["Health unavailable."];
  return [`Control plane · ${health}`];
}

/**
 * Compose a read-only Operations hub payload.
 *
 * @param {object} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   error: string|null,
 *   health: string[],
 *   fleet: string[],
 *   usage: string[],
 *   diagnostics: string[],
 *   hints: string
 * }>}
 */
export async function buildOpsSnapshot({
  homeDir = resolveHomeDir(),
  workspaceRoot = process.cwd(),
  packageRoot = DEFAULT_PACKAGE_ROOT,
  packageName,
  cliVersion,
  loadScanBundle = null,
  buildFleet = buildFleetReport,
  slashUsageLines = null,
  conversationSnapshot = null
} = {}) {
  const identity = readPackageIdentity(packageRoot);
  const resolvedName = packageName ?? identity.packageName;
  const resolvedVersion = cliVersion ?? identity.cliVersion;

  const loadBundle =
    loadScanBundle ??
    (() =>
      loadCockpitScanBundle({
        homeDir,
        workspaceRoot,
        packageName: resolvedName,
        packageRoot,
        cliVersion: resolvedVersion,
        buildDashboard: buildRuntimeDashboardData,
        buildDiagnostics: buildReadOnlyDiagnostics,
        buildSnapshot: buildControlPlaneSnapshot
      }));

  let bundle = null;
  let bundleError = null;
  try {
    bundle = await loadBundle();
  } catch (error) {
    bundleError = error;
  }

  let health;
  let diagnostics;
  let usageFromBundle;
  if (bundleError || !bundle) {
    const lines = errorLines("Ops scan", bundleError ?? new Error("scan returned empty"));
    health = lines;
    diagnostics = lines;
    usageFromBundle = lines;
  } else {
    health = formatOpsHealthLines(bundle.snapshot);
    try {
      diagnostics = formatSystemHealthLines(bundle.diagnostics);
    } catch (error) {
      diagnostics = errorLines("Diagnostics", error);
    }
    try {
      usageFromBundle = formatUsageLines({
        snapshot: bundle.snapshot,
        dashboard: bundle.dashboard
      });
    } catch (error) {
      usageFromBundle = errorLines("Usage", error);
    }
  }

  let fleet;
  try {
    const report = await buildFleet({ homeDir });
    const body = formatFleetText(report).split("\n");
    fleet = [FLEET_SECTION_TITLE, "", ...body];
  } catch (error) {
    fleet = [FLEET_SECTION_TITLE, "", ...errorLines("Fleet", error)];
  }

  let usage = usageFromBundle;
  try {
    const slashFn = slashUsageLines ?? slashUsageLinesFromSnapshot;
    const slashLines = await slashFn(conversationSnapshot);
    if (Array.isArray(slashLines) && slashLines.length > 0) {
      const hasSlashSignal = slashLines.some(
        (line) => typeof line === "string" && line.trim() !== "" && !/^unknown/i.test(line)
      );
      if (hasSlashSignal) {
        usage = [
          "Provider usage (/usage)",
          ...slashLines,
          "",
          "Run budgets (control plane)",
          ...usageFromBundle
        ];
      }
    }
  } catch (error) {
    if (bundleError) {
      usage = errorLines("Usage", error);
    }
    // else keep usageFromBundle — slash failure alone is non-fatal
  }

  const ok = !bundleError;
  return {
    ok,
    error: bundleError
      ? bundleError instanceof Error
        ? bundleError.message
        : String(bundleError)
      : null,
    health,
    fleet,
    usage,
    diagnostics,
    hints: OPS_HINTS
  };
}
