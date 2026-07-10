import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { RUN_STATES } from "./run-types.js";
import {
  applyEventToMetadata,
  createRunEvent,
  normalizeAdapterEvent,
  transitionRunState
} from "./run-events.js";
import {
  appendRunEvent,
  readRunState,
  writeRunState
} from "./run-store.js";
import { resolveExecutionAdapter } from "./execution-adapters/index.js";
import { consumeRunHandoff } from "./run-handoff.js";
import { isRunCancelRequested } from "./run-cancel-signal.js";
import { readSupervisorLock, touchSupervisorLock, writeSupervisorLock } from "./run-supervisor-lock.js";
import { shouldPersistTranscript } from "./run-redact.js";

async function shouldPreserveCancelledState(homeDir, runId) {
  const fresh = await readRunState(homeDir, runId);
  if (fresh?.state === RUN_STATES.CANCELLED) {
    return fresh;
  }
  if (await isRunCancelRequested(homeDir, runId)) {
    return fresh ?? null;
  }
  return null;
}

const workerPath = fileURLToPath(new URL("./run-supervisor-worker.js", import.meta.url));

export function spawnDetachedSupervisor({ homeDir, runId, spawnImpl = spawn }) {
  const child = spawnImpl(process.execPath, [workerPath], {
    env: {
      ...process.env,
      KAIRO_SUPERVISOR_HOME: homeDir,
      KAIRO_SUPERVISOR_RUN_ID: runId
    },
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return child.pid ?? null;
}

export const forkDetachedSupervisor = spawnDetachedSupervisor;

export async function supervisePreparedRun({
  homeDir,
  runId,
  follow = false,
  timeoutMs = null,
  spawnImpl = spawn,
  cancelledRuns = null,
  activeProcesses = null
}) {
  const handoff = await consumeRunHandoff(homeDir, runId);
  const adapter = resolveExecutionAdapter(handoff.agentId);
  let metadata = await readRunState(homeDir, runId);

  if (!metadata) {
    throw new Error(`Run "${runId}" not found.`);
  }

  const captureTranscript = handoff.captureTranscript === true;
  const launch = adapter.buildLaunch({
    task: handoff.task,
    cwd: handoff.cwd,
    model: handoff.model,
    permissions: handoff.permissions ?? [],
    profile: handoff.profile ?? null
  });

  metadata = {
    ...metadata,
    state: RUN_STATES.RUNNING,
    supervisorPid: process.pid,
    updatedAt: new Date().toISOString()
  };
  await writeRunState(homeDir, metadata);
  await writeSupervisorLock(homeDir, runId, {
    supervisorPid: process.pid,
    agentPid: null,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString()
  });

  const child = spawnImpl(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  activeProcesses?.set(runId, child);

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let timeoutHandle = null;
  let processing = Promise.resolve();
  let stateWrites = Promise.resolve();

  const enqueue = (work) => {
    processing = processing.then(work);
  };

  const serializeStateWrite = (work) => {
    stateWrites = stateWrites.then(work);
    return stateWrites;
  };

  const persistEvent = async (event) => {
    await serializeStateWrite(async () => {
      metadata = applyEventToMetadata(metadata, event);
      await appendRunEvent(homeDir, event, { captureTranscript: shouldPersistTranscript(captureTranscript) });
      await writeRunState(homeDir, metadata);
    });
  };

  const handleLine = async (line, stream) => {
    const structured = adapter.parseEventLine(line, { runId, cwd: handoff.cwd });
    const normalized = structured
      ? normalizeAdapterEvent(adapter.id, structured, { captureTranscript })
      : normalizeAdapterEvent(adapter.id, line, { captureTranscript });

    if (!normalized) return;

    const event = {
      ...normalized,
      runId,
      timestamp: normalized.timestamp ?? new Date().toISOString()
    };

    if (captureTranscript && (event.type === "agent.assistant" || event.type === "agent.result")) {
      await persistEvent({
        ...createRunEvent({
          runId,
          type: "run.transcript",
          data: event.data,
          captureTranscript: true
        }),
        runId,
        timestamp: event.timestamp
      });
    }

    await persistEvent(event);

    if (follow && stream === "stdout") {
      process.stdout.write(`${line}\n`);
    }
    if (follow && stream === "stderr") {
      process.stderr.write(`${line}\n`);
    }
  };

  const flushBuffer = async (buffer, stream) => {
    const lines = buffer.split("\n");
    const remainder = lines.pop() ?? "";
    for (const line of lines) {
      await handleLine(line, stream);
    }
    return remainder;
  };

  const completion = new Promise((resolve, reject) => {
    child.on("error", async (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      activeProcesses?.delete(runId);

      await serializeStateWrite(async () => {
        const preserved = await shouldPreserveCancelledState(homeDir, runId);
        if (preserved) {
          cancelledRuns?.delete(runId);
          resolve(preserved.state === RUN_STATES.CANCELLED
            ? preserved
            : { ...preserved, state: RUN_STATES.CANCELLED });
          return;
        }

        metadata = transitionRunState(metadata, RUN_STATES.FAILED, {
          error: error.message
        });
        await writeRunState(homeDir, metadata);
        await appendRunEvent(homeDir, createRunEvent({
          runId,
          type: "run.failed",
          data: { error: error.message }
        }), { captureTranscript: shouldPersistTranscript(captureTranscript) });
      });
      reject(error);
    });

    child.on("close", async (exitCode) => {
      try {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        activeProcesses?.delete(runId);

        await processing;
        await stateWrites;

        if (stdoutBuffer.trim()) {
          await handleLine(stdoutBuffer.trim(), "stdout");
          stdoutBuffer = "";
        }
        if (stderrBuffer.trim()) {
          await handleLine(stderrBuffer.trim(), "stderr");
          stderrBuffer = "";
        }

        await processing;
        await stateWrites;

        await serializeStateWrite(async () => {
          const preserved = await shouldPreserveCancelledState(homeDir, runId);
          if (preserved) {
            cancelledRuns?.delete(runId);
            resolve(preserved.state === RUN_STATES.CANCELLED
              ? preserved
              : { ...preserved, state: RUN_STATES.CANCELLED });
            return;
          }

          if (cancelledRuns?.has(runId)) {
            cancelledRuns.delete(runId);
            try {
              resolve(await readRunState(homeDir, runId));
            } catch {
              resolve({ ...metadata, state: RUN_STATES.CANCELLED });
            }
            return;
          }

          const failed = exitCode !== 0;
          const nextState = failed ? RUN_STATES.FAILED : RUN_STATES.COMPLETED;
          metadata = transitionRunState(metadata, nextState, {
            exitCode,
            error: failed ? `Process exited with code ${exitCode}` : null
          });
          await writeRunState(homeDir, metadata);
          await appendRunEvent(homeDir, createRunEvent({
            runId,
            type: failed ? "run.failed" : "run.completed",
            data: { exitCode }
          }), { captureTranscript: shouldPersistTranscript(captureTranscript) });
          resolve(metadata);
        });
      } catch (error) {
        reject(error);
      }
    });
  });

  child.stdout.on("data", (chunk) => {
    enqueue(async () => {
      stdoutBuffer += chunk.toString();
      stdoutBuffer = await flushBuffer(stdoutBuffer, "stdout");
    });
  });

  child.stderr.on("data", (chunk) => {
    enqueue(async () => {
      stderrBuffer += chunk.toString();
      stderrBuffer = await flushBuffer(stderrBuffer, "stderr");
    });
  });

  if (timeoutMs != null && timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
  }

  void serializeStateWrite(async () => {
    metadata = {
      ...metadata,
      pid: child.pid ?? null
    };
    await writeRunState(homeDir, metadata);
    await touchSupervisorLock(homeDir, runId, { agentPid: child.pid ?? null });
  });

  return completion;
}

export async function readSupervisorLockForRun(homeDir, runId) {
  return readSupervisorLock(homeDir, runId);
}
