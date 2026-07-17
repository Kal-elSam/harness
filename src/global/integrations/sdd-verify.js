import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashBuffer } from "../../hash.js";
import { resolveAdapter } from "../registry.js";
import { applySddConfigure } from "./sdd-apply.js";
import { classifySddVerifyHealth, SDD_HEALTH } from "./sdd-evidence.js";
import {
  SDD_SKILL_IDS,
  groupSddSkillDestinations,
  resolveCanonicalTeachingPersonaPath,
  resolveSddAgentSelection
} from "./sdd-destinations.js";
import {
  classifyPersonaHealth,
  derivePersona,
  normalizePersonaAgentIds,
  SDD_PERSONA_GATE
} from "./sdd-persona.js";
import { compareSkillPaths, loadCanonicalSddSkill } from "./sdd-skill-files.js";

/** Read-only verify: configured | missing | drifted | conflict (canonical vs disk). */
export async function verifySddConfigure({
  requestedAgentIds = null,
  detectedAgentIds = [],
  homeDir,
  packageRoot,
  trackedFiles = {},
  personaAgentIds = [],
  exists = existsSync,
  readFileImpl = readFile
} = {}) {
  if (!homeDir) throw new Error("verifySddConfigure requires homeDir.");
  if (!packageRoot) throw new Error("verifySddConfigure requires packageRoot.");

  const agentIds = resolveSddAgentSelection({
    requestedIds: requestedAgentIds,
    detectedIds: detectedAgentIds
  });
  const groups = groupSddSkillDestinations(agentIds, homeDir);
  const findings = [];

  for (const skillId of SDD_SKILL_IDS) {
    const { files, skillHash } = await loadCanonicalSddSkill(skillId, packageRoot);
    for (const file of files) {
      const canonicalHash = hashBuffer(file.bytes);
      for (const group of groups) {
        const destinationPath = join(group.root, skillId, ...file.relativePath.split("/"));
        const fileExists = exists(destinationPath);
        const diskHash = fileExists ? hashBuffer(await readFileImpl(destinationPath)) : null;
        const trackedHash = trackedFiles[destinationPath] ?? null;
        const health = classifySddVerifyHealth({
          exists: fileExists, canonicalHash, diskHash, trackedHash
        });
        findings.push({
          skillId, relativePath: file.relativePath, destinationPath,
          agentIds: [...group.agentIds], kind: group.kind,
          status: health.status, drift: health.drift, reason: health.reason,
          canonicalHash, skillHash, diskHash, trackedHash
        });
      }
    }
  }

  findings.sort((a, b) => compareSkillPaths(a.skillId, b.skillId)
    || compareSkillPaths(a.relativePath, b.relativePath)
    || compareSkillPaths(a.destinationPath, b.destinationPath));

  const summary = { configured: 0, missing: 0, drifted: 0, conflict: 0 };
  for (const entry of findings) summary[entry.status] += 1;

  const consumers = normalizePersonaAgentIds(personaAgentIds);
  const incompleteAgentIds = consumers.filter((id) => {
    const mine = findings.filter((entry) => entry.agentIds.includes(id));
    return !mine.length || mine.some((entry) => entry.status !== SDD_HEALTH.CONFIGURED);
  });
  let gatePresent = true;
  for (const id of consumers) {
    const path = join(homeDir, resolveAdapter(id).assets.configFile);
    if (!exists(path) || !String(await readFileImpl(path, "utf8")).includes(SDD_PERSONA_GATE)) {
      gatePresent = false;
      break;
    }
  }
  const personaHealth = classifyPersonaHealth({
    personaAgentIds: consumers,
    assetPresent: exists(resolveCanonicalTeachingPersonaPath(packageRoot)),
    gatePresent,
    incompleteAgentIds
  });

  return {
    provider: "sdd-core", componentId: "sdd-core", agentIds, findings, summary,
    status: summarizeSddHealth(summary),
    ok: summary.missing === 0 && summary.drifted === 0 && summary.conflict === 0,
    persona: {
      ...personaHealth, persona: derivePersona(consumers), personaAgentIds: consumers, incompleteAgentIds
    }
  };
}

export function summarizeSddHealth(summary) {
  if (summary.conflict > 0) return SDD_HEALTH.CONFLICT;
  if (summary.missing > 0) return SDD_HEALTH.MISSING;
  if (summary.drifted > 0) return SDD_HEALTH.DRIFTED;
  return SDD_HEALTH.CONFIGURED;
}

/** Sync = verify then apply; conflicts block writes. */
export async function syncSddConfigure(options = {}) {
  const verification = await verifySddConfigure(options);
  if (verification.summary.conflict > 0) {
    return {
      ...verification,
      synced: false,
      blocked: true,
      applied: false,
      cancelled: false,
      receipt: null,
      reason: "Conflicts present; refusing sync overwrite."
    };
  }
  const result = await applySddConfigure(options);
  return { ...result, verification, synced: Boolean(result.applied), blocked: false };
}
