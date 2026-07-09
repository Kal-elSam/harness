import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { harnessHomePaths } from "./paths.js";
import { AGENT_CAPABILITY_IDS } from "./agent-capabilities/index.js";

export const PROFILE_KEYS = new Set([
  "coordinator",
  "defaultAgents",
  "defaultComponents",
  "applyMode"
]);

export const DEFAULT_PROFILE = {
  coordinator: null,
  defaultAgents: "detected",
  defaultComponents: null,
  applyMode: "prompt"
};

const APPLY_MODES = new Set(["prompt", "confirm"]);

export function getGlobalProfilePath(homeDir) {
  return join(harnessHomePaths(homeDir).root, "profile.json");
}

export function getProjectProfilePath(workspaceRoot) {
  return join(workspaceRoot, ".harness", "kairo.json");
}

export async function loadProfileFile(filePath) {
  if (!existsSync(filePath)) return null;

  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid profile file at ${filePath}: ${error.message}`);
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid profile file at ${filePath}: expected a JSON object.`);
  }

  return parsed;
}

export async function loadGlobalProfile(homeDir) {
  return loadProfileFile(getGlobalProfilePath(homeDir));
}

export async function loadProjectProfile(workspaceRoot) {
  return loadProfileFile(getProjectProfilePath(workspaceRoot));
}

export async function resolveProfile({ homeDir, workspaceRoot }) {
  const globalRaw = await loadGlobalProfile(homeDir);
  const projectRaw = await loadProjectProfile(workspaceRoot);

  const merged = {
    ...DEFAULT_PROFILE,
    ...(globalRaw ?? {}),
    ...(projectRaw ?? {})
  };

  validateProfile(merged);

  return {
    profile: merged,
    sources: {
      global: globalRaw ? getGlobalProfilePath(homeDir) : null,
      project: projectRaw ? getProjectProfilePath(workspaceRoot) : null
    }
  };
}

export function buildProfileJson(resolved) {
  const { profile, sources } = resolved;

  return {
    coordinator: profile.coordinator,
    defaultAgents: profile.defaultAgents,
    defaultComponents: profile.defaultComponents,
    applyMode: profile.applyMode,
    sources: {
      global: sources.global,
      project: sources.project,
      precedence: "project overrides global overrides defaults"
    }
  };
}

export async function saveGlobalProfile(homeDir, profile) {
  validateProfile(profile);
  const { root } = harnessHomePaths(homeDir);
  const profilePath = getGlobalProfilePath(homeDir);
  await mkdir(root, { recursive: true });
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return profilePath;
}

export function resolveProfileAgents(profile, detectedAgentIds) {
  if (profile.defaultAgents === "detected") {
    return detectedAgentIds.length > 0 ? [...detectedAgentIds] : [...AGENT_CAPABILITY_IDS];
  }

  if (profile.defaultAgents === "all") {
    return [...AGENT_CAPABILITY_IDS];
  }

  if (Array.isArray(profile.defaultAgents)) {
    return profile.defaultAgents.filter((id) => AGENT_CAPABILITY_IDS.includes(id));
  }

  return [...AGENT_CAPABILITY_IDS];
}

function validateProfile(profile) {
  if (profile.coordinator != null && !AGENT_CAPABILITY_IDS.includes(profile.coordinator)) {
    throw new Error(`Unknown coordinator "${profile.coordinator}". Use ${AGENT_CAPABILITY_IDS.join(", ")} or null.`);
  }

  if (!APPLY_MODES.has(profile.applyMode)) {
    throw new Error(`Invalid applyMode "${profile.applyMode}". Use prompt or confirm.`);
  }

  if (
    profile.defaultAgents !== "detected"
    && profile.defaultAgents !== "all"
    && !Array.isArray(profile.defaultAgents)
  ) {
    throw new Error('Profile defaultAgents must be "detected", "all", or an agent list.');
  }

  if (Array.isArray(profile.defaultAgents)) {
    for (const agent of profile.defaultAgents) {
      if (!AGENT_CAPABILITY_IDS.includes(agent)) {
        throw new Error(`Unknown agent "${agent}" in profile.`);
      }
    }
  }

  if (profile.defaultComponents != null && !Array.isArray(profile.defaultComponents)) {
    throw new Error("Profile defaultComponents must be an array or null.");
  }
}
