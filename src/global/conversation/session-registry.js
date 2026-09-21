// Multiple, independent Kairo sessions per project — each one its own
// directory under ~/.harness/sessions/<projectKey>/conversations/<sessionId>/,
// isolating chat transcript, ASK history, and WorkMode from every other
// session for the same project. PROJECT TEAM strategy and provider quota
// stay exactly where they already are (sessions/<projectKey>/project-
// strategy.json, and the fully project-independent global usage store) —
// this module never touches either.

import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const SESSION_SCHEMA_V2 = "kairo.session/v2";
const TITLE_MAX_LENGTH = 80;
const LEGACY_SESSION_TITLE = "Previous Kairo session";

function projectSessionsRoot(homeDir, projectRoot) {
  const { sessionsDir } = harnessHomePaths(homeDir);
  return join(sessionsDir, projectKeyForPath(projectRoot));
}

export function conversationsDir(homeDir, projectRoot) {
  return join(projectSessionsRoot(homeDir, projectRoot), "conversations");
}

export function sessionDirFor(homeDir, projectRoot, sessionId) {
  return join(conversationsDir(homeDir, projectRoot), sessionId);
}

function sessionMetaPath(sessionDir) {
  return join(sessionDir, "session.json");
}

async function readDirOrEmpty(dir, deps) {
  const readdirImpl = deps.readdir ?? readdir;
  try { return await readdirImpl(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function readJsonOrNull(path, deps) {
  const readFileImpl = deps.readFile ?? readFile;
  try { return JSON.parse(await readFileImpl(path, "utf8")); }
  catch { return null; }
}

function truncateTitle(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  return trimmed.length <= TITLE_MAX_LENGTH ? trimmed : `${trimmed.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

/**
 * Lazily, idempotently imports the legacy single-session files
 * (session.json/transcript.json/ask-history.json directly under
 * sessions/<projectKey>/, from before multiple sessions existed) into a
 * real, listable session named "legacy-<projectKey>". The ORIGINAL files
 * are never deleted or moved — only copied — so this is safe to run
 * repeatedly and safe to roll back from. A no-op once `conversations/`
 * already has anything in it (a real session, migrated or fresh, already
 * exists), or when no legacy files are present at all (a brand new
 * project). Returns the legacy session id when it actually ran, else null.
 * @param {string} homeDir
 * @param {string} projectRoot
 */
export async function migrateLegacySessionIfNeeded(homeDir, projectRoot, deps = {}) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const copyImpl = deps.cp ?? cp;

  const root = projectSessionsRoot(homeDir, projectRoot);
  const alreadyMigrated = await readDirOrEmpty(conversationsDir(homeDir, projectRoot), deps);
  if (alreadyMigrated.length > 0) return null;

  // The old WorkMode lives in the legacy session.json — carried into the
  // new v2 metadata's own `mode` field, never copied as a raw file (its
  // filename would collide with the new session's own session.json).
  const legacySession = await readJsonOrNull(join(root, "session.json"), deps);
  const contentFiles = ["transcript.json", "ask-history.json"];
  const present = [];
  for (const name of contentFiles) {
    if (await readJsonOrNull(join(root, name), deps)) present.push(name);
  }
  if (!legacySession && present.length === 0) return null;

  const legacyId = `legacy-${projectKeyForPath(projectRoot)}`;
  const legacyDir = sessionDirFor(homeDir, projectRoot, legacyId);
  await mkdirImpl(legacyDir, { recursive: true });
  for (const name of present) {
    await copyImpl(join(root, name), join(legacyDir, name));
  }
  const now = new Date().toISOString();
  await writeJson(sessionMetaPath(legacyDir), {
    schema: SESSION_SCHEMA_V2, id: legacyId, projectKey: projectKeyForPath(projectRoot),
    title: LEGACY_SESSION_TITLE,
    mode: legacySession?.mode ?? "ask",
    createdAt: legacySession?.createdAt ?? now,
    updatedAt: now
  });
  return legacyId;
}

/**
 * Creates a genuinely new, isolated session for a project. `title` is
 * optional and stored only when given — a session with no real title yet
 * is presented with a provisional date/time label at RENDER time (from its
 * real `createdAt`), never a synthetic title invented and persisted here.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @param {{title?: string|null, mode?: "ask"|"plan"|"agent"}} [opts]
 */
export async function createSession(homeDir, projectRoot, { title = null, mode = "ask" } = {}, deps = {}) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const id = (deps.randomUUID ?? randomUUID)();
  const dir = sessionDirFor(homeDir, projectRoot, id);
  await mkdirImpl(dir, { recursive: true });
  const now = new Date().toISOString();
  const doc = {
    schema: SESSION_SCHEMA_V2, id, projectKey: projectKeyForPath(projectRoot),
    title: truncateTitle(title), mode, createdAt: now, updatedAt: now
  };
  await writeJson(sessionMetaPath(dir), doc);
  return doc;
}

/**
 * Every real session for a project, most recently updated first. Runs the
 * legacy migration first (best-effort — a migration failure never blocks
 * listing whatever real sessions already exist). A corrupt/unreadable
 * individual session directory is silently skipped, never thrown, so one
 * bad session can't hide every other real one.
 * @param {string} homeDir
 * @param {string} projectRoot
 */
export async function listSessions(homeDir, projectRoot, deps = {}) {
  await migrateLegacySessionIfNeeded(homeDir, projectRoot, deps).catch(() => null);
  const entries = await readDirOrEmpty(conversationsDir(homeDir, projectRoot), deps);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory?.()) continue;
    const doc = await readJsonOrNull(sessionMetaPath(sessionDirFor(homeDir, projectRoot, entry.name)), deps);
    if (doc?.schema === SESSION_SCHEMA_V2 && typeof doc.id === "string") sessions.push(doc);
  }
  return sessions.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/**
 * Resolves a user-supplied session reference — the exact real id, or a
 * prefix unique among this project's real sessions. Returns null (never
 * throws) when nothing matches; throws only on a genuinely ambiguous
 * prefix, since silently picking one of several real candidates would be
 * exactly the kind of guess this codebase never makes.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @param {string} ref
 */
export async function resolveSessionRef(homeDir, projectRoot, ref, deps = {}) {
  const sessions = await listSessions(homeDir, projectRoot, deps);
  const exact = sessions.find((session) => session.id === ref);
  if (exact) return exact;
  const prefixMatches = sessions.filter((session) => session.id.startsWith(ref));
  if (prefixMatches.length > 1) throw new Error(`"${ref}" matches ${prefixMatches.length} real sessions — use a longer prefix.`);
  return prefixMatches[0] ?? null;
}
