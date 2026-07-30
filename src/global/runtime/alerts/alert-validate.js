import {
  ALERT_SEVERITIES,
  ALERT_STATES,
  assertSafeAlertId,
  createAlertFingerprint
} from "./alert-types.js";

export const ALERT_VALIDATION_ERROR_CODES = Object.freeze({
  INVALID_ALERT: "invalid_alert",
  FORBIDDEN_FIELD: "forbidden_field",
  FINGERPRINT_MISMATCH: "fingerprint_mismatch"
});

const SEVERITY_SET = new Set(Object.values(ALERT_SEVERITIES));
const STATE_SET = new Set(Object.values(ALERT_STATES));
const FORBIDDEN_KEYS = new Set([
  "prompt", "diff", "transcript", "raw", "rawOutput", "stdout", "stderr",
  "output", "message", "messages", "content", "secret", "secrets", "token", "apiKey"
]);
const ALLOWED = new Set([
  "version", "alertId", "kind", "severity", "title", "summary",
  "source", "fingerprint", "state", "createdAt", "updatedAt", "resolvedAt"
]);

export class AlertValidationError extends Error {
  constructor(message, { code, details = null } = {}) {
    super(message);
    this.name = "AlertValidationError";
    this.code = code;
    this.details = details;
  }
}

function assertNoForbiddenKeys(value, label) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item, label);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new AlertValidationError(`Forbidden field "${key}" in ${label}.`, {
        code: ALERT_VALIDATION_ERROR_CODES.FORBIDDEN_FIELD,
        details: { key, label }
      });
    }
    assertNoForbiddenKeys(child, `${label}.${key}`);
  }
}

function requireString(alert, key, { allowEmpty = false } = {}) {
  const value = alert[key];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new AlertValidationError(`Invalid alert.${key}: expected string.`, {
      code: ALERT_VALIDATION_ERROR_CODES.INVALID_ALERT,
      details: { key }
    });
  }
  return value;
}

/** Fail-closed scalar schema + recursive secret scan + derived fingerprint. */
export function assertAlertSecretFree(alert) {
  if (!alert || typeof alert !== "object" || Array.isArray(alert)) {
    throw new AlertValidationError("Invalid alert: expected object.", {
      code: ALERT_VALIDATION_ERROR_CODES.INVALID_ALERT
    });
  }
  assertNoForbiddenKeys(alert, "alert");
  for (const key of Object.keys(alert)) {
    if (!ALLOWED.has(key)) {
      throw new AlertValidationError(`Unknown field "${key}" in alert.`, {
        code: ALERT_VALIDATION_ERROR_CODES.FORBIDDEN_FIELD,
        details: { key }
      });
    }
  }
  if (typeof alert.version !== "number" || !Number.isFinite(alert.version)) {
    throw new AlertValidationError("Invalid alert.version.", {
      code: ALERT_VALIDATION_ERROR_CODES.INVALID_ALERT
    });
  }
  assertSafeAlertId(requireString(alert, "alertId"));
  requireString(alert, "kind");
  requireString(alert, "title");
  requireString(alert, "summary", { allowEmpty: true });
  requireString(alert, "fingerprint");
  requireString(alert, "createdAt");
  requireString(alert, "updatedAt");
  if (!(alert.source === null || typeof alert.source === "string")) {
    throw new AlertValidationError("Invalid alert.source.", {
      code: ALERT_VALIDATION_ERROR_CODES.INVALID_ALERT
    });
  }
  if (!(alert.resolvedAt === null || typeof alert.resolvedAt === "string")) {
    throw new AlertValidationError("Invalid alert.resolvedAt.", {
      code: ALERT_VALIDATION_ERROR_CODES.INVALID_ALERT
    });
  }
  if (!SEVERITY_SET.has(alert.severity) || !STATE_SET.has(alert.state)) {
    throw new AlertValidationError("Unknown alert severity or state.", {
      code: ALERT_VALIDATION_ERROR_CODES.INVALID_ALERT
    });
  }
  const expected = createAlertFingerprint({
    kind: alert.kind,
    source: alert.source,
    title: alert.title
  });
  if (alert.fingerprint !== expected) {
    throw new AlertValidationError("Alert fingerprint does not match kind+source+title.", {
      code: ALERT_VALIDATION_ERROR_CODES.FINGERPRINT_MISMATCH,
      details: { expected }
    });
  }
  return alert;
}
