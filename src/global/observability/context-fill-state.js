/**
 * Shared locked updates for ~/.harness/context-fill.json across hook processes.
 */
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";
import { CONTEXT_FILL_SCHEMA, projectLabel } from "./context-fill-constants.js";

export { CONTEXT_FILL_SCHEMA, projectLabel } from "./context-fill-constants.js";
export const CONTEXT_FILL_LOCK_SCHEMA = "kairo.context-fill-lock/v1";
export const CONTEXT_FILL_LOCK_STALE_MS = 5_000;

function statePath(homeDir) {
  return join(homeDir, ".harness", "context-fill.json");
}

function lockPathFor(homeDir) {
  return `${statePath(homeDir)}.lock`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultIsPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readLock(path) {
  try {
    const doc = JSON.parse(await readFile(path, "utf8"));
    return doc?.schema === CONTEXT_FILL_LOCK_SCHEMA ? doc : null;
  } catch {
    return null;
  }
}

export async function readContextFillState(homeDir) {
  try {
    const parsed = JSON.parse(await readFile(statePath(homeDir), "utf8"));
    if (parsed?.schema === CONTEXT_FILL_SCHEMA && parsed.projects) return parsed;
  } catch { /* first write */ }
  return { schema: CONTEXT_FILL_SCHEMA, projects: {} };
}

async function acquireContextFillLock(homeDir, {
  retries = 48,
  retryMs = 25,
  staleAfterMs = CONTEXT_FILL_LOCK_STALE_MS,
  now = () => Date.now(),
  isPidAlive = defaultIsPidAlive,
  pid = process.pid
} = {}) {
  const path = lockPathFor(homeDir);
  const token = randomBytes(8).toString("hex");
  const doc = {
    schema: CONTEXT_FILL_LOCK_SCHEMA,
    token,
    pid,
    startedAt: new Date(now()).toISOString()
  };
  await mkdir(join(homeDir, ".harness"), { recursive: true });

  const isStale = (holder) => {
    const startedAt = Date.parse(holder?.startedAt);
    return !holder
      || !isPidAlive(holder.pid)
      || !Number.isFinite(startedAt)
      || now() - startedAt > staleAfterMs;
  };

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await writeAtomicJson(path, doc, { createExclusive: true });
      return async () => {
        const current = await readLock(path);
        if (current?.token === token) await unlink(path).catch(() => {});
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const holder = await readLock(path);
    if (isStale(holder)) {
      await unlink(path).catch(() => {});
      continue;
    }
    await sleep(retryMs);
  }
  throw new Error("context-fill state lock busy");
}

/**
 * Serialize read-mutate-write of context-fill.json across processes.
 * @template T
 * @param {string} homeDir
 * @param {(state: object) => T | Promise<T>} mutator
 * @returns {Promise<T>}
 */
export async function mutateContextFillState(homeDir, mutator, options = {}) {
  const release = await acquireContextFillLock(homeDir, options);
  try {
    const state = await readContextFillState(homeDir);
    const result = await mutator(state);
    await mkdir(join(homeDir, ".harness"), { recursive: true });
    await writeAtomicJson(statePath(homeDir), state);
    return result;
  } finally {
    await release();
  }
}

export function projectEntry(state, cwd) {
  const label = projectLabel(cwd);
  return { label, previous: state.projects[label] ?? {} };
}
