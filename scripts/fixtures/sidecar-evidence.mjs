/**
 * Evidence helpers for the transparent sidecar tee.
 *
 * The wrapper sidecar copies every stdout byte it sends to the Ratatui host
 * into `sidecar.jsonl` (host-visible bytes are never altered) and writes a
 * separate, secret-redacted `sidecar.stderr.log`. Harnesses then parse
 * `sidecar.jsonl` to assert on real protocol records (`ready`, `engine`, ...)
 * instead of screen text.
 */
import { appendFileSync } from "node:fs";
import { redactText } from "../../src/global/runtime/run-redact.js";

export const SIDECAR_JSONL = "sidecar.jsonl";
export const SIDECAR_STDERR_LOG = "sidecar.stderr.log";

/**
 * Wrap a stdout-like sink. Bytes go downstream first and unchanged; the same
 * bytes are then appended to `jsonlPath`. Evidence failures are swallowed so
 * the tee can never break or contaminate the host-visible stream.
 *
 * @param {{ write: (chunk: any) => any }} sink
 * @param {string} jsonlPath
 */
export function createStdoutTee(sink, jsonlPath) {
  return {
    write(chunk, ...rest) {
      const result = sink.write(chunk, ...rest);
      try {
        appendFileSync(jsonlPath, typeof chunk === "string" ? chunk : Buffer.from(chunk));
      } catch {
        // evidence only
      }
      return result;
    }
  };
}

/**
 * Append-only stderr log with credentials redacted (`redactText`). Each
 * `write` is redacted as one unit, so secrets are never persisted verbatim.
 * @param {string} logPath
 */
export function createRedactedStderrLog(logPath) {
  return {
    write(chunk) {
      try {
        appendFileSync(logPath, redactText(String(chunk)));
      } catch {
        // evidence only
      }
      return true;
    }
  };
}

/**
 * Parse JSONL text. Blank lines are ignored; malformed lines (including a
 * truncated trailing line) are counted, never thrown.
 * @param {string} text
 * @returns {{ records: object[], malformed: number }}
 */
export function parseJsonl(text) {
  const records = [];
  let malformed = 0;
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") records.push(value);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { records, malformed };
}

/** @param {object[]} records */
export function findReady(records) {
  return records.find((record) => record?.type === "ready") ?? null;
}

/**
 * @param {object[]} records
 * @param {string} type
 */
export function recordsOfType(records, type) {
  return records.filter((record) => record?.type === type);
}
