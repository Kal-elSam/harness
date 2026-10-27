// Persists ProjectStrategy — the approved (or suggested) real per-project
// role assignment — under the same global `~/.harness/sessions/<projectKey>/`
// tree the retired chat stores used, but as its
// own separate file (project-strategy.json): a strategy's lifecycle
// (suggested -> approved -> stale) is independent of both the WorkMode and
// the chat transcript, and none of the three should need to read the
// others just to change.

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";
import { strategyUsesInactiveProvider } from "./project-strategy.js";
import { resolveTeamProviders } from "../profile.js";

export const PROJECT_STRATEGY_SCHEMA = "kairo.project-strategy/v1";
export const PROJECT_STRATEGY_STATUSES = ["suggested", "active", "stale"];

function strategyPath(homeDir, projectRoot) {
  const { sessionsDir } = harnessHomePaths(homeDir);
  return join(sessionsDir, projectKeyForPath(projectRoot), "project-strategy.json");
}

/**
 * Reads the persisted ProjectStrategy for a project. Returns `null` on a
 * missing or malformed file, or a suggested draft using inactive providers.
 * There is
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
    if (doc.status === "suggested") {
      const teamProviders = deps.teamProviders ?? await resolveTeamProviders({ homeDir, workspaceRoot: projectRoot });
      if (strategyUsesInactiveProvider(doc, teamProviders)) return null;
    }
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

export const TEAM_REFORM_SCHEMA = "kairo.team-reform/v1";
/** Re-form history kept per project; older entries are dropped. */
export const MAX_REFORM_ENTRIES = 20;

function reformPath(homeDir, projectRoot) {
  return join(dirname(strategyPath(homeDir, projectRoot)), "team-reform.json");
}

const emptyReform = () => ({ schema: TEAM_REFORM_SCHEMA, entries: [], announcedAt: null });

/**
 * The re-form log kept next to the strategy. It is written only when a re-form
 * happens, never inside project-strategy.json, so an old strategy file stays
 * byte-identical until a re-form replaces it. A missing or malformed file reads
 * as an empty log.
 * @returns {Promise<{entries: object[], announcedAt: string|null}>}
 */
export async function readTeamReform(homeDir, projectRoot, deps = {}) {
  const read = deps.readFile ?? readFile;
  try {
    const doc = JSON.parse(await read(reformPath(homeDir, projectRoot), "utf8"));
    if (doc?.schema !== TEAM_REFORM_SCHEMA) return emptyReform();
    return { ...emptyReform(), ...doc, entries: Array.isArray(doc.entries) ? doc.entries : [] };
  } catch {
    return emptyReform();
  }
}

export async function writeTeamReform(homeDir, projectRoot, log, deps = {}) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = reformPath(homeDir, projectRoot);
  const doc = { ...emptyReform(), ...log, schema: TEAM_REFORM_SCHEMA, entries: (log.entries ?? []).slice(-MAX_REFORM_ENTRIES) };
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, doc);
  return doc;
}

function describeReformReason(reason) {
  switch (reason?.kind) {
    case "role_activated": return `${reason.role} activated`;
    case "role_deactivated": return `${reason.role} deactivated`;
    case "team_providers_changed": return `teamProviders changed${reason.added?.length ? ` (+${reason.added.join(", ")})` : ""}${reason.removed?.length ? ` (-${reason.removed.join(", ")})` : ""}`;
    case "provider_lost": return `${reason.provider} lost (${reason.reason ?? "unavailable"})`;
    case "provider_restored": return `${reason.provider} restored`;
    default: return "structure changed";
  }
}

/** The newest re-form entry nobody has been told about yet, or null. */
export function unannouncedReform(log) {
  const latest = log?.entries?.at(-1);
  if (!latest) return null;
  const announced = Date.parse(log.announcedAt ?? "");
  return Number.isFinite(announced) && announced >= Date.parse(latest.at) ? null : latest;
}

/** The one-line notice for a re-form entry. */
export function reformNoticeLine(entry) {
  return `Team re-formed automatically at ${entry.at}: ${(entry.reasons ?? []).map(describeReformReason).join("; ")}. Roles: ${(entry.before ?? []).join(", ") || "-"} -> ${(entry.after ?? []).join(", ") || "-"}. See kairo team show.`;
}

/** Marks the newest re-form as announced. Best effort: a write failure never breaks the caller. */
export async function markReformAnnounced(homeDir, projectRoot, entry, deps = {}) {
  try {
    const log = await readTeamReform(homeDir, projectRoot, deps);
    await writeTeamReform(homeDir, projectRoot, { ...log, announcedAt: entry.at }, deps);
  } catch { /* the notice is informational */ }
}
