import { createExecutionAdapter, parseNdjsonLine, buildPermissionsArgs } from "./create-execution-adapter.js";
import { isExecutableAvailable } from "../../cli-probe.js";

const EXECUTABLE = "cursor-agent";

function checkCursorAvailability() {
  const agentAvailable = isExecutableAvailable(EXECUTABLE);
  if (!agentAvailable) {
    const legacy = isExecutableAvailable("cursor");
    if (!legacy) {
      return {
        available: false,
        compatible: false,
        launchable: false,
        reason: 'Cursor agent CLI "cursor-agent" is not on PATH. Install Cursor CLI.'
      };
    }
    return {
      available: true,
      compatible: false,
      launchable: false,
      reason: 'Found "cursor" but Kairo v1 requires "cursor-agent" for auditable non-interactive runs.'
    };
  }

  return {
    available: true,
    compatible: true,
    launchable: true,
    reason: null
  };
}

function buildCursorLaunch({ task, cwd, model, permissions = [] }) {
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

function parseCursorEventLine(line) {
  const parsed = parseNdjsonLine(line);
  if (!parsed || typeof parsed !== "object") return null;

  if (parsed.type === "assistant" && parsed.timestamp_ms == null && parsed.model_call_id) {
    return null;
  }

  if (parsed.type === "assistant" && parsed.timestamp_ms == null && !parsed.model_call_id) {
    return null;
  }

  if (parsed.type === "tool_call") {
    const toolName = parsed.tool_name ?? parsed.name ?? parsed.tool ?? "unknown";
    return {
      type: "tool_call",
      tool_name: toolName,
      status: parsed.subtype ?? parsed.status ?? "started",
      id: parsed.call_id ?? parsed.id ?? null
    };
  }

  if (parsed.type === "result" && parsed.usage) {
    return {
      type: "usage",
      inputTokens: parsed.usage.input_tokens ?? parsed.usage.inputTokens ?? null,
      outputTokens: parsed.usage.output_tokens ?? parsed.usage.outputTokens ?? null,
      totalTokens: parsed.usage.total_tokens ?? parsed.usage.totalTokens ?? null,
      cost: parsed.usage.cost ?? parsed.cost ?? null
    };
  }

  return parsed;
}

export default createExecutionAdapter({
  id: "cursor",
  label: "Cursor",
  executable: EXECUTABLE,
  capabilities: {
    structuredEvents: true,
    tokens: true,
    diff: false,
    cancel: true,
    transcript: true
  },
  checkAvailability: checkCursorAvailability,
  buildLaunch: buildCursorLaunch,
  parseEventLine: parseCursorEventLine
});
