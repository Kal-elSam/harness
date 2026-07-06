import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DEFAULT_COMPONENT_IDS } from "./component-registry.js";
import { GLOBAL_AGENT_IDS, detectInstalledAdapters } from "./registry.js";
import { shouldPromptApplyConfirmation } from "./apply-confirmation.js";
import { harnessHomePaths } from "./paths.js";

export const POLICY_PROFILES = {
  safe: { applyMode: "prompt", preflight: true },
  ci: { applyMode: "confirm", preflight: true },
  fast: { applyMode: "confirm", preflight: true }
};

export const DEFAULT_POLICY = {
  applyMode: "prompt",
  preflight: true,
  agents: "detected",
  components: [...DEFAULT_COMPONENT_IDS]
};

const POLICY_KEYS = new Set(["profile", "applyMode", "preflight", "agents", "components"]);
const APPLY_MODES = new Set(["prompt", "confirm"]);
const AGENT_MODES = new Set(["detected", "all", ...GLOBAL_AGENT_IDS]);

export function getPolicyPath(homeDir) {
  return harnessHomePaths(homeDir).policyPath;
}

export async function loadPolicyFile(homeDir) {
  const policyPath = getPolicyPath(homeDir);
  if (!existsSync(policyPath)) return null;

  let parsed;
  try {
    parsed = JSON.parse(await readFile(policyPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid policy file at ${policyPath}: ${error.message}`);
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid policy file at ${policyPath}: expected a JSON object.`);
  }

  return parsed;
}

export function resolvePolicy(rawPolicy = {}) {
  const profileName = rawPolicy.profile ?? null;
  const profileDefaults = profileName ? POLICY_PROFILES[profileName] : null;

  if (profileName && !profileDefaults) {
    throw new Error(`Unknown policy profile "${profileName}". Use safe, ci, or fast.`);
  }

  const resolved = {
    ...DEFAULT_POLICY,
    ...(profileDefaults ?? {}),
    ...pickPolicyFields(rawPolicy)
  };

  if (profileName) {
    resolved.profile = profileName;
  }

  validateResolvedPolicy(resolved);
  return resolved;
}

export function buildPolicyJson(homeDir, rawPolicy) {
  const policyPath = getPolicyPath(homeDir);
  const hasFile = rawPolicy != null;
  const resolved = resolvePolicy(rawPolicy ?? {});
  const effective = buildEffectivePolicyFromRaw(homeDir, rawPolicy);

  return {
    profile: rawPolicy?.profile ?? null,
    applyMode: resolved.applyMode,
    preflight: resolved.preflight,
    agents: resolved.agents,
    components: resolved.components,
    source: hasFile ? "file" : "defaults",
    path: policyPath,
    effective
  };
}

export async function buildEffectivePolicy(homeDir) {
  const rawPolicy = await loadPolicyFile(homeDir);
  return buildEffectivePolicyFromRaw(homeDir, rawPolicy);
}

export function buildEffectivePolicyFromRaw(homeDir, rawPolicy) {
  const resolved = resolvePolicy(rawPolicy ?? {});

  return {
    source: rawPolicy ? "file" : "none",
    profile: resolved.profile ?? null,
    applyMode: resolved.applyMode,
    preflight: resolved.preflight,
    agents: formatPolicyAgentsLabel(resolved.agents, homeDir),
    components: [...resolved.components],
    path: getPolicyPath(homeDir)
  };
}

export function formatPolicyAgentsLabel(agents, homeDir) {
  if (agents === "detected") return "detected";
  if (agents === "all") return "all";
  return agents.join(", ");
}

export function formatPolicySourceLabel(policy) {
  if (policy.source === "file") {
    return `file (${policy.path})`;
  }

  return "none (defaults, no policy file)";
}

export function formatPolicyProfileLabel(profile) {
  return profile ?? "none";
}

export function resolveConsentAudit({
  yes = false,
  confirm = false,
  yesExplicit = false,
  confirmExplicit = false,
  noPreflight = false,
  preflightExplicit = false,
  rawPolicy = null,
  interactive = false,
  applying = true,
  dryRun = false,
  json = false
}) {
  const policyProfile = formatPolicyProfileLabel(rawPolicy?.profile ?? null);

  if (!applying || dryRun || json) {
    return { consentSource: "none", policyProfile };
  }

  if (yesExplicit || confirmExplicit || (noPreflight && preflightExplicit)) {
    return { consentSource: "cli", policyProfile };
  }

  if (rawPolicy && confirm && !yesExplicit && !confirmExplicit) {
    const resolved = resolvePolicy(rawPolicy);
    if (resolved.applyMode === "confirm") {
      return { consentSource: "policy", policyProfile };
    }
  }

  if (shouldPromptApplyConfirmation({ applying, dryRun, json, confirm, interactive })) {
    return { consentSource: "interactive", policyProfile };
  }

  if (yes || confirm) {
    return { consentSource: "cli", policyProfile };
  }

  return { consentSource: "none", policyProfile };
}

export async function loadConsentAudit(homeDir, options) {
  const rawPolicy = await loadPolicyFile(homeDir);
  const consent = resolveConsentAudit({
    yes: options.yes,
    confirm: options.confirm,
    yesExplicit: options.yesExplicit,
    confirmExplicit: options.confirmExplicit,
    noPreflight: !options.preflight,
    preflightExplicit: options.preflightExplicit,
    rawPolicy,
    interactive: options.interactive,
    applying: options.applying,
    dryRun: options.dryRun,
    json: options.json
  });

  return { rawPolicy, ...consent };
}

export function applyPolicyToOptions(options, rawPolicy) {
  if (rawPolicy == null) return options;

  const resolved = resolvePolicy(rawPolicy);
  const merged = { ...options };

  if (!options.preflightExplicit && resolved.preflight != null) {
    merged.preflight = resolved.preflight;
  }

  if (!options.yesExplicit && !options.confirmExplicit && resolved.applyMode === "confirm") {
    merged.confirm = true;
  }

  if (!options.adaptersExplicit) {
    merged.adapters = resolvePolicyAgents(resolved.agents);
    merged.allAdapters = resolved.agents === "all";
  }

  if (!options.componentsExplicit && resolved.components != null) {
    merged.components = [...resolved.components];
    merged.noDefaultComponents = resolved.components.length === 0;
  }

  return merged;
}

export async function savePolicyField(homeDir, key, value) {
  validatePolicyKey(key);
  const parsedValue = parsePolicyValue(key, value);
  const current = (await loadPolicyFile(homeDir)) ?? {};
  const next = { ...current, [key]: parsedValue };

  if (key === "profile") {
    delete next.applyMode;
    delete next.preflight;
  }

  await writePolicyFile(homeDir, next);
  return resolvePolicy(next);
}

export async function resetPolicyFile(homeDir) {
  const policyPath = getPolicyPath(homeDir);
  if (!existsSync(policyPath)) return false;
  await unlink(policyPath);
  return true;
}

export async function writePolicyFile(homeDir, policy) {
  const { root, policyPath } = harnessHomePaths(homeDir);
  await mkdir(root, { recursive: true });
  validateResolvedPolicy(resolvePolicy(policy));
  await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
}

function pickPolicyFields(rawPolicy) {
  const picked = {};

  for (const key of POLICY_KEYS) {
    if (rawPolicy[key] !== undefined) {
      picked[key] = rawPolicy[key];
    }
  }

  return picked;
}

function resolvePolicyAgents(agents) {
  if (agents === "detected") return null;
  if (agents === "all") return ["all"];
  if (Array.isArray(agents)) return [...agents];
  throw new Error(`Invalid policy agents value "${agents}".`);
}

function validatePolicyKey(key) {
  if (!POLICY_KEYS.has(key)) {
    throw new Error(`Unknown policy key "${key}". Use ${[...POLICY_KEYS].join(", ")}.`);
  }
}

function parsePolicyValue(key, value) {
  switch (key) {
    case "profile": {
      if (!POLICY_PROFILES[value]) {
        throw new Error(`Unknown policy profile "${value}". Use safe, ci, or fast.`);
      }
      return value;
    }
    case "applyMode": {
      if (!APPLY_MODES.has(value)) {
        throw new Error(`Invalid applyMode "${value}". Use prompt or confirm.`);
      }
      return value;
    }
    case "preflight": {
      return parseBooleanValue(value, "preflight");
    }
    case "agents": {
      if (AGENT_MODES.has(value)) return value;
      const items = parseListValue(value);
      for (const item of items) {
        if (!GLOBAL_AGENT_IDS.includes(item)) {
          throw new Error(`Unknown agent "${item}". Use ${GLOBAL_AGENT_IDS.join(", ")}, detected, or all.`);
        }
      }
      return items;
    }
    case "components": {
      return parseListValue(value);
    }
    default: {
      const _exhaustive = key;
      throw new Error(`Unknown policy key "${_exhaustive}".`);
    }
  }
}

function parseBooleanValue(value, label) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid ${label} value "${value}". Use true or false.`);
}

function parseListValue(value) {
  if (!value) return [];
  return [...new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function validateResolvedPolicy(policy) {
  if (!APPLY_MODES.has(policy.applyMode)) {
    throw new Error(`Invalid applyMode "${policy.applyMode}". Use prompt or confirm.`);
  }

  if (typeof policy.preflight !== "boolean") {
    throw new Error("Policy preflight must be a boolean.");
  }

  if (policy.agents === "detected" || policy.agents === "all") {
    return;
  }

  if (!Array.isArray(policy.agents)) {
    throw new Error('Policy agents must be "detected", "all", or an agent list.');
  }

  for (const agent of policy.agents) {
    if (!GLOBAL_AGENT_IDS.includes(agent)) {
      throw new Error(`Unknown agent "${agent}" in policy.`);
    }
  }

  if (!Array.isArray(policy.components)) {
    throw new Error("Policy components must be an array.");
  }
}
