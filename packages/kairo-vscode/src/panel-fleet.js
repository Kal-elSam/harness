"use strict";

const PLATFORM_LABELS = Object.freeze({
  opencode: "OpenCode",
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex"
});

const PLATFORM_GLYPH = Object.freeze({
  opencode: "OC",
  cursor: "Cu",
  claude: "Cl",
  codex: "Cx"
});

function platformLabel(value) {
  const key = String(value ?? "");
  if (PLATFORM_LABELS[key]) return PLATFORM_LABELS[key];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : key;
}

function editMinionAction(platform, minion) {
  const model = minion.model && minion.model !== "inherit" ? minion.model : "MODEL_ID";
  return {
    id: `edit-${platform}-${minion.id}`,
    label: `Edit ${minion.id}`,
    command: `kairo fleet set --platform ${platform} --agent ${minion.id} --model ${model}`,
    kind: "run",
    safety: "consent",
    detail: `Plan change for ${minion.id}. Edit --model in the terminal, then add --yes.`
  };
}

function multiConfigureActions() {
  return [
    {
      id: "configure-all",
      label: "Configure all (multi-agent)",
      command: "kairo fleet configure",
      kind: "run",
      safety: "consent",
      detail: "One plan for Claude + OpenCode + Cursor agents (from ~/.harness/fleet-models.json). Then --yes."
    },
    {
      id: "configure-all-yes",
      label: "Apply all --yes",
      command: "kairo fleet configure --yes",
      kind: "run",
      safety: "consent",
      detail: "Writes multi-agent configs with backups + saves fleet profile."
    },
    {
      id: "fleet-models",
      label: "Show models available/enabled",
      command: "kairo fleet models --profile",
      kind: "run",
      safety: "consent",
      detail: "Catalog per tool: what is available vs enabled on disk."
    }
  ];
}

function deskActions(fleet) {
  const platform = String(fleet?.platform ?? "unknown");
  const orch = fleet?.orchestrator ?? null;
  const minions = Array.isArray(fleet?.minions) ? fleet.minions : [];
  const writable = fleet?.writable === true;

  if (platform === "cursor") {
    return [
      ...multiConfigureActions(),
      {
        id: "open-cursor-agents",
        label: "Open Cursor agents",
        command: "open ~/.cursor/agents",
        kind: "run",
        safety: "consent",
        detail: "Agents live here (usually model: inherit). Skills/rules document each case."
      },
      {
        id: "open-cursor-skills",
        label: "Open Cursor skills",
        command: "open ~/.cursor/skills",
        kind: "run",
        safety: "consent",
        detail: "Quick access to skills folder when present."
      },
      {
        id: "open-cursor-rules",
        label: "Open Cursor rules",
        command: "open ~/.cursor/rules",
        kind: "run",
        safety: "consent",
        detail: "Quick access to rules folder when present."
      },
      {
        id: "pixel-agents",
        label: "Try Pixel Agents (visual)",
        command: "npx pixel-agents",
        kind: "run",
        safety: "consent",
        detail: "Optional MIT companion office. Not Cursor Auto telemetry."
      }
    ];
  }

  if (platform === "codex") {
    const model = orch?.model && orch.model !== "inherit" ? orch.model : "MODEL_ID";
    return [
      {
        id: "codex-model",
        label: "Set Codex model (plan)",
        command: `kairo fleet configure --codex-model ${model}`,
        kind: "run",
        safety: "consent",
        detail: "Codex is single-default — separate from multi-agent phase map. Edit model id, then --yes."
      },
      {
        id: "codex-model-yes",
        label: "Apply Codex model --yes",
        command: `kairo fleet configure --codex-model ${model} --yes`,
        kind: "run",
        safety: "consent",
        detail: "Writes ~/.codex/config.toml with backup."
      },
      {
        id: "fleet-models-codex",
        label: "Show models catalog",
        command: "kairo fleet models",
        kind: "run",
        safety: "consent",
        detail: "Available vs enabled per tool."
      },
      editMinionAction("codex", { id: "default", model })
    ];
  }

  if (!writable) return multiConfigureActions();

  const actions = [
    ...multiConfigureActions(),
    {
      id: `sync-${platform}`,
      label: `Sync ${platformLabel(platform)} only (plan)`,
      command: `kairo fleet configure --platforms ${platform}`,
      kind: "run",
      safety: "consent",
      detail: "Platform-only plan. Prefer Configure all for one multi-agent assignment."
    }
  ];

  if (orch?.id && !orch.opaque) {
    actions.push(editMinionAction(platform, {
      id: orch.id === "default" ? "default" : orch.id,
      model: orch.model
    }));
  }

  for (const m of minions.filter((x) => !x.opaque).slice(0, 6)) {
    actions.push(editMinionAction(platform, m));
  }
  return actions;
}

