// Persists KairoSession — right now just the project's current WorkMode
// ("ask" | "plan" | "agent") plus identity/timestamps — under the same
// global `~/.harness/sessions/<projectKey>/` tree transcript-store.js
// already uses (see that file's header for why: matches Claude Code/Codex/
// OpenCode's own convention, never inside the project's own working
// directory). Deliberately a SEPARATE file from transcript.json rather than
// merging the two: messages are already durably persisted there, and this
// file only needs to exist/change when the mode itself changes — keeping
// them separate means switching modes never needs to read-modify-write the
// (potentially large) transcript, and a mode read never needs to parse it.

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const SESSION_SCHEMA = "kairo.session/v1";
export const WORK_MODES = ["ask", "plan", "agent"];
const DEFAULT_MODE = "ask";

function sessionPath(homeDir, projectRoot) {
  const { sessionsDir } = harnessHomePaths(homeDir);
  return join(sessionsDir, projectKeyForPath(projectRoot), "session.json");
}

function freshSession(projectRoot) {
  const now = new Date().toISOString();
  return { schema: SESSION_SCHEMA, id: projectKeyForPath(projectRoot), mode: DEFAULT_MODE, createdAt: now, updatedAt: now };
}

/**
 * Reads the persisted KairoSession for a project. Fails closed to a fresh
 * default session (mode "ask") on a missing or malformed file — this is
 * also how every session that existed before WorkMode was introduced
 * "migrates": it simply reads as ASK, the safest, strictly read-only
 * default, the first time it's read after this shipped.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @returns {Promise<{schema: string, id: string, mode: "ask"|"plan"|"agent", createdAt: string, updatedAt: string}>}
 */
export async function readSession(homeDir, projectRoot, deps = {}) {
  const read = deps.readFile ?? readFile;
  try {
    const raw = await read(sessionPath(homeDir, projectRoot), "utf8");
    const doc = JSON.parse(raw);
    if (doc?.schema !== SESSION_SCHEMA || typeof doc.id !== "string" || !WORK_MODES.includes(doc.mode)) {
      return freshSession(projectRoot);
    }
    return doc;
  } catch {
    return freshSession(projectRoot);
  }
}

/**
 * Persists a new WorkMode for this project's session — pure local state,
 * never provider I/O, so switching modes (Shift+Tab, `/plan`) stays
 * instant. Read-modify-write against the existing session so `id`/
 * `createdAt` survive a mode change untouched.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @param {"ask"|"plan"|"agent"} mode
 */
export async function writeSessionMode(homeDir, projectRoot, mode, deps = {}) {
  if (!WORK_MODES.includes(mode)) throw new Error(`Unknown work mode "${mode}"`);
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const existing = await readSession(homeDir, projectRoot, deps);
  const path = sessionPath(homeDir, projectRoot);
  const doc = { ...existing, schema: SESSION_SCHEMA, mode, updatedAt: new Date().toISOString() };
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, doc);
  return doc;
}
