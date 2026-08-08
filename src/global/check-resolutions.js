/**
 * Stable resolution contract for doctor/status checks.
 * Panels render these as buttons; commands stay consent-gated in the CLI.
 */
export function resolution(id, label, command, {
  kind = "run",
  safety = "consent",
  detail = ""
} = {}) {
  return {
    id: String(id),
    label: String(label),
    command: command == null ? null : String(command),
    kind: String(kind),
    safety: String(safety),
    detail: detail == null ? "" : String(detail)
  };
}

export const RESOLUTION_SAFETY = Object.freeze({
  READ_ONLY: "read-only",
  CONSENT: "consent",
  DESTRUCTIVE: "destructive"
});

export const RESOLUTION_KIND = Object.freeze({
  RUN: "run",
  CONFIGURE: "configure",
  GUIDE: "guide",
  REFRESH: "refresh"
});