/**
 * Compact floor: one desk card per platform.
 */
function buildFleetNodes(fleetReport = null) {
  const fleets = Array.isArray(fleetReport?.fleets) ? fleetReport.fleets : [];
  const note = fleetReport?.fleetNote
    ?? fleetReport?.note
    ?? "Declared config, not live tokens.";
  const nodes = [];

  for (const fleet of fleets) {
    const orch = fleet?.orchestrator ?? null;
    const platform = String(fleet?.platform ?? "unknown");
    const modelLabel = orch?.opaque
      ? "opaque"
      : (orch?.modelShort ?? orch?.model ?? "—");
    const orchId = orch?.id ?? "default";
    const minions = Array.isArray(fleet?.minions) ? fleet.minions : [];
    const minionLines = minions.slice(0, 12).map((m) => (
      `${m.id} · ${m.modelShort ?? m.model ?? "—"}${m.opaque ? " · opaque" : ""}`
    ));

    nodes.push({
      id: `${platform}:desk`,
      kind: "desk",
      platform,
      glyph: PLATFORM_GLYPH[platform] ?? platform.slice(0, 2).toUpperCase(),
      title: `${platformLabel(platform)} · ${modelLabel}`,
      subtitle: orch?.opaque
        ? `${orchId} · IDE-managed`
        : platform === "codex"
          ? `${orchId} · single model`
          : `${orchId} · ${minions.length} minion${minions.length === 1 ? "" : "s"}`,
      detail: [
        platform === "cursor"
          ? "Cursor Auto is the orchestrator. Use Configure all for Claude/OpenCode; open agents/skills/rules for Cursor docs."
          : null,
        platform === "codex"
          ? "Codex is single-default — configure apart from the multi-agent phase map."
          : null,
        `Platform · ${platformLabel(platform)}`,
        `Orchestrator · ${orchId}`,
        orch?.opaque ? "Model · opaque · IDE-managed" : `Model · ${orch?.model ?? "—"}`,
        minions.length ? `Minions\n${minionLines.join("\n")}` : "No declared minions",
        fleet?.note ? String(fleet.note) : null,
        "Prefer Configure all (multi-agent). Codex aparte. kairo fleet models = available/enabled.",
        note
      ].filter(Boolean).join("\n"),
      indent: 0,
      opaque: Boolean(orch?.opaque),
      minionCount: minions.length,
      actions: deskActions(fleet)
    });
  }
  return nodes;
}

function buildActivityNodes(fleetReport = null) {
  const activity = fleetReport?.activity;
  if (!activity?.available) {
    return {
      activityNodes: [],
      activityNote: activity?.note ?? "No live activity source.",
      activityActiveCount: 0,
      showActivityFloor: false
    };
  }

  const active = (activity.agents ?? []).filter((a) => a.state === "active");
  const activityNodes = active.slice(0, 12).map((agent) => ({
    id: `activity:${agent.id}`,
    kind: "worker",
    platform: "opencode",
    state: "active",
    glyph: String(agent.id ?? "?").replace(/^sdd-/, "").slice(0, 2).toUpperCase(),
    title: agent.id,
    subtitle: agent.modelShort ?? agent.model ?? "—",
    detail: [
      `Working · ${agent.id}`,
      `Model · ${agent.model ?? "—"}`,
      agent.parentId ? `Parent · ${agent.parentId}` : "Root session",
      agent.title ? `Task · ${agent.title}` : null,
      "Live OpenCode session — appears only while active."
    ].filter(Boolean).join("\n"),
    indent: 0,
    opaque: false,
    actions: []
  }));

  return {
    activityNodes,
    activityNote: active.length
      ? `${active.length} agent${active.length === 1 ? "" : "s"} working (OpenCode).`
      : "Floor quiet — activity appears when an OpenCode session is live.",
    activityActiveCount: active.length,
    showActivityFloor: active.length > 0
  };
}

module.exports = {
  buildFleetNodes,
  buildActivityNodes,
  platformLabel,
  deskActions,
  PLATFORM_GLYPH
};
