// Persists the `kairo start` chat transcript so it survives a restart — the
// whole reason a chat CLI is useful is that you don't lose the conversation.
//
// This lives under the global `~/.harness/sessions/<projectKey>/` tree, the
// same home Kairo already uses for run history and work snapshots — NOT
// inside the project's own working directory. Verified against Claude Code
// (`~/.claude/projects/`), Codex (`~/.codex/sessions/`), and OpenCode
// (`~/.local/share/opencode/storage`): none of them store session history
// inside the repo itself, all three key it by project path under the user's
// home. Writing this into the repo would risk it landing in git and would
// collide across separate clones of the same project.

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const TRANSCRIPT_SCHEMA = "kairo.transcript/v1";

// A CLI session's transcript isn't meant to grow forever; bound it so the
// file (and every future read-modify-write) stays cheap, while still
// keeping far more real history than the old fixed on-screen cap of 8.
const MAX_STORED_ENTRIES = 500;

function transcriptPath(homeDir, projectRoot) {
  const { sessionsDir } = harnessHomePaths(homeDir);
  return join(sessionsDir, projectKeyForPath(projectRoot), "transcript.json");
}

/**
 * Reads the persisted transcript for a project. Fails closed to an empty
 * list on a missing or malformed file — a corrupt history file must never
 * block the chat from starting.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @returns {Promise<Array<{role: "user"|"kairo", text: string, at: string}>>}
 */
export async function readTranscript(homeDir, projectRoot, deps = {}) {
  const read = deps.readFile ?? readFile;
  try {
    const raw = await read(transcriptPath(homeDir, projectRoot), "utf8");
    const doc = JSON.parse(raw);
    if (doc?.schema !== TRANSCRIPT_SCHEMA || !Array.isArray(doc.entries)) return [];
    return doc.entries.filter((entry) => entry && typeof entry.text === "string"
      && (entry.role === "user" || entry.role === "kairo"));
  } catch {
    return [];
  }
}

/**
 * Appends one entry and persists the whole (bounded) transcript. Read-
 * modify-write is fine here: this is interactive human typing speed, not a
 * high-frequency log. A write failure never throws into the chat flow —
 * the caller decides whether/how to surface it.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @param {{role: "user"|"kairo", text: string}} entry
 */
export async function appendTranscriptEntry(homeDir, projectRoot, entry, deps = {}) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = transcriptPath(homeDir, projectRoot);
  const existing = await readTranscript(homeDir, projectRoot, deps);
  const entries = [...existing, { role: entry.role, text: entry.text, at: new Date().toISOString() }]
    .slice(-MAX_STORED_ENTRIES);
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, { schema: TRANSCRIPT_SCHEMA, entries });
}

/** Persists an empty transcript — used by `/clear`, so a cleared chat stays cleared across a restart. */
export async function clearTranscript(homeDir, projectRoot, deps = {}) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = transcriptPath(homeDir, projectRoot);
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, { schema: TRANSCRIPT_SCHEMA, entries: [] });
}
