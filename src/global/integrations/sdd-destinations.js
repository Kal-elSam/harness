import { join } from "node:path";

export const SDD_SKILL_IDS = Object.freeze([
  "sdd-init",
  "sdd-explore",
  "sdd-propose",
  "sdd-spec",
  "sdd-design",
  "sdd-tasks",
  "sdd-apply",
  "sdd-verify",
  "sdd-archive"
]);

export const SDD_MANAGED_AGENT_IDS = Object.freeze(["cursor", "codex", "opencode", "claude"]);
export const SDD_SHARED_AGENT_IDS = Object.freeze(["cursor", "codex", "opencode"]);
export const SDD_PERSONA_IDS = Object.freeze(["off", "teaching"]);

export function resolveSddAgentSelection({
  requestedIds = null,
  detectedIds = [],
  managedIds = SDD_MANAGED_AGENT_IDS
} = {}) {
  const managed = [...managedIds];
  if (requestedIds == null) {
    const detected = new Set(detectedIds);
    return managed.filter((id) => detected.has(id));
  }
  if (requestedIds.length === 1 && requestedIds[0] === "all") return [...managed];
  return requestedIds.map((id) => {
    if (!managed.includes(id)) {
      throw new Error(`Agent "${id}" is not managed for SDD skills. Use: ${managed.join(", ")}.`);
    }
    return id;
  });
}

export function resolveSddSkillRoot(agentId, homeDir) {
  if (SDD_SHARED_AGENT_IDS.includes(agentId)) {
    return join(homeDir, ".agents", "skills");
  }
  if (agentId === "claude") {
    return join(homeDir, ".claude", "skills");
  }
  throw new Error(`Agent "${agentId}" has no SDD skill destination.`);
}

export function resolveSddSkillPath(skillId, agentId, homeDir) {
  return join(resolveSddSkillRoot(agentId, homeDir), skillId, "SKILL.md");
}

/** One physical destination per root, with stable consumer agentIds. */
export function groupSddSkillDestinations(agentIds, homeDir) {
  const selected = new Set(agentIds);
  const groups = [];

  const sharedConsumers = SDD_SHARED_AGENT_IDS.filter((id) => selected.has(id));
  if (sharedConsumers.length > 0) {
    groups.push({
      kind: "shared",
      root: join(homeDir, ".agents", "skills"),
      agentIds: sharedConsumers
    });
  }

  if (selected.has("claude")) {
    groups.push({
      kind: "claude",
      root: join(homeDir, ".claude", "skills"),
      agentIds: ["claude"]
    });
  }

  return groups;
}

export function resolveCanonicalSddSkillDir(skillId, packageRoot) {
  return join(packageRoot, "global-template", "components", "sdd-core", "skills", skillId);
}

export function resolveCanonicalSddSkillPath(skillId, packageRoot) {
  return join(resolveCanonicalSddSkillDir(skillId, packageRoot), "SKILL.md");
}

export function resolveCanonicalSddSkillFile(skillId, relativePath, packageRoot) {
  const parts = String(relativePath ?? "SKILL.md").split(/[/\\]/).filter(Boolean);
  if (parts.length === 0 || parts.includes("..")) {
    throw new Error(`Invalid skill relativePath "${relativePath}".`);
  }
  return join(resolveCanonicalSddSkillDir(skillId, packageRoot), ...parts);
}

export function resolveCanonicalTeachingPersonaPath(packageRoot) {
  return join(packageRoot, "global-template", "components", "sdd-core", "personas", "teaching.md");
}
