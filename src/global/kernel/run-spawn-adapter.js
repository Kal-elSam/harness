import { createWorkResult, isWorkRequest } from "./contracts.js";
import { normalizeRunResult } from "./run-result-normalizer.js";
import { startRun, stopRun } from "../runtime/run-manager.js";
import { readRunEvents } from "../runtime/run-store.js";

export class RunSpawnArgumentError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RunSpawnArgumentError";
    this.code = code;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function assertSpawnArguments(decision, request) {
  if (!isWorkRequest(request)) {
    throw new RunSpawnArgumentError("Spawn requires a valid WorkRequest.", "run_spawn_invalid_request");
  }
  if (!nonEmptyString(decision?.provider)) {
    throw new RunSpawnArgumentError("RouteDecision requires a non-empty provider.", "run_spawn_invalid_provider");
  }
  const model = decision.model;
  if (model == null || typeof model !== "object" || !nonEmptyString(model.modelId)) {
    throw new RunSpawnArgumentError("RouteDecision.model requires a non-empty modelId.", "run_spawn_invalid_model");
  }
  if (model.adapterId !== decision.provider) {
    throw new RunSpawnArgumentError(
      `RouteDecision.model.adapterId "${model.adapterId}" does not match provider "${decision.provider}".`,
      "run_spawn_adapter_mismatch"
    );
  }
}

function failedAfterStart(runId, reason) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return createWorkResult({ ok: false, workerId: runId, status: "failed", error: message });
}

/**
 * Composes the kernel `spawnAdapter(decision, request)` seam over the existing
 * `startRun` executor. Admission is whatever `startRun` enforces under
 * `requireVerifiedWriteContainment: true`; nothing here widens permissions,
 * and this factory never writes run state itself.
 *
 * Cancellation is explicit and caller-driven: when `onStart` is provided it
 * receives a `stop` handle bound to that run's runId, and nothing here ever
 * cancels automatically (not on failure, not on an onStart error, not as a
 * retry). A `cancelled` WorkResult reports run state (stopRun writes CANCELLED
 * before killing the child), not confirmed process death.
 */
export function createRunSpawnAdapter({
  homeDir,
  cliVersion,
  startRunImpl = startRun,
  readRunEventsImpl = readRunEvents,
  stopRunImpl = stopRun,
  onStart = null
} = {}) {
  if (!nonEmptyString(homeDir)) throw new Error("createRunSpawnAdapter requires a non-empty homeDir.");
  if (!nonEmptyString(cliVersion)) throw new Error("createRunSpawnAdapter requires a non-empty cliVersion.");
  if (typeof startRunImpl !== "function") throw new Error("createRunSpawnAdapter requires a startRunImpl function.");
  if (typeof readRunEventsImpl !== "function") throw new Error("createRunSpawnAdapter requires a readRunEventsImpl function.");
  if (typeof stopRunImpl !== "function") throw new Error("createRunSpawnAdapter requires a stopRunImpl function.");
  if (onStart !== null && typeof onStart !== "function") throw new Error("createRunSpawnAdapter onStart must be a function when provided.");

  return async function spawnAdapter(decision, request) {
    assertSpawnArguments(decision, request);

    // Admission/permission/config rejections propagate unchanged: no run exists yet.
    const started = await startRunImpl({
      homeDir,
      agentId: decision.provider,
      task: request.task,
      cwd: request.projectRoot,
      model: decision.model.modelId,
      permissions: [],
      allowUnsafePermissions: false,
      requireVerifiedWriteContainment: true,
      captureTranscript: true,
      cliVersion,
      wait: true,
      strategy: "direct"
    });
    const runId = started?.runId;
    if (!nonEmptyString(runId)) {
      throw new Error("startRun resolved without a runId (executor contract violation).");
    }

    if (onStart) {
      // Isolated on purpose: a throwing or rejecting hook must never affect, cancel,
      // or delay the run, change the WorkResult, or lose the runId.
      const stop = (options) => stopRunImpl(homeDir, runId, options);
      try {
        Promise.resolve(onStart({ runId, stop, decision, request })).catch(() => {});
      } catch {
        // Swallowed by design; see above.
      }
    }

    // From here a run exists: every problem becomes a failed WorkResult keeping the runId.
    try {
      const metadata = await started.completion;
      const events = await readRunEventsImpl(homeDir, runId);
      return normalizeRunResult({ runId, metadata, events });
    } catch (error) {
      return failedAfterStart(runId, error);
    }
  };
}
