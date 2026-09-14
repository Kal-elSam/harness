// Persists ProjectStrategy — the approved (or suggested) real per-project
// role assignment — under the same global `~/.harness/sessions/<projectKey>/`
// tree session-store.js and transcript-store.js already use, but as its
// own separate file (project-strategy.json): a strategy's lifecycle
// (suggested -> approved -> stale) is independent of both the WorkMode and
// the chat transcript, and none of the three should need to read the
// others just to change.

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const PROJECT_STRATEGY_SCHEMA = "kairo.project-strategy/v1";
export const PROJECT_STRATEGY_STATUSES = ["suggested", "active", "stale"];

function strategyPath(homeDir, projectRoot) {
  const { sessionsDir } = harnessHomePaths(homeDir);
  return join(sessionsDir, projectKeyForPath(projectRoot), "project-strategy.json");
}

/**
 * Reads the persisted ProjectStrategy for a project. Returns `null` on a
 * missing or malformed file — unlike session-store's readSession, there is
 * no safe default strategy to fall back to (a project genuinely has NOT
 * been analyzed yet until one is computed), so `null` here is the honest
 * "NOT_ANALYZED" signal the cockpit checks for.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @returns {Promise<object|null>}
 */
export async function readProjectStrategy(homeDir, projectRoot, deps = {}) {
  const read = deps.readFile ?? readFile;
  try {
    const raw = await read(strategyPath(homeDir, projectRoot), "utf8");
    const doc = JSON.parse(raw);
    if (doc?.schema !== PROJECT_STRATEGY_SCHEMA || !PROJECT_STRATEGY_STATUSES.includes(doc.status)) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * Persists a ProjectStrategy (create or replace — a strategy is always
 * recomputed as a whole document, never patched field by field, so a
 * stale nested field can never survive a refresh by accident).
 * @param {string} homeDir
 * @param {string} projectRoot
 * @param {object} strategy - a ProjectStrategy document (see project-strategy.js)
 */
export async function writeProjectStrategy(homeDir, projectRoot, strategy, deps = {}) {
  if (!PROJECT_STRATEGY_STATUSES.includes(strategy?.status)) {
    throw new Error(`ProjectStrategy must have a real status (one of ${PROJECT_STRATEGY_STATUSES.join(", ")}).`);
  }
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = strategyPath(homeDir, projectRoot);
  const doc = { ...strategy, schema: PROJECT_STRATEGY_SCHEMA };
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, doc);
  return doc;
}
