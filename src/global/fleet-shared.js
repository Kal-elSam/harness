/**
 * Shared fleet constants + Gentle assignment loader (no circular imports).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const SDD_PHASES = Object.freeze([
  "sdd-apply", "sdd-archive", "sdd-design", "sdd-explore", "sdd-init",
  "sdd-onboard", "sdd-propose", "sdd-spec", "sdd-tasks", "sdd-verify"
]);

/** Map Gentle/Claude tier names → OpenCode provider/model ids. */
export const CLAUDE_TO_OPENCODE = Object.freeze({
  opus: "opencode-go/deepseek-v4-pro",
  sonnet: "opencode-go/qwen3.5-plus",
  haiku: "opencode-go/deepseek-v4-flash"
});

export async function loadGentleClaudeAssignments(homeDir, read = readFile) {
  try {
    const state = JSON.parse(await read(join(homeDir, ".gentle-ai", "state.json"), "utf8"));
    const current = state != null && Object.hasOwn(state, "claude_phase_assignments");
    const map = current ? state.claude_phase_assignments : state?.claude_model_assignments;
    if (!map || typeof map !== "object") return null;
    if (!current) return { ...map };
    return Object.fromEntries(Object.entries(map).flatMap(([agent, entry]) => {
      const model = typeof entry === "string" ? entry : entry?.model;
      if (typeof model !== "string" || !model) return [];
      const assignment = { model };
      if (typeof entry?.effort === "string") assignment.effort = entry.effort;
      return [[agent, assignment]];
    }));
  } catch {
    return null;
  }
}

export function mapClaudeAssignmentsToOpenCode(assignments = {}) {
  const out = {};
  for (const [agent, tier] of Object.entries(assignments)) {
    if (agent === "default" || agent === "codex_default") continue;
    const key = String(tier ?? "").toLowerCase();
    out[agent] = CLAUDE_TO_OPENCODE[key] ?? CLAUDE_TO_OPENCODE.sonnet;
  }
  return out;
}
