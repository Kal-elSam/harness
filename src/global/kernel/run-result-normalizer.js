import { createWorkResult } from "./contracts.js";
import { RUN_STATES } from "../runtime/run-types.js";

const TRANSCRIPT_EVENT = "run.transcript";
const NO_SUMMARY_ERROR = "no summary produced";
const NO_RECORDED_ERROR = "Run failed without a recorded error.";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Real text of one transcript payload, or "". Deliberately narrower than
 * formatTranscriptEventText: that helper falls back to JSON.stringify, which
 * would turn a usage/metadata dump into a fake "summary".
 */
function realTranscriptText(data) {
  if (data == null || typeof data !== "object") return "";
  if (typeof data.text === "string") return data.text.trim();
  if (typeof data.content === "string") return data.content.trim();
  if (Array.isArray(data.content)) {
    return data.content
      .filter((block) => block != null && typeof block === "object" && block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("")
      .trim();
  }
  if (typeof data.result === "string") return data.result.trim();
  return "";
}

function lastTranscriptSummary(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event != null && typeof event === "object" && event.type === TRANSCRIPT_EVENT) {
      return realTranscriptText(event.data);
    }
  }
  return "";
}

function failed(runId, error, summary = null) {
  return createWorkResult({ ok: false, workerId: runId, status: "failed", summary, error });
}

/**
 * Pure mapping of a finished run's final metadata + events to a WorkResult.
 * Reads nothing, writes nothing, cancels nothing: a "cancelled" result reports
 * run state only and does not prove the OS process died. Only an invalid runId
 * throws; every later problem becomes a failed WorkResult keeping the runId.
 */
export function normalizeRunResult({ runId, metadata, events } = {}) {
  if (!nonEmptyString(runId)) {
    throw new Error("normalizeRunResult requires a non-empty runId.");
  }
  if (metadata == null || typeof metadata !== "object") {
    return failed(runId, "Run metadata is missing or not an object.");
  }
  if (!Array.isArray(events)) {
    return failed(runId, "Run events are missing or not an array.");
  }

  const summary = lastTranscriptSummary(events) || null;

  switch (metadata.state) {
    case RUN_STATES.COMPLETED:
      return summary
        ? createWorkResult({ ok: true, workerId: runId, status: "completed", summary })
        : failed(runId, NO_SUMMARY_ERROR);
    case RUN_STATES.FAILED:
      return failed(runId, nonEmptyString(metadata.error) ? metadata.error : NO_RECORDED_ERROR, summary);
    case RUN_STATES.CANCELLED:
      return createWorkResult({ ok: false, workerId: runId, status: "cancelled", summary });
    default:
      return failed(runId, `Run ended in unexpected state "${String(metadata.state)}".`, summary);
  }
}
