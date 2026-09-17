import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { harnessHomePaths, worktreePaths } from "../paths.js";
import { writeAtomicJson } from "./write-atomic-json.js";

const writeLocks = new Map();

export function getWorktreesDir(homeDir) {
  return harnessHomePaths(homeDir).worktreesDir;
}

/** Creates the initial, real PENDING record — exclusive so two concurrent creations can never collide on the same worktreeId. */
export async function createWorktreeRecord(homeDir, metadata) {
  const { worktreeDir, statePath } = worktreePaths(homeDir, metadata.worktreeId);
  await mkdir(worktreeDir, { recursive: true });
  await writeAtomicJson(statePath, metadata, { createExclusive: true });
  return metadata;
}

export async function readWorktreeState(homeDir, worktreeId) {
  const { statePath } = worktreePaths(homeDir, worktreeId);
  if (!existsSync(statePath)) return null;

  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid execution worktree state at ${statePath}: ${error.message}`);
  }
}

/** Read-modify-write is serialized per worktreeId — same real race protection run-store.js's writeRunState already relies on. */
export async function writeWorktreeState(homeDir, metadata) {
  const key = metadata.worktreeId;
  const previous = writeLocks.get(key) ?? Promise.resolve();
  const next = previous.then(async () => {
    const { worktreeDir, statePath } = worktreePaths(homeDir, metadata.worktreeId);
    await mkdir(worktreeDir, { recursive: true });
    await writeAtomicJson(statePath, metadata);
    return metadata;
  });
  writeLocks.set(key, next.catch(() => {}));
  return next;
}

/** Append-only, one real checkpoint per line — mirrors run-store.js's own appendRunEvent for events.jsonl. */
export async function appendCheckpoint(homeDir, worktreeId, checkpoint) {
  const { worktreeDir, checkpointsPath } = worktreePaths(homeDir, worktreeId);
  await mkdir(worktreeDir, { recursive: true });
  await appendFile(checkpointsPath, `${JSON.stringify(checkpoint)}\n`, "utf8");
  return checkpoint;
}

export async function readCheckpoints(homeDir, worktreeId) {
  const { checkpointsPath } = worktreePaths(homeDir, worktreeId);
  if (!existsSync(checkpointsPath)) return [];

  const content = await readFile(checkpointsPath, "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return { parseError: true, line: index + 1, message: error.message };
      }
    });
}

export async function listWorktreeRecords(homeDir) {
  const worktreesDir = getWorktreesDir(homeDir);
  if (!existsSync(worktreesDir)) return [];

  const entries = await readdir(worktreesDir, { withFileTypes: true });
  const worktrees = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const state = await readWorktreeState(homeDir, entry.name);
    if (state) worktrees.push(state);
  }
  worktrees.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  return worktrees;
}
