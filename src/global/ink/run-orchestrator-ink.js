import React from "react";
import { render } from "ink";
import { OrchestratorApp } from "./orchestrator-app.js";

export async function runOrchestratorInk({
  homeDir,
  workspaceRoot,
  packageRoot,
  packageName,
  cliVersion,
  renderImpl = render
}) {
  return new Promise((resolve) => {
    const { waitUntilExit } = renderImpl(
      React.createElement(OrchestratorApp, {
        homeDir,
        workspaceRoot,
        packageRoot,
        packageName,
        cliVersion,
        onComplete: resolve
      })
    );

    waitUntilExit().catch((error) => {
      resolve({ cancelled: true, error });
    });
  });
}
