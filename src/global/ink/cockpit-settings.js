/**
 * Curated Settings catalog — browse → preview → confirm (no filesystem install).
 */

export const SETTINGS_PHASE = Object.freeze({
  BROWSE: "browse",
  PREVIEW: "preview",
  CONFIRMING: "confirming",
  COMPLETED: "completed"
});

export const CURATED_INTEGRATIONS = Object.freeze([
  Object.freeze({
    id: "pi-usage-widget",
    name: "Pi usage widget",
    version: "0.2.1",
    license: "Apache-2.0",
    status: "available",
    capabilities: Object.freeze(["usage-display", "local-only"]),
    permissions: Object.freeze(["full-local-access-on-install"]),
    audit: "pending-security-review",
    summary: "Local Pi package for usage visibility in the agent UI.",
    notes: "Explicit install only. Never auto-applied by Kairo."
  })
]);

export function createSettingsActionState() {
  return {
    phase: SETTINGS_PHASE.BROWSE,
    selectedId: null,
    message: null,
    receipt: null
  };
}

export function listCuratedIntegrations() {
  return [...CURATED_INTEGRATIONS];
}

export function getCuratedIntegration(id) {
  return CURATED_INTEGRATIONS.find((entry) => entry.id === id) ?? null;
}

export function reduceSettingsAction(state, action) {
  switch (action.type) {
    case "reset":
      return createSettingsActionState();
    case "preview": {
      const entry = getCuratedIntegration(action.id);
      if (!entry) {
        return { ...state, phase: SETTINGS_PHASE.BROWSE, message: "Integration not found." };
      }
      return {
        phase: SETTINGS_PHASE.PREVIEW,
        selectedId: entry.id,
        message: "Enter Confirm · Esc back — no files written yet.",
        receipt: null
      };
    }
    case "confirm-prompt":
      if (state.phase !== SETTINGS_PHASE.PREVIEW || !state.selectedId) return state;
      return {
        ...state,
        phase: SETTINGS_PHASE.CONFIRMING,
        message: "Confirm explicit install intent? Y confirm · N/Esc cancel"
      };
    case "confirm": {
      if (state.phase !== SETTINGS_PHASE.CONFIRMING || !state.selectedId) return state;
      const entry = getCuratedIntegration(state.selectedId);
      return {
        phase: SETTINGS_PHASE.COMPLETED,
        selectedId: state.selectedId,
        message: "Confirmed — no auto-install. Apply via documented Pi/CLI path only.",
        receipt: {
          id: state.selectedId,
          version: entry?.version ?? null,
          confirmedAt: new Date().toISOString(),
          wroteFiles: false
        }
      };
    }
    case "cancel":
      return {
        ...createSettingsActionState(),
        message: "Cancelled — no files written."
      };
    default:
      return state;
  }
}

export function formatSettingsBrowseLines(
  integrations = listCuratedIntegrations(),
  listIndex = 0
) {
  if (integrations.length === 0) return ["No curated integrations available."];
  return [
    "CURATED INTEGRATIONS",
    ...integrations.map((entry, index) => {
      const mark = index === listIndex ? "›" : " ";
      return `${mark} ${entry.status} · ${entry.name} · ${entry.version} · ${entry.license}`;
    }),
    "",
    "POLICY",
    "Browse → preview → confirm. Install stays explicit; never automatic.",
    "Enter preview · Esc back"
  ];
}

export function formatSettingsDetailLines(entry, settingsAction = null) {
  if (!entry) return ["Integration not found."];
  const phase = settingsAction?.phase ?? SETTINGS_PHASE.BROWSE;
  const lines = [
    "INTEGRATION",
    `${entry.name} · ${entry.version}`,
    `Status · ${entry.status} · License · ${entry.license}`,
    `Audit · ${entry.audit}`,
    "",
    "CAPABILITIES",
    entry.capabilities.join(" · ") || "none",
    "",
    "PERMISSIONS",
    entry.permissions.join(" · ") || "none",
    "",
    "SUMMARY",
    entry.summary,
    entry.notes
  ];
  if (phase === SETTINGS_PHASE.PREVIEW || phase === SETTINGS_PHASE.CONFIRMING) {
    lines.push("", "PREVIEW", "No filesystem changes. Confirm only records explicit intent.");
  }
  if (settingsAction?.message) lines.push("", settingsAction.message);
  if (settingsAction?.receipt) {
    lines.push(
      "",
      "RECEIPT",
      `Id · ${settingsAction.receipt.id} · wroteFiles · ${settingsAction.receipt.wroteFiles}`,
      `Confirmed · ${settingsAction.receipt.confirmedAt}`
    );
  }
  return lines;
}

export function formatSettingsLines({
  listIndex = 0,
  settingsAction = null,
  snapshot = null,
  diagnostics = null
} = {}) {
  const integrations = listCuratedIntegrations();
  const phase = settingsAction?.phase ?? SETTINGS_PHASE.BROWSE;
  if (phase !== SETTINGS_PHASE.BROWSE && settingsAction?.selectedId) {
    return formatSettingsDetailLines(
      getCuratedIntegration(settingsAction.selectedId),
      settingsAction
    );
  }

  const policy = snapshot?.policy;
  const sources = diagnostics?.profile?.sources;
  const sourceLabel = sources?.global || sources?.project
    ? [sources.global ? "global" : null, sources.project ? "project" : null].filter(Boolean).join(", ")
    : "none";
  return [
    ...formatSettingsBrowseLines(integrations, listIndex),
    "",
    "PROFILE & POLICY",
    `Policy · ${policy?.profile ?? "none"} · apply ${policy?.applyMode ?? "n/a"}`,
    `Preflight · ${policy?.preflight ?? "n/a"} · sources · ${sourceLabel}`,
    "",
    `Selected · ${integrations[listIndex]?.id ?? "none"}`
  ];
}

export function buildSettingsFooterParts(phase = SETTINGS_PHASE.BROWSE) {
  switch (phase) {
    case SETTINGS_PHASE.PREVIEW:
      return ["Enter Confirm", "Esc Back"];
    case SETTINGS_PHASE.CONFIRMING:
      return ["Y Confirm", "N/Esc Cancel"];
    case SETTINGS_PHASE.COMPLETED:
      return ["Esc Back", "/ Actions"];
    case SETTINGS_PHASE.BROWSE:
    default:
      return ["↑↓ Select", "Enter Preview", "Esc Nav", "/ Actions"];
  }
}
