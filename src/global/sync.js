import { updateGlobalHarness } from "./global-installer.js";
import {
  assertExplicitApplyConsent,
  createReadlinePrompt,
  promptApplyConfirmation,
  shouldPromptApplyConfirmation
} from "./apply-confirmation.js";
import { buildDiffReport } from "./diff.js";
import { harnessHomePaths } from "./paths.js";
import { printManagedPreflight, shouldShowPreflight, summarizeDiffPreflight } from "./preflight.js";
import { loadConsentAudit } from "./policy.js";
import { readGlobalState } from "./state.js";
import { buildStatusReport } from "./status.js";

export async function runHarnessSync({
  packageRoot,
  packageName,
  cliVersion,
  homeDir,
  workspaceRoot = null,
  dryRun = false,
  yes = false,
  confirm = false,
  preflight = true,
  preflightExplicit = false,
  yesExplicit = false,
  confirmExplicit = false,
  json = false,
  interactive = null,
  createPrompt = createReadlinePrompt
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

  const applying = !dryRun;

  assertExplicitApplyConsent({
    applying,
    dryRun,
    json,
    yes,
    confirm,
    noPreflight: !preflight,
    interactive,
    command: "sync"
  });

  if (shouldShowPreflight({ preflight, dryRun, json, applying })) {
    const diffReport = await buildDiffReport(homeDir, {
      packageRoot,
      packageName,
      cliVersion,
      workspaceRoot
    });
    const consent = await loadConsentAudit(homeDir, {
      yes,
      confirm,
      yesExplicit,
      confirmExplicit,
      preflight,
      preflightExplicit,
      interactive,
      applying,
      dryRun,
      json
    });
    printManagedPreflight({
      command: "sync",
      ...summarizeDiffPreflight(diffReport),
      consentSource: consent.consentSource,
      policyProfile: consent.policyProfile
    });
  }

  if (shouldPromptApplyConfirmation({ applying, dryRun, json, confirm, interactive })) {
    const approved = await promptApplyConfirmation({ command: "sync", createPrompt });
    if (!approved) {
      return {
        action: "cancelled",
        wrote: false,
        result: null,
        report: preReport
      };
    }
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
