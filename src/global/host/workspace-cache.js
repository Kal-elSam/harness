// The Pi widget's last-known cache (P01.2) — persists the last successful
// live usage read (global, account-wide — see loadKairoUsageData) and, per
// project, the last successful team availability read (see
// loadKairoLiveData) with a real timestamp, so the host can render
// instantly on start instead of a blank "checking" state while the live
// probes run. Follows the same conventions as project-strategy-store.js
// (a schema field, writeAtomicJson, mkdir recursive) — never a bespoke
// write path.

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const KAIRO_USAGE_CACHE_SCHEMA = "kairo.workspace-usage-cache/v1";
export const KAIRO_AVAILABILITY_CACHE_SCHEMA = "kairo.workspace-availability-cache/v1";

function usageCachePath(homeDir) {
  const { root } = harnessHomePaths(homeDir);
  return join(root, "workspace-usage-cache.json");
}

function availabilityCachePath(homeDir, projectRoot) {
  const { sessionsDir } = harnessHomePaths(homeDir);
  return join(sessionsDir, projectKeyForPath(projectRoot), "workspace-availability-cache.json");
}

async function readCache(path, schema, deps) {
  const readFileImpl = deps.readFile ?? readFile;
  let doc;
  try {
    doc = JSON.parse(await readFileImpl(path, "utf8"));
  } catch {
    return null;
  }
  if (doc?.schema !== schema || typeof doc.savedAt !== "number" || !("value" in doc)) return null;
  return { value: doc.value, savedAt: doc.savedAt };
}

async function writeCache(path, schema, value, deps) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const nowImpl = deps.now ?? (() => Date.now());
  const doc = { schema, savedAt: nowImpl(), value };
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, doc, deps);
  return doc;
}

/**
 * The last successful subscription usage read — global, since subscription
 * quota is account-wide, not per project (see loadKairoUsageData's own
 * doc). Returns `null` on a missing, malformed, or wrong-schema file —
 * never a fabricated value.
 * @param {string} homeDir
 * @returns {Promise<{value: object, savedAt: number}|null>}
 */
export async function readCachedUsage(homeDir, deps = {}) {
  return readCache(usageCachePath(homeDir), KAIRO_USAGE_CACHE_SCHEMA, deps);
}

/**
 * Persists the last successful subscription usage read.
 * @param {string} homeDir
 * @param {object} value - the same shape loadKairoUsageData resolves to
 */
export async function writeCachedUsage(homeDir, value, deps = {}) {
  return writeCache(usageCachePath(homeDir), KAIRO_USAGE_CACHE_SCHEMA, value, deps);
}

/**
 * The last successful team availability read for one project (see
 * loadKairoLiveData's own doc) — per project, since eligibility/
 * entitlement/access depend on the project's own real team. Returns
 * `null` on a missing, malformed, or wrong-schema file — never a
 * fabricated value.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @returns {Promise<{value: object, savedAt: number}|null>}
 */
export async function readCachedAvailability(homeDir, projectRoot, deps = {}) {
  return readCache(availabilityCachePath(homeDir, projectRoot), KAIRO_AVAILABILITY_CACHE_SCHEMA, deps);
}

/**
 * Persists the last successful team availability read for one project.
 * @param {string} homeDir
 * @param {string} projectRoot
 * @param {object} value - the same shape loadKairoLiveData resolves to
 */
export async function writeCachedAvailability(homeDir, projectRoot, value, deps = {}) {
  return writeCache(availabilityCachePath(homeDir, projectRoot), KAIRO_AVAILABILITY_CACHE_SCHEMA, value, deps);
}
