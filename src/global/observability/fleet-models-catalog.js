/**
 * Declared / known model catalogs per platform (read-only discovery).
 * Not a live marketplace scrape — what is configured or known-safe on disk.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveHomeDir } from "../paths.js";
import { parseCodexDefaultModel, parseFrontmatterModel } from "./fleet-platforms.js";

export const CLAUDE_TIERS = Object.freeze(["opus", "sonnet", "haiku"]);

export const CURSOR_AGENT_MODELS = Object.freeze(["inherit", "fast"]);

async function readJson(path, read) {
  try {
    return JSON.parse(await read(path, "utf8"));
  } catch {
    return null;
  }
}

async function collectOpenCodeModels(homeDir, read) {
  const path = join(homeDir, ".config", "opencode", "opencode.json");
  const config = await readJson(path, read);
  const ids = new Set();
  if (typeof config?.model === "string") ids.add(config.model);
  for (const raw of Object.values(config?.agent ?? config?.agents ?? {})) {
    if (typeof raw?.model === "string") ids.add(raw.model);
  }
  return {
    platform: "opencode",
    kind: "multi",
    path,
    available: [...ids].sort(),
    enabled: typeof config?.model === "string" ? [config.model] : [],
    note: "From opencode.json (declared agents + default)."
  };
}

async function collectClaudeModels(homeDir, read, list = readdir) {
  const settingsPath = join(homeDir, ".claude", "settings.json");
  const settings = await readJson(settingsPath, read);
  const enabled = [];
  if (typeof settings?.model === "string") enabled.push(settings.model);
  try {
    const dir = join(homeDir, ".claude", "agents");
    for (const name of await list(dir)) {
      if (!name.endsWith(".md")) continue;
      const meta = parseFrontmatterModel(await read(join(dir, name), "utf8"));
      if (meta.model) enabled.push(meta.model);
    }
  } catch { /* missing */ }
  return {
    platform: "claude",
    kind: "multi",
    path: settingsPath,
    available: [...CLAUDE_TIERS],
    enabled: [...new Set(enabled)],
    note: "Claude Code tiers (opus/sonnet/haiku) + agents frontmatter."
  };
}

async function collectCodexModels(homeDir, read) {
  const path = join(homeDir, ".codex", "config.toml");
  let current = null;
  try {
    current = parseCodexDefaultModel(await read(path, "utf8"));
  } catch { /* missing */ }
  return {
    platform: "codex",
    kind: "single",
    path,
    available: current ? [current] : [],
    enabled: current ? [current] : [],
    note: "Single default model in config.toml (no per-phase minions)."
  };
}

async function collectCursorModels(homeDir, read, list = readdir) {
  const cliPath = join(homeDir, ".cursor", "cli-config.json");
  const cli = await readJson(cliPath, read);
  const cliModel = cli?.model?.modelId ?? cli?.model?.displayModelId ?? null;
  const agentModels = new Set();
  try {
    const dir = join(homeDir, ".cursor", "agents");
    for (const name of await list(dir)) {
      if (!name.endsWith(".md")) continue;
      const meta = parseFrontmatterModel(await read(join(dir, name), "utf8"));
      if (meta.model) agentModels.add(meta.model);
    }
  } catch { /* missing */ }
  return {
    platform: "cursor",
    kind: "multi",
    path: join(homeDir, ".cursor", "agents"),
    available: [...CURSOR_AGENT_MODELS, ...(cliModel ? [cliModel] : [])],
    enabled: [...agentModels],
    cliDefault: cliModel,
    note: "Agent frontmatter usually inherit/fast. Auto chat model is IDE-managed (see cli-config)."
  };
}

/**
 * Catalog of available + enabled models for each tooling surface.
 */
export async function buildFleetModelsCatalog({
  homeDir = resolveHomeDir(),
  read = readFile,
  list = readdir
} = {}) {
  const platforms = await Promise.all([
    collectOpenCodeModels(homeDir, read),
    collectClaudeModels(homeDir, read, list),
    collectCodexModels(homeDir, read),
    collectCursorModels(homeDir, read, list)
  ]);
  return {
    ok: true,
    kind: "catalog",
    note: "Available = known/declared for that tool. Enabled = currently referenced on disk.",
    platforms,
    generatedAt: new Date().toISOString()
  };
}

export function formatFleetModelsText(catalog) {
  const lines = ["Fleet models (available · enabled)", ""];
  for (const p of catalog.platforms ?? []) {
    lines.push(`${p.platform} · ${p.kind}${p.cliDefault ? ` · cli ${p.cliDefault}` : ""}`);
    lines.push(`  available · ${(p.available ?? []).join(", ") || "—"}`);
    lines.push(`  enabled   · ${(p.enabled ?? []).join(", ") || "—"}`);
    if (p.note) lines.push(`  ${p.note}`);
    lines.push("");
  }
  lines.push(catalog.note ?? "");
  return lines.join("\n").trimEnd();
}
