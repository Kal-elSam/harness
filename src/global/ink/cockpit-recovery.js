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

export function formatRecoveryLines({ snapshot, recoveryAction, listIndex = 0 }) {
  const backups = listRecoverySnapshots(snapshot);
  const events = snapshot?.history?.events ?? [];
  const phase = recoveryAction?.phase ?? RECOVERY_PHASE.IDLE;
  const lines = [
    `Activity & recovery · ${phase}`,
    `History: ${events.length} recent event(s)`,
    ...events.slice(0, 3).map((event) => `${event.command ?? event.type ?? "event"} · ${event.action ?? ""} · ${event.timestamp ?? ""}`),
    "",
    `Snapshots: ${snapshot?.backups?.count ?? backups.length}`
  ];

  if (backups.length === 0) {
    lines.push("No global snapshots yet.");
  } else {
    backups.forEach((entry, index) => {
      const mark = index === listIndex ? "›" : " ";
      lines.push(`${mark} ${entry.name} · ${entry.fileCount ?? "?"} files`);
    });
  }

  if (recoveryAction?.message) lines.push("", recoveryAction.message);
  const preview = recoveryAction?.preview;
  if (preview) {
    lines.push(`Snapshot · ${preview.snapshot}`);
    for (const file of preview.files ?? []) lines.push(`  restore · ${file.displayPath}`);
    if (preview.fingerprint) lines.push(`Fingerprint · ${preview.fingerprint.slice(0, 12)}…`);
  }
  const receipt = recoveryAction?.receipt;
  if (receipt) {
    lines.push("", `Receipt · ${receipt.action}`);
    if (receipt.safetyBackup) lines.push(`Safety backup · ${receipt.safetyBackup}`);
    for (const path of receipt.restored ?? []) lines.push(`  restored · ${path}`);
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
