import { existsSync } from "node:fs";
import { join } from "node:path";

export const GLOBAL_AGENTS = [
  { id: "cursor", label: "Cursor", rootDir: ".cursor", configFile: ".cursor/AGENTS.md" },
  { id: "codex", label: "Codex", rootDir: ".codex", configFile: ".codex/AGENTS.md" },
  { id: "opencode", label: "OpenCode", rootDir: ".config/opencode", configFile: ".config/opencode/AGENTS.md" },
  { id: "claude", label: "Claude Code", rootDir: ".claude", configFile: ".claude/CLAUDE.md" }
];

export const GLOBAL_AGENT_IDS = GLOBAL_AGENTS.map((agent) => agent.id);

export function agentById(id) {
  const agent = GLOBAL_AGENTS.find((candidate) => candidate.id === id);

  if (!agent) {
    throw new Error(`Unknown agent "${id}". Use ${GLOBAL_AGENT_IDS.join(", ")}.`);
  }

  return agent;
}

export function detectGlobalAgents(homeDir) {
  return GLOBAL_AGENTS
    .filter((agent) => existsSync(join(homeDir, agent.rootDir)))
    .map((agent) => agent.id);
}
