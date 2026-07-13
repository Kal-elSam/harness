import React from "react";
import { render } from "ink";
import { OrchestratorApp } from "./orchestrator-app.js";
import { createFullscreenSession } from "./fullscreen-session.js";

export async function runOrchestratorInk({
  homeDir,
  workspaceRoot,
  packageRoot,
  packageName,
  cliVersion,
  hasGlobalState = false,
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

  try {
    return await new Promise((resolve) => {
      const { waitUntilExit } = renderImpl(
        React.createElement(OrchestratorApp, {
          homeDir,
          workspaceRoot,
          packageRoot,
          packageName,
          cliVersion,
          hasGlobalState,
          onComplete: resolve
        }),
        stdout ? { stdout } : undefined
      );

      waitUntilExit().catch((error) => {
        resolve({ cancelled: true, error });
      });
    });
  } finally {
    if (ownsSession) {
      session.leave();
    }
  }
}
