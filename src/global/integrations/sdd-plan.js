import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashBuffer } from "../../hash.js";
import { classifySddSkillFile, SDD_PLAN_ACTIONS } from "./sdd-evidence.js";
import {
  SDD_PERSONA_IDS,
  SDD_SKILL_IDS,
  groupSddSkillDestinations,
  resolveCanonicalSddSkillPath,
  resolveCanonicalTeachingPersonaPath,
  resolveSddAgentSelection
} from "./sdd-destinations.js";

/**
 * Deterministic dry-run planner for SDD skill materialization.
 * Never writes, backs up, or mutates state.
 */
export async function planSddConfigure({
  requestedAgentIds = null,
  detectedAgentIds = [],
  homeDir,
  packageRoot,
  persona = "off",
  trackedFiles = {},
  dryRun = true,
  exists = existsSync,
  readFileImpl = readFile
} = {}) {
  if (!homeDir) throw new Error("planSddConfigure requires homeDir.");
  if (!packageRoot) throw new Error("planSddConfigure requires packageRoot.");
  if (!SDD_PERSONA_IDS.includes(persona)) {
    throw new Error(`Persona "${persona}" is invalid. Use: ${SDD_PERSONA_IDS.join(", ")}.`);
  }

  const agentIds = resolveSddAgentSelection({
    requestedIds: requestedAgentIds,
    detectedIds: detectedAgentIds
  });
  const destinationGroups = groupSddSkillDestinations(agentIds, homeDir);
  const actions = [];

  for (const skillId of SDD_SKILL_IDS) {
    const canonicalPath = resolveCanonicalSddSkillPath(skillId, packageRoot);
    const canonicalBytes = await readFileImpl(canonicalPath);
    const canonicalHash = hashBuffer(canonicalBytes);

    for (const group of destinationGroups) {
      const destinationPath = join(group.root, skillId, "SKILL.md");
      const trackedHash = trackedFiles[destinationPath] ?? null;
      const fileExists = exists(destinationPath);
      const diskHash = fileExists ? hashBuffer(await readFileImpl(destinationPath)) : null;
      const classification = classifySddSkillFile({
        exists: fileExists,
        canonicalHash,
        diskHash,
        trackedHash
      });

      actions.push({
        skillId,
        destinationPath,
        agentIds: [...group.agentIds],
        kind: group.kind,
        action: classification.action,
        reason: classification.reason,
        canonicalHash,
        diskHash,
        trackedHash,
        writes: false,
        executes: false
      });
    }
  }

  actions.sort((left, right) => {
    const bySkill = left.skillId.localeCompare(right.skillId);
    if (bySkill !== 0) return bySkill;
    return left.destinationPath.localeCompare(right.destinationPath);
  });

  const summary = {
    create: 0,
    noop: 0,
    update: 0,
    conflict: 0
  };
  for (const action of actions) {
    summary[action.action] += 1;
  }

  return {
    provider: "sdd-core",
    componentId: "sdd-core",
    dryRun: Boolean(dryRun),
    executes: false,
    writes: false,
    persona,
    personaPath: resolveCanonicalTeachingPersonaPath(packageRoot),
    personaActive: persona === "teaching",
    agentIds,
    actions,
    conflicts: actions.filter((entry) => entry.action === SDD_PLAN_ACTIONS.CONFLICT),
    summary,
    sessionRefreshRequired: false
  };
}
