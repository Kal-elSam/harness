import { createExecutionAdapter } from "./create-execution-adapter.js";

const EXECUTABLE = "opencode";

function buildOpencodeLaunch({ task, cwd, model, permissions = [] }) {
  const args = ["run", task];

  if (model) {
    args.unshift("--model", model);
  }

  if (permissions.includes("force") || permissions.includes("all")) {
    args.unshift("--force");
  }

  return {
    command: EXECUTABLE,
    args,
    cwd,
    env: process.env
  };
}

export default createExecutionAdapter({
  id: "opencode",
  label: "OpenCode",
  executable: EXECUTABLE,
  launchable: false,
  capabilities: {
    structuredEvents: false,
    tokens: false,
    diff: false,
    cancel: true,
    transcript: false
  },
  buildLaunch: buildOpencodeLaunch,
  parseEventLine: null
});
