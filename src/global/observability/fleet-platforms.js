/**
 * Declared fleets for Claude / Codex / Cursor agents (public configs only).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export function parseFrontmatterModel(raw) {
  const text = String(raw ?? "");
  const match = text.match(FRONTMATTER_RE);
  if (!match) return { model: null, name: null };
  const block = match[1];
  const modelLine = block.match(/^model:\s*(.+)$/m);
  const nameLine = block.match(/^name:\s*(.+)$/m);
  const model = modelLine ? modelLine[1].trim().replace(/^["']|["']$/g, "") : null;
  const name = nameLine ? nameLine[1].trim().replace(/^["']|["']$/g, "") : null;
  return { model, name };
}

export function replaceFrontmatterModel(raw, nextModel) {
  const text = String(raw ?? "");
  const match = text.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error("Agent file has no YAML frontmatter to update.");
  }
  const block = match[1];
  let nextBlock;
  if (/^model:\s*.+$/m.test(block)) {
    nextBlock = block.replace(/^model:\s*.+$/m, `model: ${nextModel}`);
  } else {
    nextBlock = `${block.trimEnd()}\nmodel: ${nextModel}`;
  }
  return text.replace(FRONTMATTER_RE, `---\n${nextBlock}\n---`);
}

export function parseCodexDefaultModel(tomlText) {
  const match = String(tomlText ?? "").match(/^\s*model\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

export function replaceCodexDefaultModel(tomlText, nextModel) {
  const text = String(tomlText ?? "");
  if (!/^\s*model\s*=\s*"[^"]*"/m.test(text)) {
    throw new Error("Codex config.toml has no top-level model = \"...\" line.");
  }
  return text.replace(/^\s*model\s*=\s*"[^"]*"/m, `model = "${nextModel}"`);
}

function minionRole(id) {
  if (id === "sdd-apply") return "executor";
  if (id === "sdd-explore") return "explorer";
  if (id === "sdd-verify") return "verifier";
  return id.startsWith("sdd-") ? "specialist" : "minion";
}

async function listAgentFiles(dir, read = readFile, list = readdir) {
  try {
    const names = await list(dir);
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      const path = join(dir, name);
      const raw = await read(path, "utf8");
      const meta = parseFrontmatterModel(raw);
      const id = meta.name || name.replace(/\.md$/, "");
      if (!id.startsWith("sdd-")) continue;
      out.push({
        id,
        model: meta.model,
        modelShort: meta.model,
        role: minionRole(id),
        mode: "subagent",
        path,
        opaque: meta.model === "inherit" || meta.model == null
      });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export async function buildClaudeFleet({ homeDir, read = readFile, list = readdir } = {}) {
  const settingsPath = join(homeDir, ".claude", "settings.json");
  let defaultModel = null;
  try {
    const settings = JSON.parse(await read(settingsPath, "utf8"));
    defaultModel = typeof settings?.model === "string" ? settings.model : null;
  } catch {
    defaultModel = null;
  }
  const minions = await listAgentFiles(join(homeDir, ".claude", "agents"), read, list);
  return {
    platform: "claude",
    orchestrator: {
      id: "default",
      model: defaultModel,
      modelShort: defaultModel,
      mode: "primary",
      opaque: false
    },
    minions: minions.map((m) => ({
      ...m,
      model: m.model ?? defaultModel,
      modelShort: m.modelShort ?? defaultModel,
      opaque: false
    })),
    opaque: false,
    writable: true,
    note: "Declared Claude settings + agent frontmatter models.",
    source: "claude"
  };
}

export async function buildCodexFleet({ homeDir, read = readFile } = {}) {
  const configPath = join(homeDir, ".codex", "config.toml");
  let model = null;
  try {
    model = parseCodexDefaultModel(await read(configPath, "utf8"));
  } catch {
    model = null;
  }
  return {
    platform: "codex",
    orchestrator: {
      id: "default",
      model,
      modelShort: model,
      mode: "primary",
      opaque: model == null
    },
    minions: [],
    opaque: model == null,
    writable: true,
    configPath,
    note: "Codex default model from ~/.codex/config.toml (no parent→child live topology).",
    source: "codex"
  };
}

export async function buildCursorAgentsFleet({ homeDir, read = readFile, list = readdir } = {}) {
  const minions = await listAgentFiles(join(homeDir, ".cursor", "agents"), read, list);
  return {
    platform: "cursor",
    orchestrator: {
      id: "auto",
      model: null,
      modelShort: null,
      mode: "primary",
      opaque: true
    },
    minions: minions.map((m) => ({
      id: m.id,
      model: m.model,
      modelShort: m.modelShort,
      role: m.role,
      mode: "subagent",
      opaque: true
    })),
    opaque: true,
    writable: false,
    note: "Cursor Auto is IDE-managed. Subagents typically use model: inherit — change models in Cursor UI.",
    source: "cursor-agents"
  };
}
