/**
 * Declared fleet topology (orchestrator → minions + models) + optional live activity.
 * Read-only probes — writes go through fleet-set.js with consent.
 */
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { resolveHomeDir } from "../paths.js";
import { isExecutableAvailable } from "../cli-probe.js";
import { buildOpenCodeActivity } from "./fleet-activity.js";
import {
  buildClaudeFleet,
  buildCodexFleet,
  buildCursorAgentsFleet
} from "./fleet-platforms.js";

const VARIANT_SUFFIX_RE = /-(?:cheap|zen)$/i;

const MINION_ROLES = Object.freeze({
  "sdd-apply": "executor",
  "sdd-explore": "explorer",
  "sdd-verify": "verifier",
  "sdd-design": "designer",
  "sdd-propose": "proposer",
  "sdd-spec": "specifier",
  "sdd-tasks": "planner",
  "sdd-archive": "archiver",
  "sdd-onboard": "onboarder",
  "sdd-init": "initializer"
});

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function shortModel(model) {
  if (typeof model !== "string" || !model) return null;
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function agentEntries(agents) {
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) return [];
  return Object.entries(agents).map(([id, raw]) => ({
    id: String(id),
    mode: typeof raw?.mode === "string" ? raw.mode : null,
    model: typeof raw?.model === "string" ? raw.model : null
  }));
}

function pickOrchestrator(entries) {
  const gentle = entries.find((e) => e.id === "gentle-orchestrator" && e.mode === "primary");
  if (gentle) return gentle;
  return entries.find((e) => e.mode === "primary") ?? null;
}

function isSddMinion(entry, { includeVariants = false } = {}) {
  if (!entry?.id?.startsWith("sdd-")) return false;
  if (entry.mode !== "subagent") return false;
  if (!includeVariants && VARIANT_SUFFIX_RE.test(entry.id)) return false;
  return true;
}

function minionRole(id) {
  return MINION_ROLES[id] ?? (id.startsWith("sdd-") ? "specialist" : "minion");
}

export function parseOpenCodeFleet(config, { includeVariants = false } = {}) {
  const defaultModel = typeof config?.model === "string" ? config.model : null;
  const entries = agentEntries(config?.agent ?? config?.agents);
  if (entries.length === 0) {
    return {
      platform: "opencode",
      orchestrator: null,
      minions: [],
      opaque: false,
      writable: true,
      source: "opencode.json"
    };
  }

  const orch = pickOrchestrator(entries);
  const orchModel = orch?.model ?? defaultModel;
  const minions = entries
    .filter((e) => isSddMinion(e, { includeVariants }))
    .map((e) => {
      const model = e.model ?? defaultModel;
      return {
        id: e.id,
        model,
        modelShort: shortModel(model),
        role: minionRole(e.id),
        mode: e.mode
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    platform: "opencode",
    orchestrator: orch
      ? {
          id: orch.id,
          model: orchModel,
          modelShort: shortModel(orchModel),
          mode: orch.mode ?? "primary",
          opaque: false
        }
      : null,
    minions,
    opaque: false,
    writable: true,
    source: "opencode.json"
  };
}

async function readJson(path, read = readFile) {
  try {
    return JSON.parse(await read(path, "utf8"));
  } catch {
    return null;
  }
}

export async function buildFleetReport({
  homeDir = resolveHomeDir(),
  includeVariants = false,
  includeActivity = true,
  read = readFile,
  exists = pathExists,
  gentleAvailable = () => isExecutableAvailable("gentle-ai"),
  buildActivity = buildOpenCodeActivity,
  buildClaude = buildClaudeFleet,
  buildCodex = buildCodexFleet,
  buildCursor = buildCursorAgentsFleet
} = {}) {
  const fleets = [];
  const openCodePath = join(homeDir, ".config", "opencode", "opencode.json");
  if (await exists(openCodePath)) {
    const config = await readJson(openCodePath, read);
    if (config) {
      const fleet = parseOpenCodeFleet(config, { includeVariants });
      fleet.configPath = openCodePath;
      fleets.push(fleet);
    }
  }

  if (await exists(join(homeDir, ".cursor"))) {
    fleets.push(await buildCursor({ homeDir, read }));
  }

  if (await exists(join(homeDir, ".claude"))) {
    const fleet = await buildClaude({ homeDir, read });
    if (fleet) fleets.push(fleet);
  }

  if (await exists(join(homeDir, ".codex"))) {
    const fleet = await buildCodex({ homeDir, read });
    if (fleet) fleets.push(fleet);
  }

  const activity = includeActivity
    ? await buildActivity({ homeDir })
    : null;

  return {
    ok: true,
    kind: "declared+activity",
    note: "Declared config topology + OpenCode live activity when available.",
    orchestratorAuthority: gentleAvailable() ? "gentle-ai" : null,
    fleets,
    activity,
    generatedAt: new Date().toISOString()
  };
}

export function formatFleetText(report, { verbose = false } = {}) {
  const lines = ["Fleet floor", ""];
  if (report.orchestratorAuthority) {
    lines.push(`Authority · ${report.orchestratorAuthority}`);
    lines.push("");
  }
  for (const fleet of report.fleets ?? []) {
    const orch = fleet.orchestrator;
    const modelBit = orch?.opaque
      ? "opaque · IDE-managed"
      : (orch?.modelShort ?? orch?.model ?? "—");
    const minionCount = (fleet.minions ?? []).length;
    lines.push(`${fleet.platform} · ${orch?.id ?? "—"} · ${modelBit}`);
    if (verbose) {
      for (const m of fleet.minions ?? []) {
        const opaque = m.opaque ? " · opaque" : "";
        lines.push(`  ${m.id} · ${m.modelShort ?? m.model ?? "—"} · ${m.role}${opaque}`);
      }
      if (fleet.note) lines.push(`  note: ${fleet.note}`);
    } else if (minionCount > 0) {
      lines.push(`  ${minionCount} minions · kairo fleet --verbose`);
    }
    lines.push("");
  }

  const act = report.activity;
  if (act?.available) {
    const active = (act.agents ?? []).filter((a) => a.state === "active");
    if (active.length === 0) {
      lines.push("Working floor · quiet (no live OpenCode sessions)");
      lines.push("");
    } else {
      lines.push(`Working floor · ${active.length} live`);
      for (const a of active) {
        lines.push(`  ● ${a.id} · ${a.modelShort ?? a.model ?? "—"}`);
      }
      lines.push("");
    }
  } else if (act && !act.available) {
    lines.push(`Working floor · unavailable`);
    lines.push("");
  }

  if ((report.fleets ?? []).length === 0) {
    lines.push("No agent platforms detected.");
  }
  lines.push(report.note ?? "");
  return lines.join("\n").trimEnd();
}
