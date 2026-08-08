/**
 * Cross-platform fleet model configure (Gentle-style assignments).
 * Default: one plan for all multi-agent platforms (claude + opencode + cursor).
 * Codex is single-model — pass --codex-model separately (never mixed into phase map).
 * Plan by default; --yes applies with backups. Never Cursor Auto / state.vscdb.
 */
import { copyFile, readFile, writeFile, access, mkdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolveHomeDir } from "./paths.js";
import { writeAtomicJson } from "./runtime/write-atomic-json.js";
import { printJson } from "./json-output.js";
import { commandHeader } from "./brand/index.js";
import { formatCliCommand } from "./brand/cli.js";
import {
  SDD_PHASES,
  CLAUDE_TO_OPENCODE,
  loadGentleClaudeAssignments,
  mapClaudeAssignmentsToOpenCode
} from "./fleet-shared.js";
import {
  loadFleetProfile,
  saveFleetProfile,
  seedFleetProfile,
  profileToPlatformAssignments
} from "./fleet-models.js";
import {
  planClaudeChanges,
  planOpenCodeChanges,
  planCursorChanges,
  planCodexChange
} from "./fleet-configure-plan.js";

export {
  SDD_PHASES,
  CLAUDE_TO_OPENCODE,
  loadGentleClaudeAssignments,
  mapClaudeAssignmentsToOpenCode
};
export { runFleetModels } from "./fleet-models.js";

/** Multi-agent fleet — Codex is opt-in via --codex-model / --platforms codex. */
const DEFAULT_PLATFORMS = Object.freeze(["claude", "opencode", "cursor"]);
const MULTI_PLATFORMS = Object.freeze(["claude", "opencode", "cursor"]);

function backupPath(path, stamp = Date.now()) {
  return `${path}.kairo-backup.${stamp}`;
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function parseAssignmentList(raw) {
  const out = {};
  if (!raw || typeof raw !== "string") return out;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) throw new Error(`Invalid assignment "${trimmed}". Use agent=model.`);
    const agent = trimmed.slice(0, eq).trim();
    const model = trimmed.slice(eq + 1).trim();
    if (!agent || !model) throw new Error(`Invalid assignment "${trimmed}". Use agent=model.`);
    out[agent] = model;
  }
  return out;
}

export function parsePlatformList(raw) {
  if (!raw || typeof raw !== "string") return [...DEFAULT_PLATFORMS];
  const list = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const p of list) {
    if (!["opencode", "claude", "codex", "cursor"].includes(p)) {
      throw new Error(`Unsupported platform "${p}". Use opencode,claude,cursor,codex.`);
    }
  }
  return list.length ? list : [...DEFAULT_PLATFORMS];
}

/**
 * Build a multi-platform configure plan.
 * Prefer --from profile (disk-seeded) so OpenCode keeps tuned models;
 * --from gentle remaps OpenCode via Claude tiers.
 */
export async function buildFleetConfigurePlan({
  homeDir = resolveHomeDir(),
  platforms = DEFAULT_PLATFORMS,
  from = "profile",
  assignments = null,
  codexModel = null,
  remapOpenCode = null,
  read = readFile,
  pathExists = exists
} = {}) {
  const platformSet = new Set(platforms);
  let sourceLabel = "explicit";
  let claudeSource = null;
  let opencodeMap = {};
  let cursorAgentModel = "inherit";
  let profileSnapshot = null;
  let nextCodex = codexModel;

  if (assignments && Object.keys(assignments).length) {
    sourceLabel = "explicit";
    claudeSource = { ...assignments };
    opencodeMap = mapClaudeAssignmentsToOpenCode(claudeSource);
    if (assignments.codex_default) nextCodex = nextCodex || assignments.codex_default;
  } else if (from === "gentle") {
    sourceLabel = "gentle";
    claudeSource = await loadGentleClaudeAssignments(homeDir, read);
    if (!claudeSource) {
      throw new Error(
        "No Gentle assignments found. Pass --assignments …, use --from profile, or configure Gentle first."
      );
    }
    opencodeMap = remapOpenCode !== false ? mapClaudeAssignmentsToOpenCode(claudeSource) : {};
  } else {
    sourceLabel = "profile";
    const { profile } = await loadFleetProfile({ homeDir, read, seedIfMissing: true });
    profileSnapshot = profile;
    const maps = profileToPlatformAssignments(profile);
    claudeSource = maps.claude;
    opencodeMap = maps.opencode;
    cursorAgentModel = maps.cursorAgentModel;
    if (platformSet.has("codex") && !nextCodex && profile.codexDefault) {
      nextCodex = profile.codexDefault;
    }
  }

  if (!claudeSource || !Object.keys(claudeSource).length) {
    if (!platformSet.has("codex") || !nextCodex) {
      throw new Error(
        "No model assignments found. Use --from profile|gentle, --assignments, or --codex-model."
      );
    }
    claudeSource = {};
  }

  const changes = [];
  if (platformSet.has("claude") && Object.keys(claudeSource).length) {
    changes.push(...await planClaudeChanges(claudeSource, homeDir, pathExists, read));
  }
  if (platformSet.has("opencode") && Object.keys(opencodeMap).length) {
    changes.push(...await planOpenCodeChanges(opencodeMap, homeDir, pathExists, read));
  }
  if (platformSet.has("cursor")) {
    changes.push(...await planCursorChanges(cursorAgentModel, homeDir, pathExists, read));
  }
  if (platformSet.has("codex") || nextCodex) {
    changes.push(...await planCodexChange(nextCodex, homeDir, pathExists, read));
  }

  const multi = [...platformSet].filter((p) => MULTI_PLATFORMS.includes(p));
  return {
    ok: true,
    applied: false,
    source: sourceLabel,
    platforms: [...platformSet],
    multiAgentPlatforms: multi,
    assignments: claudeSource,
    opencodeMap,
    codexModel: nextCodex ?? null,
    cursorAgentModel,
    profile: profileSnapshot,
    changes,
    note: [
      "Default: one plan for multi-agent tools (Claude + OpenCode + Cursor agents).",
      "Codex is single-model — use --codex-model <id> (or --platforms codex).",
      "Cursor Auto chat model stays IDE-managed; agents use inherit.",
      "See also: kairo fleet models"
    ].join(" "),
    applyWith: formatCliCommand(
      nextCodex
        ? `fleet configure --yes --codex-model ${nextCodex}`
        : "fleet configure --yes"
    )
  };
}

