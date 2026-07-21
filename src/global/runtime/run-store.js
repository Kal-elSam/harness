import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { harnessHomePaths, runPaths } from "../paths.js";
import { RUN_STATES, isActiveRunState } from "./run-types.js";
import { createRunEvent } from "./run-events.js";
import { writeAtomicJson } from "./write-atomic-json.js";

const writeLocks = new Map();

export function getRunsDir(homeDir) {
  return harnessHomePaths(homeDir).runsDir;
}

export async function createRunRecord(homeDir, metadata) {
  const { runDir, statePath } = runPaths(homeDir, metadata.runId);
  await mkdir(runDir, { recursive: true });
  await writeAtomicJson(statePath, metadata);
  return metadata;
}

export async function readRunState(homeDir, runId) {
  const { statePath } = runPaths(homeDir, runId);
  if (!existsSync(statePath)) return null;

  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid run state at ${statePath}: ${error.message}`);
  }
}

export async function writeRunState(homeDir, metadata) {
  const key = metadata.runId;
  const previous = writeLocks.get(key) ?? Promise.resolve();
  const next = previous.then(async () => {
    const { statePath, runDir } = runPaths(homeDir, metadata.runId);
    await mkdir(runDir, { recursive: true });
    await writeAtomicJson(statePath, metadata);
    return metadata;
  });
  writeLocks.set(key, next.catch(() => {}));
  return next;
}

export async function appendRunEvent(homeDir, event, { captureTranscript = false } = {}) {
  const { eventsPath, transcriptPath } = runPaths(homeDir, event.runId);
  await mkdir(runPaths(homeDir, event.runId).runDir, { recursive: true });

  const line = `${JSON.stringify(event)}\n`;
  await appendFile(eventsPath, line, "utf8");

  if (captureTranscript && event.type === "run.transcript") {
    await appendFile(transcriptPath, line, "utf8");
  }

  return event;
}

export async function appendRunStartedEvent(homeDir, metadata) {
  const event = createRunEvent({
    runId: metadata.runId,
    type: "run.started",
    data: {
      agentId: metadata.agentId,
      provider: metadata.provider,
      model: metadata.model,
      cwd: metadata.cwd,
      permissions: metadata.permissions,
      taskDigest: metadata.taskDigest,
      taskLength: metadata.taskLength
    }
  });

  await appendRunEvent(homeDir, event);
  return event;
}

export async function readRunEvents(homeDir, runId, { limit = null } = {}) {
  const { eventsPath } = runPaths(homeDir, runId);
  if (!existsSync(eventsPath)) return [];

  const content = await readFile(eventsPath, "utf8");
  const events = content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return { parseError: true, line: index + 1, message: error.message };
      }
    });

  if (limit != null && limit > 0) {
    return events.slice(-limit);
  }

  return events;
}

export async function listRunRecords(homeDir, { limit = null, activeOnly = false } = {}) {
  const runsDir = getRunsDir(homeDir);
  if (!existsSync(runsDir)) return [];

  const entries = await readdir(runsDir, { withFileTypes: true });
  const runs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const state = await readRunState(homeDir, entry.name);
    if (!state) continue;
    if (activeOnly && !isActiveRunState(state.state)) continue;
    runs.push(state);
  }

  runs.sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));

  if (limit != null && limit > 0) {
    return runs.slice(0, limit);
  }

  return runs;
}

export async function markInterruptedRuns(homeDir, { exceptRunIds = [] } = {}) {
  const except = new Set(exceptRunIds);
  return reconcileActiveRuns(homeDir, {
    isRunAliveImpl: async (_dir, run) => except.has(run.runId)
  });
}

export async function reconcileActiveRuns(homeDir, { isRunAliveImpl } = {}) {
  const activeRuns = await listRunRecords(homeDir, { activeOnly: true });
  const interrupted = [];

  for (const run of activeRuns) {
    if (isRunAliveImpl) {
      const alive = await isRunAliveImpl(homeDir, run);
      if (alive) continue;
    }

    const next = {
      ...run,
      state: RUN_STATES.INTERRUPTED,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: run.error ?? "Run interrupted (supervisor no longer alive)."
    };
    await writeRunState(homeDir, next);
    const event = createRunEvent({
      runId: run.runId,
      type: "run.failed",
      data: { reason: "interrupted", previousState: run.state }
    });
    await appendRunEvent(homeDir, event);
    interrupted.push(next);
  }

  return interrupted;
}
