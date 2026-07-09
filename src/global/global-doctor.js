import { listBackupSnapshots } from "./backups.js";
import { buildAdapterContext } from "./adapter-context.js";
import { runComponentEcosystemChecks } from "./component-ecosystem-checks.js";
import { detectGlobalDrift, hasRepairableDrift } from "./drift.js";
import { harnessHomePaths } from "./paths.js";
import { resolveComponent } from "./component-registry.js";
import { readGlobalState } from "./state.js";
import { formatCliCommand } from "./brand/cli.js";

export async function runGlobalDoctorChecks(homeDir, { packageRoot, workspaceRoot = null } = {}) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);
  const installedComponents = (state?.components ?? []).map((entry) => resolveComponent(entry.id, { workspaceRoot }));
  const context = buildAdapterContext({
    homeDir,
    packageName: state?.packageName ?? "",
    packageRoot,
    workspaceRoot,
    components: installedComponents
  });
  const checks = packageRoot
    ? await detectGlobalDrift({ homeDir, paths, state, packageRoot, workspaceRoot, context })
    : [stateOnlyCheck(state)];

  if (packageRoot) {
    checks.push(await backupsCheck(paths));
    checks.push(...await runComponentEcosystemChecks({
      installedComponents,
      workspaceRoot
    }));
  }

  const hasMissing = checks.some((check) => check.status === "missing");
  const hasStale = checks.some((check) => check.status === "stale");

  return {
    checks,
    ok: !hasMissing && !hasStale,
    hasDrift: hasRepairableDrift(checks),
    state,
    paths
  };
}

function stateOnlyCheck(state) {
  if (!state) {
    return {
      name: "~/.harness/state.json",
      status: "missing",
      category: "state",
      detail: `Not found. Run "${formatCliCommand("install")}" to configure the local ecosystem.`
    };
  }

  return {
    name: "~/.harness/state.json",
    status: "ok",
    category: "state",
    detail: `cliVersion=${state.cliVersion ?? "unknown"}`
  };
}

async function backupsCheck(paths) {
  const snapshots = await listBackupSnapshots(paths.backupsDir);

  return {
    name: "~/.harness/backups",
    status: "ok",
    category: "backups",
    detail: snapshots.length > 0 ? `${snapshots.length} snapshot(s)` : "No snapshots yet."
  };
}
