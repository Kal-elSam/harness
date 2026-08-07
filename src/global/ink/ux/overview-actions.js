/**
 * Two explicit Home buttons — prepare + configure.
 * No writes here: intents only open existing consent-gated flows.
 */

export const OVERVIEW_BUTTON_COUNT = 2;

function changeCount(snapshot) {
  if (!snapshot?.diff?.hasChanges) return 0;
  return snapshot.diff.changeCount
    ?? snapshot.diff.changes?.length
    ?? 0;
}

function detectedAgentCount({ snapshot = null, diagnostics = null, dashboard = null } = {}) {
  if (Number.isFinite(snapshot?.coverage?.detectedAgents)) {
    return snapshot.coverage.detectedAgents;
  }
  if (Number.isFinite(diagnostics?.diagnostics?.detected)) {
    return diagnostics.diagnostics.detected;
  }
  return (dashboard?.providers ?? []).filter((entry) => entry?.available).length;
}

function buildPrepareButton({
  hasGlobalState = false,
  snapshot = null,
  diagnostics = null,
  dashboard = null
} = {}) {
  const detected = detectedAgentCount({ snapshot, diagnostics, dashboard });
  const needsSetup = hasGlobalState === false || detected === 0;
  if (needsSetup) {
    return {
      id: "prepare",
      label: "Set up Kairo",
      detail: "Detect your agents and install what is missing.",
      intent: "setup"
    };
  }

  const pending = changeCount(snapshot);
  if (pending > 0) {
    return {
      id: "prepare",
      label: `Repair ${pending} change${pending === 1 ? "" : "s"}`,
      detail: "You will see the exact plan before anything is written.",
      intent: "governance"
    };
  }

  return {
    id: "prepare",
    label: "Everything is ready",
    detail: "Open History to see what changed, or Configure to adjust.",
    intent: "history"
  };
}

const CONFIGURE_BUTTON = Object.freeze({
  id: "configure",
  label: "Configure",
  detail: "Agents, Obsidian vault, integrations.",
  intent: "settings"
});

/**
 * Exactly two buttons for Home. First button changes face by state.
 */
export function buildOverviewButtons({
  hasGlobalState = false,
  snapshot = null,
  diagnostics = null,
  dashboard = null
} = {}) {
  return [
    buildPrepareButton({ hasGlobalState, snapshot, diagnostics, dashboard }),
    { ...CONFIGURE_BUTTON }
  ];
}
