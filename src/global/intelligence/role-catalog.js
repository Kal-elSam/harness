// One role catalog per project: Kairo's built-in roles, gentle-ai's workflow
// roles, and the user's own roles from `<project>/.kairo/roles.json`.
// Entries are registry-shaped, so the capability-based selection scores every
// role the same way (pass the catalog as `roleCatalog` to the team builders).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_REGISTRY } from "./role-registry.js";
import { ROLE_DEMAND_FLOORS } from "./role-demand.js";

export const USER_ROLES_FILE = join(".kairo", "roles.json");

/** gentle-ai workflow roles. Each takes its capabilities, tier and metric weights from `sourceRole`. */
export const GENTLE_WORKFLOW_ROLES = Object.freeze({
  "odd-explorer": { sourceRole: "Explorer" },
  "odd-worker": { sourceRole: "Builder" },
  "odd-verify": { sourceRole: "Verifier" },
  "review-risk": { sourceRole: "Security Reviewer" },
  "review-resilience": { sourceRole: "Reviewer" },
  "review-readability": { sourceRole: "Reviewer" },
  "review-reliability": { sourceRole: "Reviewer" },
  "review-refuter": { sourceRole: "Reviewer" },
  "jd-judge-a": { sourceRole: "Reviewer" },
  "jd-judge-b": { sourceRole: "Reviewer" },
  "jd-fix-agent": { sourceRole: "Builder" }
});

const CAPABILITY_IDS = new Set(Object.values(ROLE_REGISTRY).flatMap(entry => [...entry.capabilities.required, ...entry.capabilities.optional]));
const TIERS = Object.keys(ROLE_DEMAND_FLOORS);
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9 ._-]*$/;

function derived(id, base, extra) {
  const { profile, ...rest } = base;
  const entry = { ...rest, defaultTeam: false, alwaysOn: false, orchestrator: false, agents: [], ...extra };
  entry.profile = { ...profile, role: id, capabilities: entry.capabilities };
  return entry;
}

function builtinRegistry() {
  const registry = {};
  for (const [id, base] of Object.entries(ROLE_REGISTRY)) {
    registry[id] = { ...base, owner: "kairo", agents: [], profile: { ...base.profile, role: id, capabilities: base.capabilities } };
    registry[id].defaultTeam = base.defaultTeam;
  }
  for (const [id, { sourceRole }] of Object.entries(GENTLE_WORKFLOW_ROLES)) {
    registry[id] = derived(id, ROLE_REGISTRY[sourceRole], { owner: "gentle-ai", sourceRole });
  }
  return registry;
}

const equalWeights = capabilities => Object.fromEntries(capabilities.map(capability => [capability, 1 / capabilities.length]));

function validate(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { errors: ["roles: file must be an object with a roles array"], roles: [] };
  if (!Array.isArray(raw.roles)) return { errors: ["roles: must be an array"], roles: [] };
  raw.roles.forEach((role, index) => {
    const at = field => `roles[${index}]${field ? `.${field}` : ""}`;
    if (!role || typeof role !== "object" || Array.isArray(role)) { errors.push(`${at()}: must be an object`); return; }
    if (typeof role.id !== "string" || !ID_PATTERN.test(role.id)) errors.push(`${at("id")}: must be a string like "Data Wrangler"`);
    if (role.description !== undefined && typeof role.description !== "string") errors.push(`${at("description")}: must be a string`);
    if (role.capabilities !== undefined) {
      if (!Array.isArray(role.capabilities) || !role.capabilities.length) errors.push(`${at("capabilities")}: must be a non-empty array`);
      else role.capabilities.forEach((capability, i) => {
        if (!CAPABILITY_IDS.has(capability)) errors.push(`${at(`capabilities[${i}]`)}: unknown capability ${JSON.stringify(capability)} (known: ${[...CAPABILITY_IDS].join(", ")})`);
      });
    }
    const floor = role.qualityFloor;
    if (floor !== undefined && !(TIERS.includes(floor) || (typeof floor === "number" && floor >= 0 && floor <= 1))) {
      errors.push(`${at("qualityFloor")}: must be a number from 0 to 1 or one of ${TIERS.join(", ")}`);
    }
    if (role.agents !== undefined && (!Array.isArray(role.agents) || role.agents.some(name => typeof name !== "string" || !name.trim()))) {
      errors.push(`${at("agents")}: must be an array of non-empty strings`);
    }
    if (role.extends !== undefined && typeof role.extends !== "string") errors.push(`${at("extends")}: must be a role id`);
  });
  return { errors, roles: raw.roles };
}

