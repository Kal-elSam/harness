/**
 * Plan builders for fleet configure (kept separate to stay under file size budget).
 */
import { join } from "node:path";
import {
  parseFrontmatterModel,
  replaceFrontmatterModel,
  replaceCodexDefaultModel,
  parseCodexDefaultModel
} from "./observability/fleet-platforms.js";
import { buildOpenCodeFleetSetPlan } from "./fleet-set.js";
import { SDD_PHASES } from "./fleet-shared.js";

export async function planClaudeChanges(source, homeDir, pathExists, read) {
  const changes = [];
  const settingsPath = join(homeDir, ".claude", "settings.json");
  if (await pathExists(settingsPath)) {
    const settings = JSON.parse(await read(settingsPath, "utf8"));
    const nextDefault = source.default ?? settings.model ?? "sonnet";
    if (settings.model !== nextDefault) {
      changes.push({
        platform: "claude",
        agent: "default",
        path: settingsPath,
        previousModel: settings.model ?? null,
        model: nextDefault,
        kind: "json",
        next: { ...settings, model: nextDefault }
      });
    }
  }
  for (const phase of SDD_PHASES) {
    if (!source[phase]) continue;
    const path = join(homeDir, ".claude", "agents", `${phase}.md`);
    if (!(await pathExists(path))) continue;
    const raw = await read(path, "utf8");
    const previousModel = parseFrontmatterModel(raw).model;
    const model = source[phase];
    if (previousModel === model) continue;
    changes.push({
      platform: "claude",
      agent: phase,
      path,
      previousModel,
      model,
      kind: "text",
      nextText: replaceFrontmatterModel(raw, model)
    });
  }
  return changes;
}

export async function planOpenCodeChanges(opencodeMap, homeDir, pathExists, read) {
  const configPath = join(homeDir, ".config", "opencode", "opencode.json");
  if (!(await pathExists(configPath))) return [];
  const config = JSON.parse(await read(configPath, "utf8"));
  let nextConfig = config;
  const detail = [];
  for (const [agent, model] of Object.entries(opencodeMap)) {
    try {
      const step = buildOpenCodeFleetSetPlan({
        config: nextConfig, agent, model, configPath
      });
      if (step.wouldWrite) {
        detail.push(`${agent}: ${step.previousModel ?? "—"} → ${model}`);
        nextConfig = step.next;
      }
    } catch {
      /* agent missing — skip */
    }
  }
  if (!detail.length) return [];
  return [{
    platform: "opencode",
    agent: "batch",
    path: configPath,
    previousModel: `${detail.length} agents`,
    model: `${detail.length} agents`,
    kind: "json",
    next: nextConfig,
    detail
  }];
}

export async function planCursorChanges(cursorModel, homeDir, pathExists, read) {
  const changes = [];
  const model = cursorModel || "inherit";
  for (const phase of SDD_PHASES) {
    const path = join(homeDir, ".cursor", "agents", `${phase}.md`);
    if (!(await pathExists(path))) continue;
    const raw = await read(path, "utf8");
    const previousModel = parseFrontmatterModel(raw).model;
    if (previousModel === model) continue;
    changes.push({
      platform: "cursor",
      agent: phase,
      path,
      previousModel,
      model,
      kind: "text",
      nextText: replaceFrontmatterModel(raw, model)
    });
  }
  return changes;
}

export async function planCodexChange(codexModel, homeDir, pathExists, read) {
  if (!codexModel) return [];
  const configPath = join(homeDir, ".codex", "config.toml");
  if (!(await pathExists(configPath))) return [];
  const raw = await read(configPath, "utf8");
  const previousModel = parseCodexDefaultModel(raw);
  if (previousModel === codexModel) return [];
  return [{
    platform: "codex",
    agent: "default",
    path: configPath,
    previousModel,
    model: codexModel,
    kind: "text",
    nextText: replaceCodexDefaultModel(raw, codexModel)
  }];
}
