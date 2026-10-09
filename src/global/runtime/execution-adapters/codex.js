import { createExecutionAdapter, parseNdjsonLine } from "./create-execution-adapter.js";
import { verifyCodexSubscriptionAuth } from "../../architect/architect-codex.js";

const EXECUTABLE = "codex";

function buildCodexPermissionsArgs(permissions = []) {
  const normalized = new Set(permissions.map((entry) => String(entry).toLowerCase()));

  if (
    normalized.has("yolo")
    || normalized.has("dangerously-skip-permissions")
    || normalized.has("dangerously-bypass-approvals-and-sandbox")
  ) {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }

  // Safe headless default for the *installed* Codex CLI:
  // `--approve-for-me` alone selects the workspace-write sandbox and
  // auto-reviews approvals (non-interactive). Combining
  // `--sandbox workspace-write` with `--approve-for-me` is rejected by
  // the real parser (`cannot be used with`). This flag fix is CLI
  // compatibility only — not verified_effective containment.
  return ["--approve-for-me"];
}

function buildCodexLaunch({ task, cwd, model, permissions = [] }) {
  const args = [
    "exec",
    "--json",
    ...buildCodexPermissionsArgs(permissions),
    task
  ];

  if (model) {
    args.unshift("--model", model);
  }

  return {
    command: EXECUTABLE,
    args,
    cwd,
    env: process.env
  };
}

function parseCodexEventLine(line) {
  const parsed = parseNdjsonLine(line);
  if (!parsed || typeof parsed !== "object") return null;

  if (parsed.type === "tool" || parsed.type === "tool_call") {
    return {
      type: "tool_call",
      tool_name: parsed.tool ?? parsed.name ?? "unknown",
      status: parsed.status ?? "started"
    };
  }

  if (parsed.usage || parsed.token_usage) {
    const usage = parsed.usage ?? parsed.token_usage;
    return {
      type: "usage",
      inputTokens: usage.input_tokens ?? usage.input ?? null,
      outputTokens: usage.output_tokens ?? usage.output ?? null,
      totalTokens: usage.total_tokens ?? usage.total ?? null,
      cost: usage.cost ?? null
    };
  }

  return parsed;
}

export default createExecutionAdapter({
  id: "codex",
  label: "Codex",
  executable: EXECUTABLE,
  capabilities: {
    structuredEvents: true,
    tokens: true,
    diff: false,
    cancel: true,
    transcript: true,
    reviewCompatible: true,
    permissionModes: ["yolo"]
  },
  buildLaunch: buildCodexLaunch,
  parseEventLine: parseCodexEventLine,
  preflight: verifyCodexSubscriptionAuth
});
