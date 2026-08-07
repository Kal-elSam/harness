/**
 * Plain-language Overview needs — no machine noise on the first screen.
 */
import { CONTROL_PLANE_HEALTH } from "../../control-plane-snapshot.js";
import { formatCliCommand } from "../../brand/cli.js";

export const OVERVIEW_NEED_LIMIT = 3;

/** Prefixes that never belong on the first screen (machine / internals). */
export const DETAILS_ONLY_PREFIXES = [
  "System",
  "Advisor",
  "Soft links",
  "Gentle",
  "Graphify",
  "Hermes"
];

const DESTINATION_LABELS = {
  setup: "Setup",
  changes: "Governance",
  ides: "Agents",
  runs: "Orchestration",
  "control-center": "Overview",
  activity: "Activity",
  usage: "Usage",
  profile: "Settings"
};

export function mapHealthTone(kind) {
  switch (kind) {
    case CONTROL_PLANE_HEALTH.CHECK_FAILED:
      return "danger";
    case CONTROL_PLANE_HEALTH.ACTION_REQUIRED:
    case CONTROL_PLANE_HEALTH.NOT_CONFIGURED:
    case CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES:
      return "warn";
    case CONTROL_PLANE_HEALTH.HEALTHY:
      return "ready";
    default:
      return "warn";
  }
}

/** Plain-language status title — never shouty ALL-CAPS jargon alone. */
export function humanizeHealthTitle(kind, fallback = "Unknown") {
  switch (kind) {
    case CONTROL_PLANE_HEALTH.NOT_CONFIGURED:
      return "Needs setup";
    case CONTROL_PLANE_HEALTH.ACTION_REQUIRED:
      return "Needs attention";
    case CONTROL_PLANE_HEALTH.CHECK_FAILED:
      return "Something failed";
    case CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES:
      return "Ready · with notes";
    case CONTROL_PLANE_HEALTH.HEALTHY:
      return "Ready";
    default:
      return typeof fallback === "string" && fallback ? fallback : "Unknown";
  }
}

export function humanizeDestination(destination) {
  if (!destination) return null;
  return DESTINATION_LABELS[destination] ?? null;
}

/**
 * Turn a raw companion line into a user-facing need, or null to skip.
 * System/machine lines are never returned here.
 */
export function humanizeCompanionNeed(line) {
  if (typeof line !== "string" || line.trim().length === 0) return null;
  if (/^\s/.test(line)) return null;

  for (const prefix of DETAILS_ONLY_PREFIXES) {
    if (line.startsWith(prefix)) return null;
  }

  if (line.startsWith("Obsidian · unconfigured")) {
    return "Obsidian not connected · open Settings to choose your vault";
  }
  if (line.startsWith("Obsidian · missing")) {
    return "Obsidian vault folder missing · check Settings";
  }
  if (line.startsWith("Obsidian · unavailable") || line.startsWith("Obsidian · error")) {
    return "Obsidian unavailable · check Settings";
  }
  if (/^Updates · \d+\s+available/i.test(line)) {
    return `Update available · run ${formatCliCommand("updates check")}`;
  }
  if (line.startsWith("Engram · conflict")) {
    return "Memory conflict · open Settings → Engram";
  }
  if (line.startsWith("Engram · missing") || line.startsWith("Engram · error")) {
    return "Memory not ready · open Settings → Engram";
  }
  return null;
}

/** Partition companion lines: plain needs for Overview, raw rest for Details. */
export function partitionCompanionLines(lines = []) {
  const needs = [];
  const rest = [];
  for (const line of lines) {
    if (typeof line !== "string" || line.trim().length === 0) continue;
    const need = humanizeCompanionNeed(line);
    if (need && needs.length < OVERVIEW_NEED_LIMIT) {
      needs.push(need);
      continue;
    }
    rest.push(line);
  }
  return { needs, rest };
}

export function humanizePrimary(next = {}) {
  const kind = next.kind;
  const detail = typeof next.actionDetail === "string" && next.actionDetail.trim()
    ? next.actionDetail.trim()
    : null;
  switch (kind) {
    case "setup":
      return {
        label: "Start setup",
        detail: detail ?? `Run ${formatCliCommand("setup")} to configure agents for this project.`,
        hint: "Enter → open Setup"
      };
    case "repair":
      return {
        label: "Fix drift",
        detail: detail ?? `Run ${formatCliCommand("sync")} to repair managed content.`,
        hint: "Enter → preview in Governance"
      };
    case "verify":
      return {
        label: "Check what failed",
        detail: detail ?? `Run ${formatCliCommand("doctor")} for details.`,
        hint: "Enter → reload"
      };
    case "review":
      return {
        label: "Review notes",
        detail: detail ?? "Open Governance to inspect remaining notes.",
        hint: "Enter → open"
      };
    case "idle":
      return {
        label: "All clear",
        detail: detail ?? "No action needed right now.",
        hint: null
      };
    default:
      return {
        label: next.actionTitle ?? "Review control plane",
        detail,
        hint: next.enterHint ?? "Enter →"
      };
  }
}
