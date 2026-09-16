import { RUN_EVENT_TYPES } from "./run-types.js";
import { redactObject } from "./run-redact.js";

export function createRunEvent({
  runId,
  type,
  source = "kairo",
  data = {},
  captureTranscript = false
}) {
  return {
    timestamp: new Date().toISOString(),
    runId,
    type,
    source,
    data: sanitizeEventData(data, { captureTranscript })
  };
}

export function sanitizeEventData(data, { captureTranscript = false } = {}) {
  const allowTranscript = captureTranscript === true;
  return redactObject(data, { allowTranscript });
}

export function normalizeAdapterEvent(adapterId, raw, { captureTranscript = false } = {}) {
  if (raw == null) return null;

  if (typeof raw === "object" && raw.type && raw.runId) {
    return {
      ...raw,
      data: sanitizeEventData(raw.data ?? {}, { captureTranscript })
    };
  }

  if (typeof raw === "object" && raw.type) {
    return mapStructuredEvent(adapterId, raw, { captureTranscript });
  }

  if (typeof raw === "string") {
    return {
      timestamp: new Date().toISOString(),
      type: RUN_EVENT_TYPES.STDOUT,
      source: adapterId,
      data: sanitizeEventData({ line: raw }, { captureTranscript })
    };
  }

  return null;
}

function mapStructuredEvent(adapterId, raw, { captureTranscript }) {
  const base = {
    timestamp: new Date().toISOString(),
    source: adapterId,
    data: sanitizeEventData(extractEventData(raw), { captureTranscript })
  };

  switch (raw.type) {
    case "system":
      return { ...base, type: RUN_EVENT_TYPES.SYSTEM };
    case "assistant":
      return { ...base, type: RUN_EVENT_TYPES.ASSISTANT };
    case "tool_call":
      return { ...base, type: RUN_EVENT_TYPES.TOOL_CALL };
    case "tool_result":
      return { ...base, type: RUN_EVENT_TYPES.TOOL_RESULT };
    case "result":
      return { ...base, type: RUN_EVENT_TYPES.RESULT };
    case "token_usage":
    case "usage":
      return { ...base, type: RUN_EVENT_TYPES.TOKEN_USAGE };
    case "diff":
    case "diff_summary":
      return { ...base, type: RUN_EVENT_TYPES.DIFF_SUMMARY };
    default:
      return {
        ...base,
        type: RUN_EVENT_TYPES.SYSTEM,
        data: sanitizeEventData({ rawType: raw.type, payload: extractEventData(raw) }, { captureTranscript })
      };
  }
}

function extractEventData(raw) {
  const { type: _type, ...rest } = raw;
  return rest;
}

export function applyEventToMetadata(metadata, event) {
  const next = { ...metadata, updatedAt: event.timestamp ?? new Date().toISOString() };

  switch (event.type) {
    case RUN_EVENT_TYPES.TOOL_CALL: {
      const tool = event.data?.tool_name ?? event.data?.name ?? event.data?.tool ?? event.data?.toolName ?? "unknown";
      if (!next.tools.includes(tool)) {
        next.tools = [...next.tools, tool];
      }
      break;
    }
    case RUN_EVENT_TYPES.STDERR:
    case RUN_EVENT_TYPES.STDOUT: {
      const command = event.data?.command;
      if (command && !next.commands.includes(command)) {
        next.commands = [...next.commands, command];
      }
      break;
    }
    case RUN_EVENT_TYPES.TOKEN_USAGE: {
      next.tokenUsage = {
        input: event.data?.inputTokens ?? event.data?.input ?? next.tokenUsage?.input ?? null,
        output: event.data?.outputTokens ?? event.data?.output ?? next.tokenUsage?.output ?? null,
        total: event.data?.totalTokens ?? event.data?.total ?? next.tokenUsage?.total ?? null
      };
      if (event.data?.cost != null) {
        next.cost = event.data.cost;
      }
      break;
    }
    case RUN_EVENT_TYPES.DIFF_SUMMARY: {
      next.diffSummary = {
        filesChanged: event.data?.filesChanged ?? event.data?.files ?? null,
        insertions: event.data?.insertions ?? null,
        deletions: event.data?.deletions ?? null
      };
      break;
    }
    default:
      break;
  }

  return next;
}

/**
 * Best-effort real human-readable text out of a real "run.transcript"
 * event's own `data` — the shape varies by adapter (Codex/Claude each pass
 * their own CLI's raw JSON event through mostly as-is, see each adapter's
 * own parseEventLine), so this tries the common real shapes in order
 * (flat string, `text`, `content` as a string or an Anthropic-style
 * content-block array, a nested `message`, `result`) and only ever falls
 * back to a raw JSON dump when none of those match — it never silently
 * drops a real event's content just because its exact shape wasn't
 * anticipated.
 * @param {unknown} data
 * @returns {string}
 */
export function formatTranscriptEventText(data) {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data !== "object") return String(data);
  if (typeof data.text === "string") return data.text;
  if (typeof data.content === "string") return data.content;
  if (Array.isArray(data.content)) {
    const text = data.content
      .filter((block) => block && typeof block === "object" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
    if (text) return text;
  }
  if (data.message && typeof data.message === "object") {
    const nested = formatTranscriptEventText(data.message);
    if (nested) return nested;
  }
  if (typeof data.result === "string") return data.result;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export function transitionRunState(metadata, nextState, { exitCode = null, error = null } = {}) {
  const now = new Date().toISOString();
  return {
    ...metadata,
    state: nextState,
    exitCode: exitCode ?? metadata.exitCode,
    error: error ?? metadata.error,
    updatedAt: now,
    completedAt: now
  };
}
