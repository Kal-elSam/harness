import { CONTROL_PLANE_HEALTH } from "../control-plane-snapshot.js";

export function buildControlCenterModel({
  projectName = "project",
  snapshot = null,
  layoutMode = "compact"
} = {}) {
  if (!snapshot) {
    return {
      title: `CONTROL CENTER — ${projectName}`,
      purpose: "Kairo aligns installed IDEs and agents with this project's architecture, rules, tools, and workflows.",
      health: {
        kind: CONTROL_PLANE_HEALTH.CHECK_FAILED,
        label: "CHECK FAILED",
        summaryLine: "Control-plane scan not available yet."
      },
      coverageLines: [],
      cta: {
        title: "NEXT",
        actionTitle: "Retry scan",
        actionDetail: "Press R to reload the read-only governance scan.",
        enterHint: "R Retry",
        kind: "verify",
        destination: null
      },
      notes: [],
      includeEmbeddedStatus: layoutMode !== "wide"
    };
  }

  const healthLabel = formatHealthLabel(snapshot.health);
  const coverage = snapshot.coverage ?? {};
  const policy = snapshot.policy;
  const warnings = snapshot.status?.counts?.warning ?? 0;

  return {
    title: `CONTROL CENTER — ${projectName}`,
    purpose: "Kairo aligns installed IDEs and agents with this project's architecture, rules, tools, and workflows.",
    health: {
      kind: snapshot.health,
      label: healthLabel,
      summaryLine: [
        `${coverage.governedAgents ?? 0}/${coverage.detectedAgents ?? 0} agents governed`,
        `${coverage.components ?? 0} modules`,
        `${snapshot.backups?.count ?? 0} backups`
      ].join(" · ")
    },
    coverageLines: [
      `Active modules: ${(coverage.activeModules ?? []).join(", ") || "none"}`,
      `Policy: ${policy?.profile ?? "none"} · applyMode ${policy?.applyMode ?? "n/a"}`,
      warnings > 0
        ? `Notes: ${warnings} non-blocking check warning(s)`
        : "Notes: none",
      snapshot.diff?.hasChanges
        ? `Drift: ${snapshot.diff.changeCount ?? snapshot.diff.changes?.length ?? 0} change(s) pending review`
        : "Drift: clean"
    ],
    cta: {
      title: "NEXT",
      actionTitle: snapshot.cta?.title ?? "Review control plane",
      actionDetail: snapshot.cta?.detail ?? "",
      enterHint: "Enter →",
      kind: snapshot.cta?.kind ?? null,
      destination: snapshot.cta?.destination ?? null
    },
    notes: buildNotes(snapshot),
    includeEmbeddedStatus: layoutMode !== "wide",
    runsSecondaryHint: "Runs remain available as a secondary capability after setup and repairs."
  };
}

function formatHealthLabel(kind) {
  switch (kind) {
    case CONTROL_PLANE_HEALTH.NOT_CONFIGURED:
      return "NOT CONFIGURED";
    case CONTROL_PLANE_HEALTH.ACTION_REQUIRED:
      return "ACTION REQUIRED";
    case CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES:
      return "HEALTHY WITH NOTES";
    case CONTROL_PLANE_HEALTH.HEALTHY:
      return "HEALTHY";
    case CONTROL_PLANE_HEALTH.CHECK_FAILED:
      return "CHECK FAILED";
    default:
      return String(kind ?? "UNKNOWN");
  }
}

function buildNotes(snapshot) {
  const notes = [];
  for (const check of snapshot.status?.checks ?? []) {
    if (check.status === "warning") {
      notes.push(`${check.name}: ${check.detail ?? check.status}`);
    }
  }
  if (notes.length === 0 && snapshot.health === CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES) {
    notes.push("Non-blocking notes are present. Open IDEs & models or Harness modules for detail.");
  }
  return notes.slice(0, 6);
}
