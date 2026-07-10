import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { runPaths } from "../paths.js";
import { getRunsDir, readRunState } from "./run-store.js";
import { isActiveRunState } from "./run-types.js";
import { isWithinStartingGrace } from "./run-starting.js";
import { readSupervisorLock } from "./run-supervisor-lock.js";

function handoffPath(homeDir, runId) {
  return `${runPaths(homeDir, runId).runDir}/handoff.json`;
}

export async function writeRunHandoff(homeDir, runId, payload) {
  const { runDir } = runPaths(homeDir, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(handoffPath(homeDir, runId), `${JSON.stringify(payload)}\n`, "utf8");
}

export async function consumeRunHandoff(homeDir, runId) {
  const path = handoffPath(homeDir, runId);
  if (!existsSync(path)) {
    throw new Error(`Missing run handoff for "${runId}".`);
  }

  const payload = JSON.parse(await readFile(path, "utf8"));
  await rm(path, { force: true });
  return payload;
}

export async function deleteRunHandoff(homeDir, runId) {
  await rm(handoffPath(homeDir, runId), { force: true });
}

export function hasRunHandoff(homeDir, runId) {
  return existsSync(handoffPath(homeDir, runId));
}

export async function cleanupStaleHandoffs(homeDir, { exceptRunIds = [], isRunAliveImpl } = {}) {
  const except = new Set(exceptRunIds);
  const runsDir = getRunsDir(homeDir);
  if (!existsSync(runsDir)) return [];

  const cleaned = [];
  const entries = await readdir(runsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const runId = entry.name;
    if (except.has(runId)) continue;
    if (!hasRunHandoff(homeDir, runId)) continue;

    const state = await readRunState(homeDir, runId);
    const lock = await readSupervisorLock(homeDir, runId);

    if (isWithinStartingGrace(state, lock)) {
      continue;
    }

    if (isRunAliveImpl && state && await isRunAliveImpl(homeDir, state)) {
      continue;
    }

    if (!state || !isActiveRunState(state.state)) {
      await deleteRunHandoff(homeDir, runId);
      cleaned.push(runId);
    }
  }

  return cleaned;
}
