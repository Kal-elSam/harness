import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runPaths } from "../paths.js";

function lockPath(homeDir, runId) {
  return `${runPaths(homeDir, runId).runDir}/supervisor.lock.json`;
}

export async function writeSupervisorLock(homeDir, runId, lock) {
  const { runDir } = runPaths(homeDir, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(lockPath(homeDir, runId), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

export async function readSupervisorLock(homeDir, runId) {
  const path = lockPath(homeDir, runId);
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function touchSupervisorLock(homeDir, runId, fields = {}) {
  const current = await readSupervisorLock(homeDir, runId);
  if (!current) return null;

  const next = {
    ...current,
    ...fields,
    lastHeartbeat: new Date().toISOString()
  };
  await writeSupervisorLock(homeDir, runId, next);
  return next;
}