export async function runFleetConfigure({
  yes = false,
  json = false,
  platforms = null,
  from = "profile",
  assignmentsRaw = null,
  codexModel = null,
  remapOpenCode = null,
  homeDir = resolveHomeDir(),
  read = readFile,
  writeText = writeFile,
  copyFileFn = copyFile,
  writeAtomicJsonFn = writeAtomicJson,
  mkdirFn = mkdir,
  now = () => Date.now()
} = {}) {
  let finalPlatforms;
  if (platforms != null && String(platforms).trim() !== "") {
    finalPlatforms = parsePlatformList(platforms);
    if (codexModel && !finalPlatforms.includes("codex")) {
      finalPlatforms = [...finalPlatforms, "codex"];
    }
  } else if (codexModel && !assignmentsRaw) {
    finalPlatforms = ["codex"];
  } else {
    finalPlatforms = [...DEFAULT_PLATFORMS];
  }

  const assignments = assignmentsRaw ? parseAssignmentList(assignmentsRaw) : null;
  const plan = await buildFleetConfigurePlan({
    homeDir,
    platforms: finalPlatforms,
    from: assignments ? "explicit" : from,
    assignments,
    codexModel,
    remapOpenCode,
    read
  });

  if (!yes) {
    if (json) printJson(plan);
    else {
      console.log(commandHeader("Fleet configure"));
      console.log(`Source · ${plan.source}`);
      console.log(`Multi-agent · ${(plan.multiAgentPlatforms ?? []).join(", ") || "—"}`);
      console.log(`Platforms · ${plan.platforms.join(", ")}`);
      if (plan.codexModel) console.log(`Codex · ${plan.codexModel}`);
      if (plan.changes.length === 0) {
        console.log("No changes needed — assignments already match disk.");
      } else {
        for (const c of plan.changes) {
          if (c.detail) {
            console.log(`${c.platform} · ${c.path}`);
            for (const line of c.detail) console.log(`  ${line}`);
          } else {
            console.log(`${c.platform} · ${c.agent}: ${c.previousModel ?? "—"} → ${c.model}`);
          }
        }
      }
      console.log(plan.note);
      console.log(`Apply · ${plan.applyWith}`);
    }
    return plan;
  }

  const stamp = now();
  const receipts = [];
  const written = new Set();
  for (const change of plan.changes) {
    if (written.has(change.path)) continue;
    written.add(change.path);
    const bak = backupPath(change.path, stamp);
    await copyFileFn(change.path, bak);
    if (change.kind === "json") {
      await writeAtomicJsonFn(change.path, change.next);
    } else {
      await writeText(change.path, change.nextText, "utf8");
    }
    receipts.push({ path: change.path, backupPath: bak, platform: change.platform });
  }

  let profilePath = null;
  let profile = plan.profile ?? await seedFleetProfile({ homeDir, read });
  if (plan.assignments?.default) profile.claudeDefault = plan.assignments.default;
  for (const id of SDD_PHASES) {
    if (plan.assignments?.[id]) {
      profile.phases[id] = profile.phases[id] ?? {};
      profile.phases[id].claude = plan.assignments[id];
    }
    if (plan.opencodeMap?.[id]) {
      profile.phases[id] = profile.phases[id] ?? {};
      profile.phases[id].opencode = plan.opencodeMap[id];
    }
  }
  if (plan.codexModel) profile.codexDefault = plan.codexModel;
  profile.cursorAgentModel = plan.cursorAgentModel ?? "inherit";
  const saved = await saveFleetProfile(profile, { homeDir, writeAtomicJsonFn, mkdirFn });
  profilePath = saved.path;

  const result = {
    ok: true,
    applied: true,
    source: plan.source,
    platforms: plan.platforms,
    changeCount: plan.changes.length,
    receipts,
    profilePath,
    note: "Applied. Multi-agent tools share the phase map; Codex is single-default. Refresh Fleet. kairo fleet models shows available/enabled."
  };
  if (json) printJson(result);
  else {
    console.log(commandHeader("Fleet configure"));
    console.log(`Wrote · ${receipts.length} file(s)`);
    for (const r of receipts) console.log(`  ${r.path} (backup ${r.backupPath})`);
    if (profilePath) console.log(`Profile · ${profilePath}`);
    console.log(result.note);
  }
  return result;
}
