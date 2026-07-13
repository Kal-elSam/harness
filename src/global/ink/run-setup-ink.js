import React from "react";
import { render } from "ink";
import { WIZARD_COPY } from "../brand/index.js";
import { loadConsentAudit } from "../policy.js";
import { formatResultNote } from "../clack/theme.js";
import { SetupWizardCancelledError } from "../clack/setup-wizard-constants.js";
import { SetupApp } from "./setup-app.js";
import { createFullscreenSession } from "./fullscreen-session.js";

export { SetupWizardCancelledError };

export async function runSetupInk({
  homeDir,
  workspaceRoot,
  packageRoot,
  packageName,
  cliVersion,
  dryRun = false,
  onboarding = false,
  preflight = true,
  yes = false,
  confirm = false,
  preflightExplicit = false,
  yesExplicit = false,
  confirmExplicit = false,
  interactive = true,
  renderImpl = render,
  fullscreenSession = null,
  stdout = process.stdout
}) {
  const ownsSession = !fullscreenSession;
  const session = fullscreenSession ?? createFullscreenSession({
    stdout,
    enabled: Boolean(stdout?.isTTY)
  });

  if (ownsSession) {
    session.enter();
  }

  let outcome;
  try {
    outcome = await new Promise((resolve) => {
      const { waitUntilExit } = renderImpl(
        React.createElement(SetupApp, {
          homeDir,
          workspaceRoot,
          packageRoot,
          packageName,
          cliVersion,
          dryRun,
          onboarding,
          onComplete: resolve
        }),
        stdout ? { stdout } : undefined
      );

      waitUntilExit().catch((error) => {
        resolve({ cancelled: true, usedWizard: true, error });
      });
    });
  } finally {
    if (ownsSession) {
      session.leave();
    }
  }

  if (outcome.error) {
    throw outcome.error;
  }

  if (outcome.cancelled) {
    return outcome;
  }

  const consent = preflight
    ? await loadConsentAudit(homeDir, {
      yes,
      confirm,
      yesExplicit,
      confirmExplicit,
      preflight,
      preflightExplicit,
      interactive,
      applying: !dryRun,
      dryRun,
      json: false
    })
    : null;

  return { ...outcome, consent };
}

export function renderSetupInkResult(result, { dryRun = false } = {}) {
  const title = dryRun ? WIZARD_COPY.resultDryRunTitle : WIZARD_COPY.resultSuccessTitle;
  const outro = dryRun ? WIZARD_COPY.outroDryRun : WIZARD_COPY.outroSuccess;
  console.log(`\n${title}\n`);
  console.log(formatResultNote(result, { dryRun }));
  console.log(`\n${outro}\n`);
}
