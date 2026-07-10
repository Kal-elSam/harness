import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runPaths } from "../paths.js";

function cancelSignalPath(homeDir, runId) {
  return `${runPaths(homeDir, runId).runDir}/cancel.signal.json`;
}

export async function writeCancelSignal(homeDir, runId, payload) {
  const { runDir } = runPaths(homeDir, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(cancelSignalPath(homeDir, runId), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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
