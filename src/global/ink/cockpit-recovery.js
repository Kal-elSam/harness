import { formatConfirmPath } from "./cockpit-path-label.js";

export const RECOVERY_PHASE = Object.freeze({
  IDLE: "idle",
  PREVIEWING: "previewing",
  CONFIRMING: "confirming",
  APPLYING: "applying",
  COMPLETED: "completed",
  FAILED: "failed"
});

export function createRecoveryActionState() {
  return {
    phase: RECOVERY_PHASE.IDLE,
    preview: null,
    receipt: null,
    error: null,
    message: null,
    selectedSnapshot: null
  };
}

export function reduceRecoveryAction(state, action) {
  switch (action.type) {
    case "reset":
      return createRecoveryActionState();
    case "preview-start":
      return {
        ...createRecoveryActionState(),
        phase: RECOVERY_PHASE.PREVIEWING,
        selectedSnapshot: action.snapshot ?? null,
        message: `Previewing rollback · ${action.snapshot ?? "?"}`
      };
    case "preview-ready":
      return {
        phase: RECOVERY_PHASE.CONFIRMING,
        preview: action.preview,
        receipt: null,
        error: null,
        selectedSnapshot: action.preview?.snapshot ?? state.selectedSnapshot,
        message: action.preview?.noop
          ? "Snapshot has nothing to restore."
          : "Confirm restore? Y restore · N/Esc cancel"
      };
    case "preview-failed":
      return {
        ...state,
        phase: RECOVERY_PHASE.FAILED,
        error: action.error ?? "preview-failed",
        message: action.message ?? "Rollback preview failed.",
        preview: state.preview
      };
    case "apply-start":
      return { ...state, phase: RECOVERY_PHASE.APPLYING, message: "Restoring snapshot…" };
    case "apply-done":
      return {
        phase: action.ok ? RECOVERY_PHASE.COMPLETED : RECOVERY_PHASE.FAILED,
        preview: action.preview ?? state.preview,
        receipt: action.receipt ?? null,
        error: action.ok ? null : (action.reason ?? "apply-failed"),
        selectedSnapshot: state.selectedSnapshot,
        message: action.message ?? (action.ok ? "Rollback complete." : "Rollback failed.")
      };
    case "cancel":
      return {
        ...createRecoveryActionState(),
        message: "Cancelled — previous snapshot kept, no restore written."
      };
    default:
      return state;
  }
}

export function listRecoverySnapshots(snapshot) {
  return snapshot?.backups?.snapshots ?? [];
}

function formatWhen(timestamp) {
  if (!timestamp) return "unknown time";
  const raw = String(timestamp);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 16).replace("T", " ");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 16);
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function formatResult(action) {
  const value = String(action ?? "").toLowerCase();
  if (!value) return "done";
  if (value === "applied" || value === "ok" || value === "success") return "ok";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  if (value.includes("fail")) return "failed";
  return value;
}

function shortName(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return "snapshot";
  const parts = raw.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || raw;
}

/**
 * Activity surface: what agents did, when, and result.
 * Snapshot restore stays secondary; paths only under DETAILS.
 */
export function formatRecoveryLines({
  snapshot,
  recoveryAction,
  listIndex = 0,
  dashboard = null,
  detail = false,
  homeDir = null
} = {}) {
  const backups = listRecoverySnapshots(snapshot);
  const events = snapshot?.history?.events ?? [];
  const phase = recoveryAction?.phase ?? RECOVERY_PHASE.IDLE;
  const lines = ["RECENT"];

  const recent = [];
  for (const event of events.slice(0, 3)) {
    recent.push(
      `${formatWhen(event.timestamp)} · ${event.command ?? event.type ?? "event"} · ${formatResult(event.action)}`
    );
  }
  for (const run of (dashboard?.recentRuns ?? []).slice(0, 2)) {
    recent.push(
      `${formatWhen(run.updatedAt ?? run.endedAt ?? run.startedAt)} · ${run.agentId ?? "agent"} · ${formatResult(run.state)}`
    );
  }
  if (recent.length === 0) lines.push("No recent agent activity.");
  else lines.push(...recent.slice(0, 4));

  lines.push("", "SNAPSHOTS");
  if (backups.length === 0) {
    lines.push("No global snapshots yet.");
  } else {
    backups.forEach((entry, index) => {
      const mark = index === listIndex ? "›" : " ";
      lines.push(`${mark} ${shortName(entry.name)} · ${entry.fileCount ?? "?"} files`);
    });
  }

  if (recoveryAction?.message) lines.push("", recoveryAction.message);

  const preview = recoveryAction?.preview;
  if (preview) {
    const fileCount = preview.files?.length ?? 0;
    lines.push(`Restore preview · ${fileCount} file(s)`);
    if (detail || phase === RECOVERY_PHASE.CONFIRMING) {
      lines.push("DETAILS");
      const limit = detail ? 12 : 3;
      for (const file of (preview.files ?? []).slice(0, limit)) {
        lines.push(formatConfirmPath(file.displayPath ?? file.path, homeDir));
      }
      if ((preview.files?.length ?? 0) > limit) {
        lines.push(`… ${preview.files.length - limit} more`);
      }
    }
  }

  const receipt = recoveryAction?.receipt;
  if (receipt) {
    const restored = receipt.restored?.length ?? 0;
    lines.push("", `Result · ${receipt.action ?? "rollback"} · ${restored} restored`);
    if (detail && receipt.safetyBackup) {
      lines.push("DETAILS", `Safety backup retained`);
    } else if (receipt.safetyBackup) {
      lines.push("Safety backup retained");
    }
  }

  if (phase === RECOVERY_PHASE.IDLE || phase === RECOVERY_PHASE.COMPLETED || phase === RECOVERY_PHASE.FAILED) {
    lines.push("", "Enter preview · Y restore · N/Esc cancel · R re-scan");
  }
  return lines;
}

export function buildRecoveryFooterParts(phase) {
  if (phase === RECOVERY_PHASE.PREVIEWING || phase === RECOVERY_PHASE.APPLYING) return ["Working…", "Esc Back"];
  if (phase === RECOVERY_PHASE.CONFIRMING) return ["Y Restore", "N/Esc Cancel"];
  return ["↑↓ Select", "Enter Preview", "R Re-scan", "Esc Back"];
}
