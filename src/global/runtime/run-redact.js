import { isForbiddenSecretKey, normalizeProfileKey } from "../profile.js";

const REDACTED = "[REDACTED]";

const SECRET_VALUE_PATTERN = /^(sk-[A-Za-z0-9]|sk-or-|gh[pousr]_|xox[baprs]-|AKIA[0-9A-Z]{16}\b|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.)|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

const SENSITIVE_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "CURSOR_API_KEY",
  "OPENROUTER_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID"
]);

export function redactString(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  if (SECRET_VALUE_PATTERN.test(value)) return REDACTED;
  return value;
}

export function redactObject(value, { allowTranscript = false } = {}) {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item, { allowTranscript }));
  }
  if (typeof value !== "object") return value;

  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = normalizeProfileKey(key);

    if (!allowTranscript && (normalizedKey === "prompt" || normalizedKey === "response" || normalizedKey === "content")) {
      result[key] = REDACTED;
      continue;
    }

    if (isForbiddenSecretKey(key) || SENSITIVE_ENV_KEYS.has(key)) {
      result[key] = REDACTED;
      continue;
    }

    result[key] = redactObject(nested, { allowTranscript });
  }

  return result;
}

export function redactEnv(env = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (SENSITIVE_ENV_KEYS.has(key) || isForbiddenSecretKey(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function shouldPersistTranscript(captureTranscript) {
  return captureTranscript === true;
}
