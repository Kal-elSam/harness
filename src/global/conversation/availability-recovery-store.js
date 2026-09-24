// Persists, per project, the last provider-availability fingerprint that
// automatic team recovery acted on (see availability-fingerprint.js), under
// the same `~/.harness/sessions/<projectKey>/` tree as project-strategy.json.
// Recovery reads it to run at most once per availability change: a refresh
// that sees the same fingerprint again has nothing new to recover from.

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const AVAILABILITY_RECOVERY_SCHEMA = "kairo.availability-recovery/v1";

export function availabilityRecoveryPath(homeDir, projectRoot) {
  const { sessionsDir } = harnessHomePaths(homeDir);
  return join(sessionsDir, projectKeyForPath(projectRoot), "availability-recovery.json");
}

/**
 * Returns the last recovery record, or null when there is none — a missing,
 * malformed, or foreign file all mean "never acted", never a guessed record.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @returns {Promise<{schema: string, fingerprint: string, outcome: string|null, updatedAt: string}|null>}
 */
export async function readAvailabilityRecovery(homeDir, projectRoot, deps = {}) {
  const read = deps.readFile ?? readFile;
  try {
    const doc = JSON.parse(await read(availabilityRecoveryPath(homeDir, projectRoot), "utf8"));
    if (doc?.schema !== AVAILABILITY_RECOVERY_SCHEMA || typeof doc.fingerprint !== "string") return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * @param {string} homeDir
 * @param {string} projectRoot
 * @param {{fingerprint: string, outcome?: string|null}} record
 */
export async function writeAvailabilityRecovery(homeDir, projectRoot, record, deps = {}) {
  if (typeof record?.fingerprint !== "string") {
    throw new Error("An availability recovery record needs the fingerprint it acted on.");
  }
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = availabilityRecoveryPath(homeDir, projectRoot);
  const doc = {
    schema: AVAILABILITY_RECOVERY_SCHEMA,
    fingerprint: record.fingerprint,
    outcome: record.outcome ?? null,
    updatedAt: new Date().toISOString()
  };
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, doc);
  return doc;
}
