import { updateGlobalHarness } from "./global-installer.js";
import { harnessHomePaths } from "./paths.js";
import { readGlobalState } from "./state.js";
import { buildStatusReport } from "./status.js";

export async function runHarnessSync({
  packageRoot,
  packageName,
  cliVersion,
  homeDir,
  workspaceRoot = null,
  dryRun = false
}) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);

  if (!state) {
    return {
      action: "setup-required",
      wrote: false,
      result: null,
      report: await buildStatusReport(homeDir, { packageRoot, workspaceRoot })
    };
  }

  const preReport = await buildStatusReport(homeDir, { packageRoot, workspaceRoot });
  const needsRepair = preReport.overall === "drift"
    || preReport.counts.missing > 0
    || preReport.counts.stale > 0;

  if (!needsRepair) {
    return {
      action: "noop",
      wrote: false,
      result: null,
      report: preReport
    };
  }

  const result = await updateGlobalHarness({
    packageRoot,
    packageName,
    cliVersion,
    homeDir,
    workspaceRoot,
    dryRun
  });

  const report = dryRun
    ? preReport
    : await buildStatusReport(homeDir, { packageRoot, workspaceRoot });

  return {
    action: dryRun ? "plan" : "repaired",
    wrote: !dryRun,
    result,
    report
  };
}
