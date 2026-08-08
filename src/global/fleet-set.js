/**
 * Consent-gated fleet model writes (OpenCode / Claude / Codex).
 * Plan by default; --yes applies with backup. Never touches Cursor Auto / state.vscdb.
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveHomeDir } from "./paths.js";
import { writeAtomicJson } from "./runtime/write-atomic-json.js";
import { printJson } from "./json-output.js";
import { commandHeader } from "./brand/index.js";
import { formatCliCommand } from "./brand/cli.js";
import {
  parseFrontmatterModel,
  replaceFrontmatterModel,
  replaceCodexDefaultModel
} from "./observability/fleet-platforms.js";

const PLATFORMS = new Set(["opencode", "claude", "codex"]);

function backupPath(path, stamp = Date.now()) {
  return `${path}.kairo-backup.${stamp}`;
}

function requirePlatform(platform) {
  const p = String(platform ?? "").toLowerCase();
  if (!PLATFORMS.has(p)) {
    throw new Error(`Unsupported platform "${platform}". Use opencode, claude, or codex.`);
  }
  return p;
}

function requireAgent(agent) {
  const id = String(agent ?? "").trim();
  if (!id) throw new Error("Missing --agent <id>.");
  return id;
}

function requireModel(model) {
  const m = String(model ?? "").trim();
  if (!m) throw new Error("Missing --model <id>.");
  return m;
}

export function buildOpenCodeFleetSetPlan({ config, agent, model, configPath }) {
  const agents = config?.agent ?? config?.agents;
  if (!agents || typeof agents !== "object" || !(agent in agents)) {
    throw new Error(`OpenCode agent "${agent}" not found in ${configPath}.`);
  }
  const prev = agents[agent];
  const previousModel = typeof prev?.model === "string" ? prev.model : (config?.model ?? null);
  const nextAgents = {
    ...agents,
    [agent]: { ...prev, model }
  };
  const next = { ...config, agent: nextAgents };
  if (config.agents && !config.agent) {
    delete next.agent;
    next.agents = nextAgents;
  }
  return {
    platform: "opencode",
    agent,
    model,
    previousModel,
    path: configPath,
    wouldWrite: previousModel !== model,
    next,
    note: `Set OpenCode agent.${agent}.model → ${model}`
  };
}

export async function runFleetSet({
  platform,
  agent,
  model,
  yes = false,
  json = false,
  dryRun = false,
  homeDir = resolveHomeDir(),
  read = readFile,
  writeText = writeFile,
  copyFileFn = copyFile,
  writeAtomicJsonFn = writeAtomicJson,
  now = () => Date.now()
} = {}) {
  const p = requirePlatform(platform);
  const nextModel = requireModel(model);
  const agentId = p === "codex"
    ? (String(agent ?? "default").trim() || "default")
    : requireAgent(agent);
  const apply = yes === true && dryRun !== true;

  let plan;
  let path;
  let applyFn;

  if (p === "opencode") {
    path = join(homeDir, ".config", "opencode", "opencode.json");
    const raw = await read(path, "utf8");
    const config = JSON.parse(raw);
    plan = buildOpenCodeFleetSetPlan({
      config, agent: agentId, model: nextModel, configPath: path
    });
    applyFn = async () => {
      await writeAtomicJsonFn(path, plan.next);
    };
  } else if (p === "claude") {
    if (agentId === "default") {
      path = join(homeDir, ".claude", "settings.json");
      const existing = JSON.parse(await read(path, "utf8"));
      const previousModel = typeof existing.model === "string" ? existing.model : null;
      plan = {
        platform: "claude",
        agent: agentId,
        model: nextModel,
        previousModel,
        path,
        wouldWrite: previousModel !== nextModel,
        next: { ...existing, model: nextModel },
        note: `Set Claude settings.model → ${nextModel}`
      };
      applyFn = async () => {
        await writeAtomicJsonFn(path, plan.next);
      };
    } else {
      path = join(homeDir, ".claude", "agents", `${agentId}.md`);
      const raw = await read(path, "utf8");
      const previousModel = parseFrontmatterModel(raw).model;
      const nextText = replaceFrontmatterModel(raw, nextModel);
      plan = {
        platform: "claude",
        agent: agentId,
        model: nextModel,
        previousModel,
        path,
        wouldWrite: previousModel !== nextModel,
        nextText,
        note: `Set Claude agent ${agentId} frontmatter model → ${nextModel}`
      };
      applyFn = async () => {
        await writeText(path, plan.nextText, "utf8");
      };
    }
  } else {
    path = join(homeDir, ".codex", "config.toml");
    const raw = await read(path, "utf8");
    const previousMatch = raw.match(/^\s*model\s*=\s*"([^"]+)"/m);
    const previousModel = previousMatch ? previousMatch[1] : null;
    const nextText = replaceCodexDefaultModel(raw, nextModel);
    plan = {
      platform: "codex",
      agent: "default",
      model: nextModel,
      previousModel,
      path,
      wouldWrite: previousModel !== nextModel,
      nextText,
      note: `Set Codex config.toml model → ${nextModel}`
    };
    applyFn = async () => {
      await writeText(path, plan.nextText, "utf8");
    };
  }

  plan.backupPath = backupPath(path, now());
  plan.applyWith = formatCliCommand(
    `fleet set --platform ${p} --agent ${plan.agent} --model ${nextModel} --yes`
  );

  if (!apply) {
    const payload = {
      ok: true,
      applied: false,
      plan: {
        platform: plan.platform,
        agent: plan.agent,
        model: plan.model,
        previousModel: plan.previousModel,
        path: plan.path,
        wouldWrite: plan.wouldWrite,
        note: plan.note,
        applyWith: plan.applyWith
      }
    };
    if (json) printJson(payload);
    else {
      console.log(commandHeader("Fleet set"));
      console.log(plan.note);
      console.log(`Path · ${plan.path}`);
      console.log(`Was · ${plan.previousModel ?? "—"}`);
      console.log(`Now · ${plan.model}`);
      console.log(`Apply · ${plan.applyWith}`);
    }
    return payload;
  }

  await copyFileFn(path, plan.backupPath);
  await applyFn();

  const receipt = {
    ok: true,
    applied: true,
    platform: plan.platform,
    agent: plan.agent,
    model: plan.model,
    previousModel: plan.previousModel,
    path: plan.path,
    backupPath: plan.backupPath,
    note: "Model assignment updated. Refresh Kairo Fleet to see declared changes."
  };
  if (json) printJson(receipt);
  else {
    console.log(commandHeader("Fleet set"));
    console.log(`Wrote · ${receipt.path}`);
    console.log(`Backup · ${receipt.backupPath}`);
    console.log(receipt.note);
  }
  return receipt;
}
