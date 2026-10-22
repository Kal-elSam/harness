import { readFile, copyFile, stat, chmod } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomicText } from "./runtime/write-atomic-json.js";

/**
 * Writes Kairo's ODD picks into gentle-ai's state.json (claude_phase_assignments),
 * odd-* keys only. Plan by default; apply needs yes === true. Backup naming matches
 * fleet-set/fleet-configure: `<path>.kairo-backup.<stamp>`.
 */
export const ODD_KEYS = Object.freeze(["odd-explorer", "odd-worker", "odd-verify"]);
const FIELD = "claude_phase_assignments";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function gentleStatePath(homeDir) {
  return join(homeDir, ".gentle-ai", "state.json");
}

function detectIndent(text) {
  const match = /^([ \t]+)\S/m.exec(text);
  return match ? match[1] : 2;
}

function toEntry(pick) {
  return { model: pick.model, ...(pick.effort == null ? {} : { effort: pick.effort }) };
}

const sameEntry = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function load(homeDir, picks) {
  const path = gentleStatePath(homeDir);
  const refuse = (...reasons) => ({ ok: false, path, reasons });
  if (!isObject(picks) || Object.keys(picks).length === 0) return refuse("picks is empty: nothing to write");
  const bad = [];
  for (const [key, pick] of Object.entries(picks)) {
    if (!ODD_KEYS.includes(key)) bad.push(`pick key "${key}" is not an odd-* key (${ODD_KEYS.join(", ")})`);
    else if (!isObject(pick) || typeof pick.model !== "string" || pick.model === "") {
      bad.push(`pick "${key}" has no model`);
    }
  }
  if (bad.length) return refuse(...bad);

  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return refuse(`state.json missing: ${path}`);
    return refuse(`state.json unreadable: ${error.message}`);
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch (error) {
    return refuse(`state.json is not valid JSON: ${error.message}`);
  }
  if (!isObject(state)) return refuse("state.json root is not an object");
  if (Object.hasOwn(state, FIELD) && !isObject(state[FIELD])) {
    return refuse(`${FIELD} is present but not an object`);
  }
  return { ok: true, path, text, state };
}

function buildPlan(loaded, picks) {
  const { path, state } = loaded;
  const createsField = !Object.hasOwn(state, FIELD);
  const current = createsField ? {} : state[FIELD];
  const changes = {};
  const unchanged = [];
  for (const key of ODD_KEYS) {
    if (!Object.hasOwn(picks, key)) continue;
    const next = toEntry(picks[key]);
    const before = Object.hasOwn(current, key) ? current[key] : null;
    if (before !== null && sameEntry(before, next)) unchanged.push(key);
    else changes[key] = { current: before, next };
  }
  return {
    ok: true,
    path,
    createsField,
    note: createsField ? `${FIELD} is absent and will be created` : null,
    changes,
    unchanged,
    reasons: []
  };
}

export async function planGentleStateWrite({ homeDir, picks } = {}) {
  const loaded = await load(homeDir, picks);
  if (!loaded.ok) return { ...loaded, applied: false, changes: {}, unchanged: [], createsField: false };
  return buildPlan(loaded, picks);
}

export async function applyGentleStateWrite({ homeDir, picks, yes, now = Date.now } = {}) {
  const loaded = await load(homeDir, picks);
  if (!loaded.ok) return { ...loaded, applied: false, changes: {}, unchanged: [], createsField: false };
  const plan = buildPlan(loaded, picks);
  if (yes !== true) return { ...plan, applied: false };
  if (Object.keys(plan.changes).length === 0) return { ...plan, applied: false, backupPath: null };

  const { path, text, state } = loaded;
  const next = { ...state, [FIELD]: { ...(state[FIELD] ?? {}) } };
  for (const [key, change] of Object.entries(plan.changes)) next[FIELD][key] = change.next;

  const mode = (await stat(path)).mode & 0o7777;
  const backupPath = `${path}.kairo-backup.${now()}`;
  await copyFile(path, backupPath);
  const trailing = text.endsWith("\n") ? "\n" : "";
  await writeAtomicText(path, `${JSON.stringify(next, null, detectIndent(text))}${trailing}`);
  await chmod(path, mode);
  return { ...plan, applied: true, backupPath };
}
