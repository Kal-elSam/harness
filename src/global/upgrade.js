import { updateGlobalHarness } from "./global-installer.js";
import { fetchPublishedVersion } from "./npm-registry.js";
import { harnessHomePaths } from "./paths.js";
import { readGlobalState } from "./state.js";
import { runHarnessSetup } from "./setup.js";

export async function runHarnessUpgrade({
  packageRoot,
  packageName,
  cliVersion,
  homeDir,
  workspaceRoot = null,
  dryRun = false,
  yes = false,
  fetchVersion = fetchPublishedVersion
}) {
  if (yes && dryRun) {
    throw new Error("Use either --dry-run or --yes, not both.");
  }

  const preview = !yes;

  const latestVersion = await fetchVersion(packageName);
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);
  const latestCommand = `npx ${packageName}@latest setup --yes`;
  const previewCommand = `npx ${packageName}@latest setup --dry-run`;

  let result = null;

  if (state) {
    result = await updateGlobalHarness({
      packageRoot,
      packageName,
      cliVersion,
      homeDir,
      workspaceRoot,
      dryRun: preview
    });
  } else if (preview) {
    const outcome = await runHarnessSetup({
      packageRoot,
      packageName,
      cliVersion,
      homeDir,
      workspaceRoot,
      dryRun: true,
      yes: false,
      interactive: false
    });

    if (outcome.cancelled) {
      throw new Error("Upgrade preview cancelled.");
    }

    result = outcome.result;
  } else {
    throw new Error('No managed state found. Run "harness setup --yes" before upgrading.');
  }

  return {
    dryRun: preview,
    wrote: !preview,
    installedVersion: cliVersion,
    latestVersion,
    latestCommand,
    previewCommand,
    result,
    statePresent: Boolean(state)
  };
}
