// Maps a Pi session (identified by `ctx.sessionManager.getSessionId()`) to
// the real Kairo session currently bound to it. One per-project index file,
// a sibling of that project's own sessions/<projectKey>/conversations/
// directory — never inside it, since this is Pi's own bookkeeping, not a
// Kairo session itself. Reuses session-registry.js's own project-path and
// session-id conventions rather than re-deriving them.

import { dirname, join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { conversationsDir, isValidSessionId } from "./session-registry.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const PI_BINDINGS_SCHEMA = "kairo.pi-bindings/v1";

// Pi's own session id contract (`assertValidSessionId` in Pi's
// session-manager.js): non-empty, alphanumeric plus '-', '_', '.',
// starting and ending alphanumeric. A binding key is never trusted enough
// to be used unvalidated, even though it only ever becomes a JSON object
// key here (never a path segment).
const PI_SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function isValidPiSessionId(id) {
  return typeof id === "string" && PI_SESSION_ID_PATTERN.test(id);
}

function bindingsPath(homeDir, projectRoot) {
  return join(dirname(conversationsDir(homeDir, projectRoot)), "pi-bindings.json");
}

async function readJsonOrNull(path, deps) {
  const readFileImpl = deps.readFile ?? readFile;
  try {
    return JSON.parse(await readFileImpl(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Every recorded Pi -> Kairo binding for a project. Tolerant of a missing
 * or malformed file — both resolve to `{}`, never throw, matching this
 * codebase's "read-modify-write, tolerant read" convention (see
 * session-registry.js `readJsonOrNull`/`readValidSession`).
 */
async function readBindings(homeDir, projectRoot, deps = {}) {
  const doc = await readJsonOrNull(bindingsPath(homeDir, projectRoot), deps);
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.schema !== PI_BINDINGS_SCHEMA) {
    return {};
  }
  const bindings = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === "schema") continue;
    bindings[key] = value;
  }
  return bindings;
}

/**
 * The real Kairo session id bound to `piSessionId` for this project, or
 * null when there is no usable binding — no file, a malformed file, an
 * unknown key, or a stored entry whose `kairoSessionId` doesn't look like
 * a real Kairo session id. Never throws: an unusable binding is exactly as
 * unremarkable as no binding at all, so callers can fail closed to
 * "unbound" without a try/catch of their own.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @param {string} piSessionId
 */
export async function lookupPiBinding(homeDir, projectRoot, piSessionId, deps = {}) {
  if (!isValidPiSessionId(piSessionId)) return null;
  const bindings = await readBindings(homeDir, projectRoot, deps);
  const entry = bindings[piSessionId];
  if (!entry || typeof entry !== "object") return null;
  if (!isValidSessionId(entry.kairoSessionId)) return null;
  return entry.kairoSessionId;
}

/**
 * Records (or replaces) the Kairo session bound to one Pi session for this
 * project, atomically. Refuses to record an invalid Pi or Kairo session id
 * rather than persisting an entry `lookupPiBinding` would just reject
 * again on the next read.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @param {string} piSessionId
 * @param {string} kairoSessionId
 */
export async function recordPiBinding(homeDir, projectRoot, piSessionId, kairoSessionId, deps = {}) {
  if (!isValidPiSessionId(piSessionId)) {
    throw new Error(`Invalid Pi session id "${piSessionId}" — refusing to record a binding.`);
  }
  if (!isValidSessionId(kairoSessionId)) {
    throw new Error(`Invalid Kairo session id "${kairoSessionId}" — refusing to record a binding.`);
  }
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = bindingsPath(homeDir, projectRoot);
  const existing = await readBindings(homeDir, projectRoot, deps);
  const doc = {
    schema: PI_BINDINGS_SCHEMA,
    ...existing,
    [piSessionId]: { kairoSessionId, boundAt: new Date().toISOString() }
  };
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, doc, deps);
  return doc[piSessionId];
}
