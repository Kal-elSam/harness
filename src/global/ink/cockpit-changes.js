import { formatProposalLines, proposalLimitForLayout } from "./cockpit-proposals.js";

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

export function formatChangesActionLines({ snapshot, changesAction, layoutMode = "compact" }) {
  const diff = snapshot?.diff;
  const phase = changesAction?.phase ?? CHANGES_PHASE.IDLE;
  const lines = [`Changes · ${phase}`];

  const proposalLines = formatProposalLines(snapshot?.proposals ?? [], {
    limit: proposalLimitForLayout(layoutMode),
    destinationFilter: "changes",
    budgets: snapshot?.budgets ?? null
  });
  if (proposalLines[0] !== "No proposals targeting this view.") {
    lines.push(...proposalLines, "");
  }

  if (changesAction?.message) lines.push(changesAction.message);
  if (changesAction?.error && changesAction.error !== "setup-required") lines.push(`Error: ${changesAction.error}`);

  const preview = changesAction?.preview;
  if (preview?.hasChanges) {
    lines.push(`${preview.changes?.length ?? 0} planned change(s)`);
    for (const change of preview.changes ?? []) {
      lines.push(`${change.action ?? change.kind} · ${change.target} · ${change.status ?? "planned"}`);
    }
    if (preview.integrations?.status && preview.integrations.status !== "skipped") {
      lines.push(`SDD lifecycle · ${preview.integrations.status}${preview.integrations.partial ? " (partial)" : ""}`);
    }
    if (preview.fingerprint) lines.push(`Fingerprint · ${preview.fingerprint.slice(0, 12)}…`);
  } else if (diff && !preview) {
    if (!diff.installed) lines.push(diff.summary ?? "Setup required before changes can be previewed.");
    else if (!diff.hasChanges) lines.push(diff.summary ?? "No pending governance changes.");
    else {
      lines.push(diff.summary ?? "Pending changes");
      for (const change of diff.changes ?? []) lines.push(`${change.action ?? change.kind} · ${change.target} · ${change.status}`);
    }
  } else if (!diff) {
    lines.push("Scan did not include diff yet. Press R to re-scan.");
  }

  const receipt = changesAction?.receipt;
  if (receipt) {
    lines.push("", `Receipt · ${receipt.action}`);
    if (receipt.backups?.length) lines.push(`Backups · ${receipt.backups.length}`);
    if (receipt.checksBefore && receipt.checksAfter) {
      lines.push(`Checks · before ok=${receipt.checksBefore.ok} → after ok=${receipt.checksAfter.ok}`);
    }
    if (receipt.integrations) lines.push(`Integrations · ${receipt.integrations.status ?? "n/a"}`);
    if (receipt.partial) lines.push("Partial evidence retained — success not claimed.");
  }

  if (phase === CHANGES_PHASE.IDLE || phase === CHANGES_PHASE.COMPLETED || phase === CHANGES_PHASE.FAILED) {
    lines.push("", "A preview · Y confirm apply · N/Esc cancel · R re-scan");
  }
  return lines;
}

export function buildChangesFooterParts(phase) {
  if (phase === CHANGES_PHASE.PREVIEWING || phase === CHANGES_PHASE.APPLYING) return ["Working…", "Esc Back"];
  if (phase === CHANGES_PHASE.CONFIRMING) return ["Y Apply", "N/Esc Cancel"];
  return ["A Preview", "R Re-scan", "Esc Back"];
}
