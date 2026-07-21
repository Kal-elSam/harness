import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { runPaths } from "../paths.js";
import { writeAtomicJson } from "./write-atomic-json.js";

function cancelSignalPath(homeDir, runId) {
  return `${runPaths(homeDir, runId).runDir}/cancel.signal.json`;
}

export async function writeCancelSignal(homeDir, runId, payload) {
  const { runDir } = runPaths(homeDir, runId);
  await mkdir(runDir, { recursive: true });
  await writeAtomicJson(cancelSignalPath(homeDir, runId), payload);
}

export async function readCancelSignal(homeDir, runId) {
  const path = cancelSignalPath(homeDir, runId);
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function isRunCancelRequested(homeDir, runId) {
  const signal = await readCancelSignal(homeDir, runId);
  return signal?.requested === true;
}
