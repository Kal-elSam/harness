import { spawn } from "node:child_process";
import { createRunId, createRunMetadata, RUN_STATES } from "./run-types.js";
import { createRunEvent, transitionRunState } from "./run-events.js";
import {
  appendRunEvent,
  appendRunStartedEvent,
  createRunRecord,
  readRunState,
  reconcileActiveRuns,
  writeRunState
} from "./run-store.js";
import { resolveExecutionAdapter } from "./execution-adapters/index.js";
import { resolveProfileAgents } from "../profile.js";
import { resolveRuntimeOptions } from "./run-profile.js";
import { cleanupStaleHandoffs, deleteRunHandoff, writeRunHandoff } from "./run-handoff.js";
import { isRunAlive } from "./run-liveness.js";
import { readSupervisorLock, writeSupervisorLock } from "./run-supervisor-lock.js";
import { writeCancelSignal } from "./run-cancel-signal.js";
import { isWithinStartingGrace } from "./run-starting.js";
import {
  forkDetachedSupervisor,
  readSupervisorLockForRun,
  supervisePreparedRun
} from "./run-supervisor.js";

const activeProcesses = new Map();
const cancelledRuns = new Set();

export function getActiveProcess(runId) {
  return activeProcesses.get(runId) ?? null;
}

export function listActiveRunIds() {
  return [...activeProcesses.keys()];
}

async function isRunSupervisedAlive(homeDir, run) {
  if (listActiveRunIds().includes(run.runId)) {
    return true;
  }

  const lock = await readSupervisorLock(homeDir, run.runId);
  if (isWithinStartingGrace(run, lock)) {
    return true;
  }

  return isRunAlive(homeDir, run, { readSupervisorLockImpl: readSupervisorLockForRun });
}

export async function recoverRuns(homeDir) {
  const interrupted = await reconcileActiveRuns(homeDir, {
    isRunAliveImpl: isRunSupervisedAlive
  });
  await cleanupStaleHandoffs(homeDir, {
    exceptRunIds: listActiveRunIds(),
    isRunAliveImpl: isRunSupervisedAlive
  });
  return interrupted;
}

async function prepareRun({
  homeDir,
  agentId,
  task,
  cwd,
  model = null,
  permissions = [],
  captureTranscript = false,
  cliVersion,
  profile = null
}) {
  const adapter = resolveExecutionAdapter(agentId);
  const availability = adapter.availability({ cwd });

  if (!availability.available) {
    throw new Error(availability.reason ?? `${adapter.label} is not available.`);
  }

  if (!availability.launchable) {
    throw new Error(
      availability.reason
        ?? `${adapter.label} is not launchable for auditable Kairo runs in v1.`
    );
  }

  const runId = createRunId();
  const metadata = createRunMetadata({
    runId,
    agentId,
    provider: adapter.label,
    model,
    task,
    cwd,
    permissions,
    captureTranscript,
    cliVersion,
    profileSources: profile?.sources ?? null
  });

  await createRunRecord(homeDir, metadata);
  await appendRunStartedEvent(homeDir, metadata);
  await writeRunHandoff(homeDir, runId, {
    agentId,
    task,
    cwd,
    model,
    permissions,
    captureTranscript,
    cliVersion,
    profile: profile?.profile ?? null
  });

  return { runId, metadata };
}

export async function startRun({
  homeDir,
  agentId,
  task,
  cwd,
  model = null,
  permissions = [],
  captureTranscript = false,
  cliVersion,
  profile = null,
  follow = false,
  timeoutMs = null,
  wait = true,
  spawnImpl = spawn,
  forkDetachedSupervisorImpl = forkDetachedSupervisor
}) {
  const { runId, metadata } = await prepareRun({
    homeDir,
    agentId,
    task,
    cwd,
    model,
    permissions,
    captureTranscript,
    cliVersion,
    profile
  });

  if (!wait) {
    const startingAt = new Date().toISOString();
    await writeRunState(homeDir, {
      ...metadata,
      state: RUN_STATES.STARTING,
      updatedAt: startingAt
    });
    await writeSupervisorLock(homeDir, runId, {
      startingAt,
      supervisorPid: null,
      agentPid: null,
      lastHeartbeat: startingAt
    });

    let supervisorPid;
    try {
      supervisorPid = forkDetachedSupervisorImpl({ homeDir, runId });
      if (!supervisorPid) {
        throw new Error("Failed to start detached supervisor.");
      }
      await writeSupervisorLock(homeDir, runId, {
        startingAt,
        supervisorPid,
        agentPid: null,
        startedAt: startingAt,
        lastHeartbeat: startingAt
      });
    } catch (error) {
      await deleteRunHandoff(homeDir, runId);
      const failed = transitionRunState(
        { ...metadata, state: RUN_STATES.STARTING },
        RUN_STATES.FAILED,
        { error: error instanceof Error ? error.message : String(error) }
      );
      await writeRunState(homeDir, failed);
      throw error;
    }

    const detachedMetadata = {
      ...metadata,
      state: RUN_STATES.STARTING,
      supervisorPid,
      updatedAt: startingAt
    };
    await writeRunState(homeDir, detachedMetadata);
    return {
      runId,
      metadata: detachedMetadata,
      completion: null
    };
  }

  const completion = supervisePreparedRun({
    homeDir,
    runId,
    follow,
    timeoutMs,
    spawnImpl,
    cancelledRuns,
    activeProcesses
  });

  return {
    runId,
    metadata,
    completion
  };
}

export async function stopRun(homeDir, runId, { signal = "SIGTERM" } = {}) {
  const state = await readRunState(homeDir, runId);
  if (!state) {
    throw new Error(`Run "${runId}" not found.`);
  }

  if (state.state === RUN_STATES.COMPLETED || state.state === RUN_STATES.FAILED || state.state === RUN_STATES.CANCELLED) {
    return state;
  }

  const lock = await readSupervisorLock(homeDir, runId);
  const child = activeProcesses.get(runId);

  if (child) {
    child.kill(signal);
  } else {
    const targets = [lock?.agentPid, state.pid, lock?.supervisorPid].filter(Boolean);
    for (const pid of targets) {
      try {
        process.kill(pid, signal);
      } catch {
        // Process may already be gone.
      }
    }
  }

  await writeCancelSignal(homeDir, runId, {
    requested: true,
    signal,
    requestedAt: new Date().toISOString()
  });
  await deleteRunHandoff(homeDir, runId);

  const metadata = transitionRunState(state, RUN_STATES.CANCELLED, {
    error: "Run cancelled by user."
  });
  cancelledRuns.add(runId);
  await writeRunState(homeDir, metadata);
  await appendRunEvent(homeDir, createRunEvent({
    runId,
    type: "run.cancelled",
    data: { signal }
  }));

  activeProcesses.delete(runId);
  return metadata;
}

export async function resolveRunAgent(profile, requestedAgent, detectedAgentIds = []) {
  const agents = resolveProfileAgents(profile?.profile ?? profile, detectedAgentIds);
  const runtime = resolveRuntimeOptions(profile, { agentId: requestedAgent });
  const agentId = runtime.agentId ?? agents[0] ?? null;

  if (!agentId) {
    throw new Error("No agent specified and no default agent available.");
  }

  return { agentId, runtime };
}
