/**
 * Normalize declared fleets into honest control-plane team nodes.
 * Live requires OpenCode active-agent evidence — never idle sessions.
 */
import { HONESTY } from "./constants.js";

function honestyForNode(node, { platform, hasLiveActivity }) {
  if (node?.opaque === true) return HONESTY.OPAQUE;
  if (platform === "opencode" && hasLiveActivity) return HONESTY.LIVE;
  return HONESTY.DECLARED;
}

export function normalizeTeam(connectionsReport = {}) {
  const fleets = Array.isArray(connectionsReport.fleets) ? connectionsReport.fleets : [];
  const activity = connectionsReport.activity ?? null;
  const hasLiveActivity = Boolean(
    activity
    && (
      (Array.isArray(activity.agents) && activity.agents.some((a) => a?.state === "active"))
      || (typeof activity.activeCount === "number" && activity.activeCount > 0)
      || activity.active === true
    )
  );

  // Cursor configured agents are declared topology (not live); only opaque nodes stay opaque.
  const platforms = fleets.map((fleet) => {
    const platform = fleet?.platform ?? "unknown";
    const orch = fleet?.orchestrator ?? null;
    return {
      platform,
      honesty: honestyForNode(fleet, { platform, hasLiveActivity }),
      source: fleet?.source ?? null,
      orchestrator: orch
        ? {
            id: orch.id ?? null,
            model: orch.modelShort ?? orch.model ?? null,
            honesty: honestyForNode(orch, { platform, hasLiveActivity }),
            role: orch.mode ?? "orchestrator"
          }
        : null,
      agents: (Array.isArray(fleet?.minions) ? fleet.minions : []).map((m) => ({
        id: m.id,
        model: m.modelShort ?? m.model ?? null,
        role: m.role ?? null,
        honesty: m?.opaque === true && platform === "cursor"
          ? HONESTY.DECLARED
          : honestyForNode(m, { platform, hasLiveActivity: false })
      }))
    };
  });

  return {
    platforms,
    // Only surface activity when there is live evidence (active workers).
    activity: hasLiveActivity ? activity : null,
    fleetNote: connectionsReport.fleetNote
      ?? "Declared config topology — not live token usage.",
    orchestratorAuthority: connectionsReport.orchestratorAuthority ?? null,
    connections: Array.isArray(connectionsReport.connections)
      ? connectionsReport.connections
      : []
  };
}
