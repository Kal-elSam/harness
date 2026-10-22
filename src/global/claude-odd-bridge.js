import { readFile, copyFile, mkdir, unlink, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { writeAtomicText } from "./runtime/write-atomic-json.js";
import { CLAUDE_ADAPTER_ID } from "./intelligence/gentle-role-map.js";

/**
 * Temporary Claude Code agents so gentle-ai ODD role picks take effect today
 * (gentle-ai #5550/#5610: picks are stored but no odd-* agent consumes them).
 * Only files carrying our marker are ever updated or removed. Plan by default;
 * apply/retire need yes === true. Backup naming matches gentle-state-writer:
 * `<path>.kairo-backup.<stamp>`. Effort is not written: agent frontmatter
 * support for it is unverified locally.
 */
export const BRIDGE_ROLES = Object.freeze(["odd-explorer", "odd-worker", "odd-verify"]);

const DESCRIPTIONS = {
  "odd-explorer": "ODD explorer role: read-only mapping and exploration.",
  "odd-worker": "ODD worker role: implements one bounded unit of authorized work.",
  "odd-verify": "ODD verify role: independent verification of a change."
};
const MARKER_RE = /<!-- kairo-bridge: v1 role=([\w-]+) -->/;
const marker = (role) => `<!-- kairo-bridge: v1 role=${role} -->`;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function claudeAgentPath(homeDir, role) {
  return join(homeDir, ".claude", "agents", `${role}.md`);
}

export function renderBridgeAgent(role, model) {
  return [
    "---",
    `name: ${role}`,
    `description: ${DESCRIPTIONS[role]} Kairo bridge until gentle-ai ships its own ${role} agent.`,
    `model: ${model}`,
    "---",
    "",
    `Follow the gentle-ai ODD contract for the ${role} role. Do the delegated task exactly as specified and return the observed results.`,
    "",
    marker(role),
    ""
  ].join("\n");
}

/** Returns { symlink: true } for any symlink (even dangling), else file text or null. */
async function readIfExists(path) {
  try {
    if ((await lstat(path)).isSymbolicLink()) return { symlink: true };
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const isOurs = (text, role) => typeof text === "string" && MARKER_RE.exec(text)?.[1] === role;

async function backupExclusive(path, stamp) {
  for (let n = 0; ; n++) {
    const target = `${path}.kairo-backup.${stamp}${n === 0 ? "" : `-${n}`}`;
    try {
      await copyFile(path, target, constants.COPYFILE_EXCL);
      return target;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

function validatePicks(picks) {
  if (!isObject(picks) || Object.keys(picks).length === 0) return ["picks is empty: nothing to write"];
  const bad = [];
  for (const [key, pick] of Object.entries(picks)) {
    if (!BRIDGE_ROLES.includes(key)) bad.push(`pick key "${key}" is not an odd-* key (${BRIDGE_ROLES.join(", ")})`);
    else if (!isObject(pick) || typeof pick.model !== "string" || pick.model === "" || /[\r\n]/.test(pick.model)) {
      bad.push(`pick "${key}" has no valid model`);
    } else if (pick.adapterId !== CLAUDE_ADAPTER_ID) {
      bad.push(`pick "${key}" model "${pick.model}" is on adapter "${pick.adapterId ?? "unknown"}", not Claude: refusing to write it`);
    }
  }
  return bad;
}

export async function planClaudeOddBridge({ homeDir, picks } = {}) {
  const reasons = validatePicks(picks);
  if (reasons.length) return { ok: false, applied: false, roles: [], reasons };
  const roles = [];
  for (const role of BRIDGE_ROLES) {
    if (!Object.hasOwn(picks, role)) continue;
    const path = claudeAgentPath(homeDir, role);
    const content = renderBridgeAgent(role, picks[role].model);
    const existing = await readIfExists(path);
    let action = "create";
    if (existing !== null) {
      if (!isOurs(existing, role)) action = "skip-foreign";
      else action = existing === content ? "unchanged" : "update";
    }
    roles.push({ role, path, action, model: picks[role].model, content });
  }
  return { ok: true, applied: false, roles, reasons: [] };
}

export async function applyClaudeOddBridge({ homeDir, picks, yes, now = Date.now } = {}) {
  const plan = await planClaudeOddBridge({ homeDir, picks });
  if (!plan.ok || yes !== true) return plan;
  let applied = false;
  const roles = [];
  for (const entry of plan.roles) {
    const { content, ...rest } = entry;
    if (entry.action === "create" || entry.action === "update") {
      await mkdir(join(homeDir, ".claude", "agents"), { recursive: true });
      if (entry.action === "update") {
        rest.backupPath = await backupExclusive(entry.path, now());
      }
      await writeAtomicText(entry.path, content);
      applied = true;
    }
    roles.push(rest);
  }
  return { ...plan, applied, roles };
}

export async function retireClaudeOddBridge({ homeDir, yes } = {}) {
  const roles = [];
  let applied = false;
  for (const role of BRIDGE_ROLES) {
    const path = claudeAgentPath(homeDir, role);
    const existing = await readIfExists(path);
    if (existing === null) { roles.push({ role, path, action: "absent" }); continue; }
    if (!isOurs(existing, role)) { roles.push({ role, path, action: "skip-foreign" }); continue; }
    if (yes === true) { await unlink(path); applied = true; }
    roles.push({ role, path, action: "remove" });
  }
  return { ok: true, applied, roles, reasons: [] };
}
