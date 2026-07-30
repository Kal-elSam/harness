import { formatConfirmPath } from "./cockpit-path-label.js";

export const CHANGES_PHASE = Object.freeze({
  IDLE: "idle",
  PREVIEWING: "previewing",
  CONFIRMING: "confirming",
  APPLYING: "applying",
  COMPLETED: "completed",
  FAILED: "failed"
});

export function createChangesActionState() {
  return { phase: CHANGES_PHASE.IDLE, preview: null, receipt: null, error: null, message: null };
}

export function reduceChangesAction(state, action) {
  switch (action.type) {
    case "reset":
      return createChangesActionState();
    case "preview-start":
      return { ...createChangesActionState(), phase: CHANGES_PHASE.PREVIEWING, message: "Building exact preview…" };
    case "preview-ready":
      if (action.preview?.setupRequired) {
        return {
          ...createChangesActionState(),
          phase: CHANGES_PHASE.FAILED,
          error: "setup-required",
          message: "Not configured — open Control center and run setup. Changes never installs silently."
        };
      }
      if (!action.preview?.hasChanges) {
        return {
          ...createChangesActionState(),
          phase: CHANGES_PHASE.IDLE,
          preview: action.preview,
          message: "No pending governance changes."
        };
      }
      return {
        phase: CHANGES_PHASE.CONFIRMING,
        preview: action.preview,
        receipt: null,
        error: null,
        message: "Confirm apply? Y apply · N/Esc cancel"
      };
    case "preview-failed":
      return { ...state, phase: CHANGES_PHASE.FAILED, error: action.error ?? "preview-failed", message: action.message ?? "Preview failed." };
    case "apply-start":
      return { ...state, phase: CHANGES_PHASE.APPLYING, message: "Applying confirmed repairs…" };
    case "apply-done":
      return {
        phase: action.ok ? CHANGES_PHASE.COMPLETED : CHANGES_PHASE.FAILED,
        preview: action.preview ?? state.preview,
        receipt: action.receipt ?? null,
        error: action.ok ? null : (action.reason ?? "apply-failed"),
        message: action.message ?? (action.ok ? "Apply complete." : "Apply failed.")
      };
    case "cancel":
      return { ...createChangesActionState(), message: "Cancelled — no files written." };
    default:
      return state;
  }
}

function healthLabel(kind) {
  return String(kind ?? "unknown").replaceAll("_", " ");
}

/**
 * Governance surface: status, coverage, recommended action first.
 * Paths only when detail=true or during confirm (home-relative / distinct).
 */
export function formatChangesActionLines({
  snapshot,
  changesAction,
  detail = false,
  homeDir = null
} = {}) {
  const phase = changesAction?.phase ?? CHANGES_PHASE.IDLE;
  const coverage = snapshot?.coverage ?? {};
  const diff = snapshot?.diff;
  const cta = snapshot?.cta;
  const pending = diff?.hasChanges
    ? (diff.changeCount ?? diff.changes?.length ?? 0)
    : 0;
  const lines = [
    "STATUS",
    `${healthLabel(snapshot?.health)}${pending > 0 ? ` · ${pending} pending` : " · drift clean"}`,
    "",
    "COVERAGE",
    `${coverage.governedAgents ?? 0}/${coverage.detectedAgents ?? 0} agents governed · ${coverage.components ?? 0} components`,
    "",
    "NEXT",
    cta?.title ?? "Review governance when ready"
  ];
  if (cta?.detail) lines.push(cta.detail);

  if (changesAction?.message) lines.push("", changesAction.message);
  if (changesAction?.error && changesAction.error !== "setup-required") {
    lines.push(`Error: ${changesAction.error}`);
  }

  const preview = changesAction?.preview;
  const planned = preview?.hasChanges
    ? (preview.changes ?? [])
    : (diff?.hasChanges && !preview ? (diff.changes ?? []) : []);
  if (planned.length > 0) {
    lines.push("", `${planned.length} planned change(s)`);
    const showDetail = detail || phase === CHANGES_PHASE.CONFIRMING;
    if (showDetail) {
      lines.push("DETAILS");
      const limit = detail ? 12 : 3;
      for (const change of planned.slice(0, limit)) {
        lines.push(
          `${change.action ?? change.kind} · ${formatConfirmPath(change.target, homeDir)}`
        );
      }
      if (planned.length > limit) lines.push(`… ${planned.length - limit} more`);
    }
  } else if (!diff) {
    lines.push("", "Scan did not include diff yet. Press R to re-scan.");
  } else if (!diff.installed) {
    lines.push("", diff.summary ?? "Setup required before changes can be previewed.");
  } else if (!diff.hasChanges && !changesAction?.message) {
    lines.push("", diff.summary ?? "No pending governance changes.");
  }

  const receipt = changesAction?.receipt;
  if (receipt) {
    lines.push("", `Result · ${receipt.action}${receipt.partial ? " (partial)" : ""}`);
    if (receipt.backups?.length) lines.push(`${receipt.backups.length} backup(s) retained`);
    if (detail && receipt.checksBefore && receipt.checksAfter) {
      lines.push("DETAILS");
      lines.push(`Checks · before ok=${receipt.checksBefore.ok} → after ok=${receipt.checksAfter.ok}`);
    }
  }

  if (phase === CHANGES_PHASE.IDLE || phase === CHANGES_PHASE.COMPLETED || phase === CHANGES_PHASE.FAILED) {
    lines.push("", "A preview · Y confirm apply · N/Esc cancel · R re-scan");
  }
  return lines;
}

export function buildChangesFooterParts(phase) {
  if (phase === CHANGES_PHASE.PREVIEWING || phase === CHANGES_PHASE.APPLYING) return ["Working…", "Esc Back"];
  if (phase === CHANGES_PHASE.CONFIRMING) return ["Y Apply", "N/Esc Cancel", "Space"];
  return ["A Preview", "R Re-scan", "Space", "Esc Back"];
}
