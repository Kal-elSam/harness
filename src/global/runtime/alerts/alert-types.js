import { createHash, randomBytes } from "node:crypto";

export const ALERT_STATES = Object.freeze({
  OPEN: "open", RESOLVED: "resolved", DISMISSED: "dismissed"
});

export const ALERT_SEVERITIES = Object.freeze({
  HIGH: "high", MEDIUM: "medium", LOW: "low"
});

export function createAlertId() {
  return `alt-${randomBytes(12).toString("hex")}`;
}

export function assertSafeAlertId(alertId) {
  if (typeof alertId !== "string" || !/^alt-[a-f0-9]{16,32}$/.test(alertId)) {
    throw new Error(`Invalid alert id "${alertId}".`);
  }
}

/** Stable dedupe key — kind + source + title only (never payloads). */
export function createAlertFingerprint({ kind, source = null, title }) {
  return createHash("sha256")
    .update([kind, source ?? "", title].map(String).join("\0"))
    .digest("hex");
}

export function createAlert({
  alertId = createAlertId(),
  kind,
  severity = ALERT_SEVERITIES.MEDIUM,
  title,
  summary = "",
  source = null,
  state = ALERT_STATES.OPEN,
  createdAt = null,
  updatedAt = null,
  resolvedAt = null
} = {}) {
  assertSafeAlertId(alertId);
  const safeKind = String(kind ?? "").trim();
  const safeTitle = String(title ?? "").trim();
  if (!safeKind || !safeTitle) throw new Error("Alert kind and title are required.");
  const now = new Date().toISOString();
  return {
    version: 1,
    alertId,
    kind: safeKind,
    severity,
    title: safeTitle,
    summary: String(summary ?? "").trim(),
    source: source == null ? null : String(source),
    fingerprint: createAlertFingerprint({ kind: safeKind, source, title: safeTitle }),
    state,
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now,
    resolvedAt: resolvedAt ?? null
  };
}
