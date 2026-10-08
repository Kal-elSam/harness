/**
 * Shared primitives for the conversation operations layer: the free-text
 * scrubber (credentials + absolute paths, capped), the scalar guard and the
 * typed operation error. Kept dependency-light so the read, delegation and
 * setup operations can all use them without import cycles.
 */
import { redactSecrets } from "./secret-scanner.js";

const MAX_TEXT = 500;
const CREDENTIAL_RES = [
  /\bauthorization\s*[:=]\s*(?:bearer\s+)?\S+/gi,
  /\bbearer\s+\S+/gi,
  /\b(?:token|secret|password|passwd|api[_-]?key|credential|auth[_-]?key)s?\s*[:=]\s*\S+/gi
];
const PATH_RES = [
  /[A-Za-z]:\\[^\s"'`]+/g,
  /(?<![\w/.:])~?(?:\/[^\s/"'`]+){2,}/g,
  /(?<![\w/.:])\/(?:Users|home|tmp|var|etc|private|opt|root)\b/g
];

/** Free text from the service: redact credentials and absolute paths, cap length. */
export function safeText(value) {
  if (typeof value !== "string") return null;
  let text = value;
  for (const re of CREDENTIAL_RES) text = text.replace(re, "[redacted]");
  for (const re of PATH_RES) text = text.replace(re, "[path]");
  text = redactSecrets(text).text.replace(/\s+/g, " ").trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}...` : text;
}

export const scalar = (v) => (v === null || ["string", "number", "boolean"].includes(typeof v) ? v : null);
export const id = (v) => (typeof v === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(v) ? v : null);

/** Typed operation failure; `code` is the stable public code. */
export class ConversationOperationError extends Error {
  constructor(code) { super(code); this.name = "ConversationOperationError"; this.code = code; }
}
