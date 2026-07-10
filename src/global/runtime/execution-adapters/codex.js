import { createExecutionAdapter, parseNdjsonLine } from "./create-execution-adapter.js";

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

  return [];
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
    transcript: true
  },
  buildLaunch: buildCodexLaunch,
  parseEventLine: parseCodexEventLine
});
