"use strict";

const { enrichEntry, sortEntries } = require("./entry-actions");
const { buildFleetNodes, buildActivityNodes } = require("./panel-fleet");
const { buildWorkViewport } = require("./panel-work");

const INSTALL_HINT = "Install Kairo: npm install -g @kal-elsam/kairo-runtime";

const SAFETY_RANK = Object.freeze({
  "read-only": 0,
  consent: 1,
  destructive: 2
});

/**
 * Console-Ninja-style panel model: headline + actions + entries + connection chips.
 * Actions never write — they only describe a terminal command to run.
 */
function buildPanelModel(status, connections = [], fleetReport = null, nextReport = null, controlPlane = null) {
  const fleetNodes = buildFleetNodes(fleetReport);
  const { activityNodes, activityNote, activityActiveCount, showActivityFloor } = buildActivityNodes(fleetReport);
  const fleetNote = fleetReport?.fleetNote
    ?? fleetReport?.note
    ?? "Declared config, not live tokens.";
  const orchestratorAuthority = fleetReport?.orchestratorAuthority ?? null;
  const work = buildWorkViewport(nextReport);
  const teamSectionOk = controlPlane?.sections?.team?.ok !== false;
  const platformsPresent = (controlPlane?.team?.platforms?.length ?? fleetNodes.length) > 0;
  // Never claim "no platforms" when the atomic report already listed them or team fetch failed.
  const hideEmptyPlatforms = platformsPresent || teamSectionOk === false;

  if (!status || status.installed === false || status.overall === "missing") {
    return {
      title: "Kairo",
      headline: "Not installed",
      detail: status?.nextAction ?? INSTALL_HINT,
      overall: "missing",
      actions: [
        { id: "install", label: "Install Kairo", command: "npm install -g @kal-elsam/kairo-runtime", primary: true }
      ],
      connections: Array.isArray(connections) ? connections : [],
      fleetNodes,
      activityNodes,
      activityNote,
      activityActiveCount,
      showActivityFloor: showActivityFloor === true,
      fleetNote,
      orchestratorAuthority,
      work,
      controlPlane,
      workflow: controlPlane?.workflow ?? null,
      attention: controlPlane?.attention ?? null,
      hideEmptyPlatforms: hideEmptyPlatforms === true,
      entries: []
    };
  }

  const overall = status.overall ?? "unknown";
  const needsAttention = overall === "drift"
    || overall === "action_required"
    || overall === "warning";
  const headline = overall === "ok"
    ? "Ready"
    : needsAttention
      ? "Needs attention"
      : "Check status";

  const agent = (connections ?? []).find((c) => c.id === "agent");
  const agentConnected = agent?.state === "connected";

  const rawEntries = [];
  if (typeof status.nextAction === "string" && status.nextAction) {
    rawEntries.push({
      id: "next",
      title: status.nextAction,
      status: needsAttention ? "action" : "info",
      detail: "Primary next step from kairo status."
    });
  }
  for (const check of status.checks ?? []) {
    const checkStatus = typeof check.status === "string" ? check.status : "unknown";
    if (checkStatus === "ok") continue;
    const detail = typeof check.detail === "string" ? check.detail : "";
    const name = typeof check.name === "string" ? check.name : "check";
    let displayStatus = checkStatus;
    if (checkStatus === "warning") {
      if (/Not detected on this machine/i.test(detail) || /: unconfigured\b/i.test(detail)) {
        displayStatus = "note";
      } else if (/\bconflict\b/i.test(detail)) {
        displayStatus = "conflict";
      }
    }
    const entry = {
      id: `check-${rawEntries.length}`,
      title: name,
      status: displayStatus,
      detail,
      category: typeof check.category === "string" ? check.category : "other"
    };
    if (Array.isArray(check.resolutions) && check.resolutions.length > 0) {
      entry.resolutions = check.resolutions;
      entry.actions = check.resolutions.map(mapResolutionToAction);
    }
    rawEntries.push(entry);
  }

  const entries = sortEntries(rawEntries.map((entry) => (
    Array.isArray(entry.actions) && entry.actions.length
      ? entry
      : enrichEntry(entry)
  )));
  const hasConflict = entries.some((e) => e.status === "conflict");
  const hasDrift = entries.some((e) => e.status === "drift");
  const wantsRepair = needsAttention || hasDrift;
  const primaryResolution = pickPrimaryResolution(entries);

  const actions = [
    {
      id: "fleet-configure",
      label: "Models",
      command: "kairo fleet configure",
      primary: !wantsRepair && !hasConflict && !primaryResolution
    },
    {
      id: "fleet-models",
      label: "Catalog",
      command: "kairo fleet models --profile",
      primary: false
    },
    {
      id: "setup",
      label: "Setup",
      command: "kairo setup",
      primary: false
    }
  ];
  if (wantsRepair) {
    actions.push({
      id: "repair",
      label: "Repair",
      command: "kairo sync",
      primary: true
    });
  }
  if (primaryResolution && !wantsRepair) {
    actions.push({
      ...primaryResolution,
      primary: true
    });
  } else if (hasConflict && !primaryResolution) {
    actions.push({
      id: "configure-sdd",
      label: "Fix SDD",
      command: "kairo components configure sdd-core --dry-run",
      primary: true
    });
  }
  if (!agentConnected) {
    actions.push({
      id: "connect-agent",
      label: "Connect Agent",
      command: "kairo mcp install",
      primary: false
    });
  }
  if (work.showRepair) {
    actions.push({
      id: "repair-integration",
      label: "Repair integration",
      command: "kairo mcp install --yes",
      primary: true,
      safety: "consent"
    });
  }
  actions.push(
    { id: "fleet", label: "Fleet", command: "kairo fleet", primary: false },
    { id: "doctor", label: "Doctor", command: "kairo doctor", primary: false },
    { id: "refresh", label: "Refresh", command: null, primary: false }
  );

  return {
    title: "Kairo",
    headline,
    detail: status.nextAction ?? "",
    overall,
    cliVersion: status.cliVersion ?? null,
    backups: status.backups ?? 0,
    actions,
    connections: Array.isArray(connections) ? connections : [],
    fleetNodes,
    activityNodes,
    activityNote,
    activityActiveCount,
    showActivityFloor: showActivityFloor === true,
    fleetNote,
    orchestratorAuthority,
    work,
    controlPlane,
    workflow: controlPlane?.workflow ?? null,
    attention: controlPlane?.attention ?? null,
    hideEmptyPlatforms: hideEmptyPlatforms === true,
    entries
  };
}

function mapResolutionToAction(resolution) {
  return {
    id: resolution.id,
    label: resolution.label,
    command: resolution.command ?? null,
    kind: resolution.kind ?? "run",
    safety: resolution.safety ?? "consent",
    detail: resolution.detail ?? ""
  };
}

/** Prefer a consent-gated fix over destructive overwrite for the toolbar. */
function pickPrimaryResolution(entries) {
  let best = null;
  let bestRank = Infinity;
  for (const entry of entries) {
    for (const action of entry.actions ?? []) {
      if (!action?.command) continue;
      if (action.id === "doctor" || action.id === "refresh" || action.id === "sdd-diff") continue;
      const rank = SAFETY_RANK[action.safety] ?? 9;
      if (rank < bestRank) {
        best = action;
        bestRank = rank;
      }
    }
  }
  return best;
}

module.exports = {
  buildPanelModel,
  buildFleetNodes,
  buildActivityNodes,
  INSTALL_HINT,
  mapResolutionToAction
};
