import { ALERT_STATES } from "../runtime/alerts/alert-types.js";

export function formatAlertsHeadline(alerts = null) {
  if (alerts == null) return { count: null, headline: "Alert data unavailable" };
  const count = alerts.filter((alert) => alert.state === ALERT_STATES.OPEN).length;
  return { count, headline: count === 0 ? "None pending" : `${count} pending` };
}

export function formatAlertListLines(alerts = null) {
  if (alerts == null) return ["Alert data unavailable"];
  const open = alerts.filter((alert) => alert.state === ALERT_STATES.OPEN);
  if (open.length === 0) return ["No pending alerts."];
  return open.map((alert) => {
    const when = String(alert.createdAt ?? "").slice(0, 16).replace("T", " ");
    return `${alert.severity} · ${alert.title} · ${when || "unknown time"}`;
  });
}

export function formatAlertDetailLines(alert) {
  if (!alert) return ["Alert not found."];
  return [
    "SUMMARY",
    `${alert.severity} · ${alert.state} · ${alert.kind}`,
    alert.title,
    alert.summary || "No summary.",
    "",
    "DETAILS",
    `Id · ${alert.alertId}`,
    `Source · ${alert.source ?? "n/a"} · Created · ${alert.createdAt ?? "n/a"}`
  ];
}

export function selectAlertFromList(alerts = null, index = 0) {
  if (!Array.isArray(alerts)) return null;
  return alerts.filter((alert) => alert.state === ALERT_STATES.OPEN)[index] ?? null;
}
