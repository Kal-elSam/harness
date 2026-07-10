import { createExecutionAdapter, parseNdjsonLine, buildPermissionsArgs } from "./create-execution-adapter.js";

const EXECUTABLE = "claude";

function buildClaudeLaunch({ task, cwd, model, permissions = [] }) {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    ...buildPermissionsArgs(permissions),
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

function parseClaudeEventLine(line) {
  const parsed = parseNdjsonLine(line);
  if (!parsed || typeof parsed !== "object") return null;

  if (parsed.type === "tool_use" || parsed.type === "tool_call") {
    return {
      type: "tool_call",
      tool_name: parsed.name ?? parsed.tool ?? "unknown",
      status: parsed.status ?? "started"
    };
  }

  if (parsed.type === "usage" || parsed.usage) {
    const usage = parsed.usage ?? parsed;
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
  id: "claude",
  label: "Claude Code",
  executable: EXECUTABLE,
  capabilities: {
    structuredEvents: true,
    tokens: true,
    diff: false,
    cancel: true,
    transcript: true
  },
  buildLaunch: buildClaudeLaunch,
  parseEventLine: parseClaudeEventLine
});