/**
 * Built-in + gentle-ai + user roles for one project. Never throws: an invalid
 * roles file is ignored as a whole and reported in `warnings`.
 * @returns {{registry: Record<string, object>, warnings: string[], overrides: string[], source: string|null}}
 */
export function loadProjectRoleCatalog({ projectRoot } = {}) {
  const registry = builtinRegistry();
  const warnings = [];
  const overrides = [];
  const file = projectRoot ? join(projectRoot, USER_ROLES_FILE) : null;
  if (!file || !existsSync(file)) return { registry, warnings, overrides, source: null };
  let raw;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (error) {
    return { registry, warnings: [`${USER_ROLES_FILE}: cannot read roles (${error.message}); using built-in roles only`], overrides, source: file };
  }
  const { errors, roles } = validate(raw);
  const seen = new Set();
  roles.forEach((role, index) => {
    if (typeof role?.id !== "string") return;
    if (seen.has(role.id)) errors.push(`roles[${index}].id: duplicate id ${JSON.stringify(role.id)}`);
    seen.add(role.id);
    const exists = Object.hasOwn(registry, role.id);
    if (!exists && typeof role.description !== "string") errors.push(`roles[${index}].description: required for a new role`);
    if (!exists && role.extends === undefined && !Array.isArray(role.capabilities)) errors.push(`roles[${index}].capabilities: required for a new role`);
    if (role.extends !== undefined && !Object.hasOwn(registry, role.extends)) errors.push(`roles[${index}].extends: unknown role ${JSON.stringify(role.extends)}`);
  });
  if (errors.length) return { registry, warnings: [...errors.map(message => `${USER_ROLES_FILE} ${message}`), "ignoring the roles file; using built-in roles only"], overrides, source: file };

  for (const role of roles) {
    const existing = registry[role.id];
    const base = existing ?? registry[role.extends ?? "Builder"];
    const next = existing ? { ...existing } : derived(role.id, base, { owner: "user", extendsRole: role.extends ?? null, workVolume: .5 });
    if (existing) overrides.push(role.id);
    if (typeof role.description === "string") next.description = role.description;
    if (role.capabilities) {
      next.capabilities = { required: [...role.capabilities], optional: [] };
      next.metricWeights = equalWeights(role.capabilities);
    }
    if (typeof role.qualityFloor === "number") next.floor = role.qualityFloor;
    else if (role.qualityFloor) { next.tier = role.qualityFloor; delete next.floor; }
    if (role.agents) next.agents = [...role.agents];
    next.profile = { ...next.profile, role: role.id, capabilities: next.capabilities,
      ...(typeof role.description === "string" ? { objective: role.description } : {}) };
    registry[role.id] = next;
  }
  return { registry, warnings, overrides, source: file };
}

/** Role id -> capability requirement ({required, optional}) for selection; all roles unless `roleIds` is given. */
export function catalogRoleCapabilities(catalog, roleIds = null) {
  const ids = roleIds ?? Object.keys(catalog.registry);
  return Object.fromEntries(ids.filter(id => catalog.registry[id]).map(id => [id, catalog.registry[id].capabilities]));
}

/**
 * Agent name -> role id. A role's own id and its `agents` all map to it.
 * Catalog order decides: the first role to claim a name wins and the clash is reported.
 * @returns {{byAgent: Map<string, string>, warnings: string[]}}
 */
export function agentNameToRole(catalog) {
  const byAgent = new Map();
  const warnings = [];
  for (const [id, entry] of Object.entries(catalog.registry)) {
    for (const name of new Set([id, ...(entry.agents ?? [])])) {
      if (byAgent.has(name) && byAgent.get(name) !== id) warnings.push(`agent name ${JSON.stringify(name)} is claimed by roles ${JSON.stringify(byAgent.get(name))} and ${JSON.stringify(id)}; keeping ${JSON.stringify(byAgent.get(name))}`);
      else byAgent.set(name, id);
    }
  }
  return { byAgent, warnings };
}
