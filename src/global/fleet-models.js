/**
 * Unified fleet model profile (~/.harness/fleet-models.json).
 * Multi-agent platforms (Claude + OpenCode) share phase keys.
 * Codex keeps a single default model. Cursor Auto stays IDE-managed.
 */
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveHomeDir } from "./paths.js";
import { writeAtomicJson } from "./runtime/write-atomic-json.js";
import {
  SDD_PHASES,
  loadGentleClaudeAssignments
} from "./fleet-shared.js";
import { parseFrontmatterModel, parseCodexDefaultModel } from "./observability/fleet-platforms.js";

export const FLEET_MODELS_VERSION = 1;

export function fleetModelsPath(homeDir = resolveHomeDir()) {
  return join(homeDir, ".harness", "fleet-models.json");
}

export function emptyFleetProfile() {
  const phases = {};
  for (const id of SDD_PHASES) {
    phases[id] = { claude: null, opencode: null };
  }
  return {
    version: FLEET_MODELS_VERSION,
    claudeDefault: null,
    codexDefault: null,
    cursorAgentModel: "inherit",
    phases,
    note: "Multi-agent phases for Claude + OpenCode. Codex uses codexDefault only. Cursor agents use inherit (Auto is IDE-managed)."
  };
}

async function readJsonSafe(path, read) {
  try {
    return JSON.parse(await read(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Seed profile from Gentle + current on-disk OpenCode/Claude/Codex.
 * Preserves tuned OpenCode models when present.
 */
export async function seedFleetProfile({
  homeDir = resolveHomeDir(),
  read = readFile
} = {}) {
  const profile = emptyFleetProfile();
  const gentle = await loadGentleClaudeAssignments(homeDir, read);
  if (gentle) {
    profile.claudeDefault = gentle.default ?? "sonnet";
    for (const id of SDD_PHASES) {
      if (gentle[id]) profile.phases[id].claude = gentle[id];
    }
  }

  const settings = await readJsonSafe(join(homeDir, ".claude", "settings.json"), read);
  if (settings?.model && !profile.claudeDefault) profile.claudeDefault = settings.model;

  for (const id of SDD_PHASES) {
    try {
      const raw = await read(join(homeDir, ".claude", "agents", `${id}.md`), "utf8");
      const model = parseFrontmatterModel(raw).model;
      if (model && model !== "inherit") profile.phases[id].claude = model;
    } catch { /* missing */ }
  }

  const oc = await readJsonSafe(join(homeDir, ".config", "opencode", "opencode.json"), read);
  const agents = oc?.agent ?? oc?.agents ?? {};
  for (const id of SDD_PHASES) {
    const model = agents[id]?.model;
    // Only declare OpenCode models that exist on disk — never invent from Claude tiers.
    if (typeof model === "string") profile.phases[id].opencode = model;
  }

  try {
    const toml = await read(join(homeDir, ".codex", "config.toml"), "utf8");
    profile.codexDefault = parseCodexDefaultModel(toml);
  } catch { /* missing */ }

  return profile;
}

export async function loadFleetProfile({
  homeDir = resolveHomeDir(),
  read = readFile,
  seedIfMissing = true
} = {}) {
  const path = fleetModelsPath(homeDir);
  const existing = await readJsonSafe(path, read);
  if (existing?.phases) {
    return { profile: existing, path, seeded: false };
  }
  if (!seedIfMissing) {
    return { profile: emptyFleetProfile(), path, seeded: false };
  }
  const profile = await seedFleetProfile({ homeDir, read });
  return { profile, path, seeded: true };
}

export async function saveFleetProfile(profile, {
  homeDir = resolveHomeDir(),
  writeAtomicJsonFn = writeAtomicJson,
  mkdirFn = mkdir
} = {}) {
  const path = fleetModelsPath(homeDir);
  await mkdirFn(dirname(path), { recursive: true });
  const next = {
    ...profile,
    version: FLEET_MODELS_VERSION,
    updatedAt: new Date().toISOString()
  };
  await writeAtomicJsonFn(path, next);
  return { path, profile: next };
}

/** Expand profile → assignment maps used by apply. */
export function profileToPlatformAssignments(profile) {
  const claude = {};
  const opencode = {};
  if (profile.claudeDefault) claude.default = profile.claudeDefault;
  for (const id of SDD_PHASES) {
    const row = profile.phases?.[id] ?? {};
    if (row.claude) claude[id] = row.claude;
    if (row.opencode) opencode[id] = row.opencode;
  }
  return {
    claude,
    opencode,
    codex: profile.codexDefault ? { codex_default: profile.codexDefault } : {},
    cursorAgentModel: profile.cursorAgentModel ?? "inherit"
  };
}

export function formatFleetProfileText(profile, { path = null } = {}) {
  const lines = ["Fleet profile (multi-agent)", ""];
  if (path) lines.push(`Path · ${path}`);
  lines.push(`Claude default · ${profile.claudeDefault ?? "—"}`);
  lines.push(`Codex default  · ${profile.codexDefault ?? "—"} (single-model tool)`);
  lines.push(`Cursor agents  · ${profile.cursorAgentModel ?? "inherit"} (Auto IDE-managed)`);
  lines.push("");
  for (const id of SDD_PHASES) {
    const row = profile.phases?.[id] ?? {};
    lines.push(`${id} · claude ${row.claude ?? "—"} · opencode ${row.opencode ?? "—"}`);
  }
  if (profile.note) {
    lines.push("");
    lines.push(profile.note);
  }
  return lines.join("\n").trimEnd();
}

export async function runFleetModels({
  json = false,
  profile = false,
  homeDir = resolveHomeDir()
} = {}) {
  const { printJson } = await import("./json-output.js");
  const { commandHeader } = await import("./brand/index.js");
  const { buildFleetModelsCatalog, formatFleetModelsText } = await import(
    "./observability/fleet-models-catalog.js"
  );
  const catalog = await buildFleetModelsCatalog({ homeDir });
  if (!profile) {
    if (json) printJson(catalog);
    else {
      console.log(commandHeader("Fleet models"));
      console.log(formatFleetModelsText(catalog));
    }
    return catalog;
  }

  const loaded = await loadFleetProfile({ homeDir, seedIfMissing: true });
  const payload = { ok: true, profile: loaded.profile, path: loaded.path, catalog };
  if (json) printJson(payload);
  else {
    console.log(commandHeader("Fleet models"));
    console.log(formatFleetProfileText(loaded.profile, { path: loaded.path }));
    console.log("");
    console.log(formatFleetModelsText(catalog));
  }
  return payload;
}
