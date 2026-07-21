import { createExecutionAdapter, parseNdjsonLine } from "./create-execution-adapter.js";
import { isExecutableAvailable, probeCommand } from "../../cli-probe.js";

const EXECUTABLE = "pi";
const READ_ONLY_TOOLS = "read,grep,find,ls";

const LIFECYCLE_KINDS = new Set([
  "session",
  "agent_start",
  "agent_end",
  "turn_start",
  "message_start",
  "message_update",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "queue_update",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished"
]);

export function buildPiPermissionsArgs(permissions = []) {
  if (!Array.isArray(permissions) || permissions.length === 0) return [];

  const normalized = [...new Set(permissions.map((entry) => String(entry).toLowerCase()))];
  if (normalized.length === 1 && normalized[0] === "read-only") {
    return ["--tools", READ_ONLY_TOOLS];
  }

  throw new Error(
    `Pi permissions only support "read-only" in Kairo 0.6.0 (got: ${permissions.join(", ")}). `
    + "Other aliases are rejected and are never translated to --approve."
  );
}

export function buildPiLaunch({ task, cwd, model, permissions = [], env = process.env } = {}) {
  const args = [
    "--mode",
    "json",
    "--no-session",
    ...buildPiPermissionsArgs(permissions)
  ];

  if (model) {
    args.push("--model", model);
  }

  args.push(task);

  return {
    command: EXECUTABLE,
    args,
    cwd,
    env
  };
}

export function checkPiAvailability(context = {}) {
  const env = context.env ?? process.env;
  const probe = context.probeImpl ?? probeCommand;
  const availableCheck = context.isAvailableImpl ?? isExecutableAvailable;

  if (!availableCheck(EXECUTABLE, { env })) {
    return {
      available: false,
      compatible: false,
      launchable: false,
      reason: 'Pi CLI "pi" is not on PATH.'
    };
  }

  const help = probe(EXECUTABLE, ["--help"], { env, timeoutMs: 5000 });
  const text = `${help.stdout ?? ""}\n${help.stderr ?? ""}`;
  const hasMode = /--mode\b/.test(text);
  const hasNoSession = /--no-session\b/.test(text);

  if (!help.ok || !hasMode || !hasNoSession) {
    return {
      available: true,
      compatible: false,
      launchable: false,
      reason: "Pi CLI is missing required --mode / --no-session flags for auditable JSON runs."
    };
  }

  return {
    available: true,
    compatible: true,
    launchable: true,
    reason: null
  };
}

export function parsePiEventLine(line) {
  const parsed = parseNdjsonLine(line);
  if (!parsed || typeof parsed !== "object") return null;

  if (parsed.type === "tool_execution_start") {
    return {
      type: "tool_call",
      tool_name: parsed.toolName ?? "unknown",
      status: "started",
      id: parsed.toolCallId ?? null
    };
  }

  if (parsed.type === "tool_execution_end") {
    return {
      type: "tool_result",
      tool_name: parsed.toolName ?? "unknown",
      status: parsed.isError ? "error" : "completed",
      id: parsed.toolCallId ?? null
    };
  }

  if (parsed.type === "tool_execution_update") {
    return null;
  }

  if (parsed.type === "message_end") {
    if (parsed.message?.role !== "assistant") return null;
    return {
      type: "assistant",
      role: "assistant"
    };
  }

  if (parsed.type === "turn_end") {
    const usage = parsed.message?.usage;
    if (usage && typeof usage === "object") {
      return {
        type: "usage",
        inputTokens: usage.input ?? usage.inputTokens ?? usage.input_tokens ?? null,
        outputTokens: usage.output ?? usage.outputTokens ?? usage.output_tokens ?? null,
        totalTokens: usage.total ?? usage.totalTokens ?? usage.total_tokens ?? null,
        cost: usage.cost ?? null
      };
    }
    return { type: "system", kind: "turn_end" };
  }

  if (LIFECYCLE_KINDS.has(parsed.type)) {
    return {
      type: "system",
      kind: parsed.type,
      ...(parsed.reason ? { reason: parsed.reason } : {}),
      ...(parsed.attempt != null ? { attempt: parsed.attempt } : {})
    };
  }

  return {
    type: "system",
    kind: parsed.type ?? "unknown"
  };
}

export default createExecutionAdapter({
  id: "pi",
  label: "Pi",
  executable: EXECUTABLE,
  capabilities: {
    structuredEvents: true,
    tokens: true,
    diff: false,
    cancel: true,
    transcript: true
  },
  checkAvailability: checkPiAvailability,
  buildLaunch: buildPiLaunch,
  parseEventLine: parsePiEventLine
});
