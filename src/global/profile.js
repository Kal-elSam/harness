import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { harnessHomePaths } from "./paths.js";
import { AGENT_CAPABILITY_IDS } from "./agent-capabilities/index.js";
import { classifyCustomBaseUrl, isValidEnvironmentName } from "./intelligence/custom-url.js";
import { validateRuntimeProfile, RUNTIME_PROFILE_KEYS } from "./runtime/run-profile.js";

export const PROFILE_KEYS = new Set([
  "coordinator",
  "defaultAgents",
  "defaultComponents",
  "applyMode",
  "preferredBackend",
  "preferredModel",
  "cloudConsent",
  "tokenBudget",
  "stableContextBudget",
  "requestContextBudget",
  "customProviders",
  ...RUNTIME_PROFILE_KEYS
]);

export const DEFAULT_PROFILE = {
  coordinator: null,
  defaultAgents: "detected",
  defaultComponents: null,
  applyMode: "prompt",
  preferredBackend: null,
  preferredModel: null,
  cloudConsent: false,
  tokenBudget: null,
  stableContextBudget: null,
  requestContextBudget: null,
  customProviders: [],
  agentAliases: {},
  modelAliases: {},
  defaultPermissions: [],
  defaultRuntimeAgent: null,
  defaultRuntimeModel: null,
  captureTranscript: false
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
  merged.customProviders = sanitizeCustomProviders(merged.customProviders);

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
    preferredBackend: profile.preferredBackend,
    preferredModel: profile.preferredModel,
    cloudConsent: profile.cloudConsent,
    tokenBudget: profile.tokenBudget,
    stableContextBudget: profile.stableContextBudget,
    requestContextBudget: profile.requestContextBudget,
    customProviders: sanitizeCustomProviders(profile.customProviders),
    agentAliases: profile.agentAliases ?? {},
    modelAliases: profile.modelAliases ?? {},
    defaultPermissions: profile.defaultPermissions ?? [],
    defaultRuntimeAgent: profile.defaultRuntimeAgent ?? null,
    defaultRuntimeModel: profile.defaultRuntimeModel ?? null,
    captureTranscript: profile.captureTranscript ?? false,
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

  if (profile.cloudConsent != null && typeof profile.cloudConsent !== "boolean") {
    throw new Error("Profile cloudConsent must be a boolean.");
  }

  for (const key of ["tokenBudget", "stableContextBudget", "requestContextBudget"]) {
    if (profile[key] != null && (!Number.isFinite(profile[key]) || profile[key] < 1)) {
      throw new Error(`Profile ${key} must be a positive number or null.`);
    }
  }

  if (profile.preferredBackend != null && typeof profile.preferredBackend !== "string") {
    throw new Error("Profile preferredBackend must be a string or null.");
  }

  if (profile.preferredModel != null && typeof profile.preferredModel !== "string") {
    throw new Error("Profile preferredModel must be a string or null.");
  }

  validateNoSecrets(profile);
  validateCustomProviders(profile.customProviders);
  validateRuntimeProfile(profile);
}

/**
 * Secret-looking key segments after camelCase → snake_case normalization.
 * `api_key_env` is the only credential-related key allowed (env var name, not a secret).
 */
const SECRET_KEY_PATTERN = /(^|_)(api_?key|api_?token|access_?token|auth_?token|client_?secret|private_?key|authorization(_header)?|password|secrets?|credentials?|bearer|token)(_|$)/;
const SECRET_KEY_ALLOWLIST = new Set([
  "api_key_env",
  "token_budget",
  "stable_context_budget",
  "request_context_budget"
]);
const SECRET_VALUE_PATTERN = /^(sk-[A-Za-z0-9]|sk-or-|gh[pousr]_|xox[baprs]-|AKIA[0-9A-Z]{16}\b|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.)|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

export function normalizeProfileKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
}

export function isForbiddenSecretKey(key) {
  const normalized = normalizeProfileKey(key);
  if (SECRET_KEY_ALLOWLIST.has(normalized)) return false;
  return SECRET_KEY_PATTERN.test(normalized);
}

function validateNoSecrets(profile) {
  walkForSecrets(profile);
}

function walkForSecrets(value) {
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value)) {
      throw new Error("Profile must not store credential-like values. Use environment variables.");
    }
    return;
  }
  if (value == null || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = normalizeProfileKey(key);

    // apiKeyEnv is the only allowed credential-related key: it names an env var.
    if (normalizedKey === "api_key_env") {
      if (typeof nested === "string" && SECRET_VALUE_PATTERN.test(nested)) {
        throw new Error("Profile must not store credential-like values. Use environment variables.");
      }
      continue;
    }

    if (isForbiddenSecretKey(key)) {
      throw new Error(`Profile must not store credentials (rejected key "${key}"). Use environment variables.`);
    }
    if (typeof nested === "string" && SECRET_VALUE_PATTERN.test(nested)) {
      throw new Error("Profile must not store credential-like values. Use environment variables.");
    }
    walkForSecrets(nested);
  }
}

function validateCustomProviders(providers) {
  if (providers == null) return;
  if (!Array.isArray(providers)) {
    throw new Error("Profile customProviders must be an array.");
  }

  for (const provider of providers) {
    if (provider == null || typeof provider !== "object" || Array.isArray(provider)) {
      throw new Error("Each customProviders entry must be an object.");
    }
    if (!provider.baseUrl || typeof provider.baseUrl !== "string") {
      throw new Error("customProviders entries require baseUrl.");
    }
    for (const key of Object.keys(provider)) {
      if (normalizeProfileKey(key) === "api_key_env") continue;
      if (isForbiddenSecretKey(key)) {
        throw new Error(`customProviders must not include "${key}". Use apiKeyEnv to name an environment variable.`);
      }
    }
    if (provider.apiKey != null || provider.token != null || provider.secret != null) {
      throw new Error("customProviders must not embed secrets. Set apiKeyEnv to an environment variable name.");
    }
    if (provider.apiKeyEnv != null && !isValidEnvironmentName(provider.apiKeyEnv)) {
      throw new Error("customProviders apiKeyEnv must be a valid uppercase environment variable name.");
    }
    const location = classifyCustomBaseUrl(provider.baseUrl);
    if (provider.apiKeyEnv && !location.local) {
      throw new Error(
        "Remote custom providers cannot use apiKeyEnv in 0.2.0; use a built-in provider or a local endpoint."
      );
    }
  }
}

function sanitizeCustomProviders(providers) {
  if (!Array.isArray(providers)) return [];
  return providers.map((provider) => ({
    id: provider.id ?? "custom",
    label: provider.label ?? "Custom provider",
    baseUrl: provider.baseUrl,
    modelId: provider.modelId ?? null,
    apiKeyEnv: provider.apiKeyEnv ?? null,
    local: classifyCustomBaseUrl(provider.baseUrl).local
  }));
}
