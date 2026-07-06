import { updateGlobalHarness } from "./global-installer.js";
import {
  assertExplicitApplyConsent,
  createReadlinePrompt,
  promptApplyConfirmation,
  shouldPromptApplyConfirmation
} from "./apply-confirmation.js";
import { buildDiffReport } from "./diff.js";
import { fetchPublishedVersion } from "./npm-registry.js";
import { harnessHomePaths } from "./paths.js";
import { printManagedPreflight, shouldShowPreflight, summarizeDiffPreflight } from "./preflight.js";
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
  confirm = false,
  preflight = true,
  json = false,
  interactive = null,
  createPrompt = createReadlinePrompt,
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
  const applying = yes && !dryRun;

  assertExplicitApplyConsent({
    applying,
    dryRun,
    json,
    yes,
    confirm,
    noPreflight: !preflight,
    interactive,
    command: "upgrade"
  });

  if (yes && shouldShowPreflight({ preflight, dryRun: false, json, applying: true }) && state) {
    const diffReport = await buildDiffReport(homeDir, {
      packageRoot,
      packageName,
      cliVersion,
      workspaceRoot
    });
    printManagedPreflight({ command: "upgrade", ...summarizeDiffPreflight(diffReport) });
  }

  if (yes && shouldPromptApplyConfirmation({ applying, dryRun, json, confirm, interactive })) {
    const approved = await promptApplyConfirmation({ command: "upgrade", createPrompt });
    if (!approved) {
      return {
        cancelled: true,
        dryRun: true,
        wrote: false,
        installedVersion: cliVersion,
        latestVersion,
        latestCommand,
        previewCommand,
        result: null,
        statePresent: Boolean(state)
      };
    }
  }

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
