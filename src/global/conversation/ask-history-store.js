// Persists a real record of ASK mode's own question/answer exchanges — NOT
// the full chat transcript (transcript-store.js), which also mixes in pure
// UI narration (status lines, /help text, project-team listings) that must
// never leak into a real provider prompt as if it were prior conversation.
// This is a separate, purpose-built log so reconstructing "what did we
// actually ask/answer" never has to reverse-engineer that noise back out.
//
// Same home tree as transcript-store.js (~/.harness/sessions/<projectKey>/)
// — not the project's own working directory, for the same reasons recorded
// there (never landing in git, never colliding across separate clones).

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const ASK_HISTORY_SCHEMA = "kairo.ask-history/v1";

// Bounds the file's own growth — a real per-project ASK history isn't meant
// to grow forever, and every read-modify-write stays cheap. Far more than
// any single real prompt ever draws from (see MAX_HISTORY_ENTRIES in
// service.js's own prompt builder) — this is the durable log, not the
// per-call window into it.
const MAX_STORED_ENTRIES = 200;

function askHistoryPath(homeDir, projectRoot) {
  const { sessionsDir } = harnessHomePaths(homeDir);
  return join(sessionsDir, projectKeyForPath(projectRoot), "ask-history.json");
}

/**
 * Reads the persisted ASK exchange history for a project. Fails closed to
 * an empty list on a missing or malformed file — a corrupt history file
 * must never block a real question from being answered.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @returns {Promise<Array<{question: string, answer: string, provider: string, model: string|null, at: string}>>}
 */
export async function readAskHistory(homeDir, projectRoot, deps = {}) {
  const read = deps.readFile ?? readFile;
  try {
    const raw = await read(askHistoryPath(homeDir, projectRoot), "utf8");
    const doc = JSON.parse(raw);
    if (doc?.schema !== ASK_HISTORY_SCHEMA || !Array.isArray(doc.entries)) return [];
    return doc.entries.filter((entry) => entry
      && typeof entry.question === "string" && typeof entry.answer === "string" && typeof entry.provider === "string");
  } catch {
    return [];
  }
}

/**
 * Appends one real question/answer exchange. Stores only the real, original
 * question text the human asked — never any history-enriched prompt this
 * module's own caller may have built from a prior read of this same file
 * (that would compound on every turn). Read-modify-write is fine here: this
 * is interactive human typing speed, not a high-frequency log.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @param {{question: string, answer: string, provider: string, model?: string|null}} entry
 */
export async function appendAskHistoryEntry(homeDir, projectRoot, entry, deps = {}) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = askHistoryPath(homeDir, projectRoot);
  const existing = await readAskHistory(homeDir, projectRoot, deps);
  const entries = [...existing, {
    question: entry.question, answer: entry.answer, provider: entry.provider,
    model: entry.model ?? null, at: new Date().toISOString()
  }].slice(-MAX_STORED_ENTRIES);
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, { schema: ASK_HISTORY_SCHEMA, entries });
}

/** Persists an empty history — used by `/clear`, so a cleared chat genuinely stops carrying prior ASK context forward, not just visually. */
export async function clearAskHistory(homeDir, projectRoot, deps = {}) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = askHistoryPath(homeDir, projectRoot);
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, { schema: ASK_HISTORY_SCHEMA, entries: [] });
}
