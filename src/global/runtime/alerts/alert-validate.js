import { ALERT_SEVERITIES, ALERT_STATES, assertSafeAlertId } from "./alert-types.js";

export const ALERT_VALIDATION_ERROR_CODES = Object.freeze({
  INVALID_ALERT: "invalid_alert",
  FORBIDDEN_FIELD: "forbidden_field"
});

const SEVERITY_SET = new Set(Object.values(ALERT_SEVERITIES));
const STATE_SET = new Set(Object.values(ALERT_STATES));
const FORBIDDEN_KEYS = new Set([
  "prompt", "diff", "transcript", "raw", "rawOutput", "stdout", "stderr",
  "output", "message", "messages", "content", "secret", "secrets", "token", "apiKey"
]);
const REQUIRED = [
  "version", "alertId", "kind", "severity", "title", "summary",
  "fingerprint", "state", "createdAt", "updatedAt"
];

export class AlertValidationError extends Error {
  constructor(message, { code, details = null } = {}) {
    super(message);
    this.name = "AlertValidationError";
    this.code = code;
    this.details = details;
  }
}

/** Fail-closed: no prompts/secrets/raw stdout; allowlisted fields only. */
export function assertAlertSecretFree(alert) {
  if (!alert || typeof alert !== "object" || Array.isArray(alert)) {
    throw new AlertValidationError("Invalid alert: expected object.", {
      code: ALERT_VALIDATION_ERROR_CODES.INVALID_ALERT
    });
  }
  for (const key of Object.keys(alert)) {
    if (FORBIDDEN_KEYS.has(key) || ![...REQUIRED, "source", "resolvedAt"].includes(key)) {
      throw new AlertValidationError(`Forbidden field "${key}" in alert.`, {
        code: ALERT_VALIDATION_ERROR_CODES.FORBIDDEN_FIELD,
        details: { key }
      });
    }
  }
  for (const key of REQUIRED) {
    if (!(key in alert) || alert[key] == null) {
      throw new AlertValidationError(`Missing alert.${key}.`, {
        code: ALERT_VALIDATION_ERROR_CODES.INVALID_ALERT
      });
    }
  }
  if (typeof alert.kind !== "string" || !alert.kind.trim()
    || typeof alert.title !== "string" || !alert.title.trim()
    || typeof alert.fingerprint !== "string" || !alert.fingerprint.trim()) {
    throw new AlertValidationError("Alert kind, title, and fingerprint are required.", {
      code: ALERT_VALIDATION_ERROR_CODES.INVALID_ALERT
    });
  }
  assertSafeAlertId(alert.alertId);
  if (!SEVERITY_SET.has(alert.severity) || !STATE_SET.has(alert.state)) {
    throw new AlertValidationError("Unknown alert severity or state.", {
      code: ALERT_VALIDATION_ERROR_CODES.INVALID_ALERT
    });
  }
  return alert;
}
