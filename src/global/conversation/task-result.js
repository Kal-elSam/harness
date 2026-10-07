import { isActiveRunState, TERMINAL_RUN_STATES } from "../runtime/run-types.js";
import { PROVIDER } from "../control-plane/constants.js";

const GENTLE_STATE = Object.freeze({
  official: "project_receipt",
  pending: "pending",
  rdd_off: "rdd_off",
  incompatible: "incompatible",
  unavailable: "unavailable"
});

function envelope(taskId, link, run, status, extra = {}) {
  return {
    taskId,
    runId: link?.runId ?? null,
    provider: run?.agentId ?? link?.agentId ?? null,
    status,
    runState: run?.state ?? null,
    result: null,
    gentle: null,
    ...extra
  };
}

// A malformed run record or event log is typed corrupt, never a crash.
const corruptCode = (error) => (error instanceof SyntaxError ? { errorCode: "result_corrupt" } : {});

async function readGentle(readGentleContext, projectRoot) {
  try {
    return await readGentleContext({ projectRoot });
  } catch (error) {
    return { provider: PROVIDER.UNAVAILABLE, error: error?.message ?? "gentle_reader_failed" };
  }
}

// Gentle is shown as project context only: a receipt never proves this task
// was reviewed, so association's approval field is deliberately dropped.
function projectGentle(association, input) {
  const { reviewRef, gentleContext } = association;
  const state = GENTLE_STATE[reviewRef.association] ?? "incompatible";
  // Observation only: Gentle's status is valid project context, but it publishes no
  // verifiable receipt/task/run/candidate binding, so nothing may act on this task.
  const validStatus = state === GENTLE_STATE.official || state === GENTLE_STATE.pending;
  return {
    state,
    diagnostics: validStatus ? ["task_binding_unavailable"] : [],
    actionsEnabled: false,
    scope: "project_context",
    taskReview: "not_established",
    receipt: reviewRef.receipt,
    gate: reviewRef.gate,
    applicability: gentleContext?.applicability ?? null,
    nextTransition: reviewRef.nextTransition,
    reason: input.error ?? input.mappedStatus?.error ?? null,
    // User-owned switch, shown as context only: `on` is not task approval and
    // `unknown` never means permission.
    rddMode: ["on", "off"].includes(input.rddMode) ? input.rddMode : "unknown",
    rddSource: typeof input.rddSource === "string" ? input.rddSource : null
  };
}

/**
 * Read-only composition of a task's recoverable result from already-read
 * evidence. Never launches, writes, or fabricates: only terminal runs are
 * normalized and only then is Gentle consulted.
 */
export async function composeTaskResult({
  taskId, projectRoot, link, readRun, readEvents, normalize, associate, readGentleContext
}) {
  if (!link) return envelope(taskId, null, null, "not_started");

  let run;
  try {
    run = await readRun(link.runId);
  } catch (error) {
    return envelope(taskId, link, null, "evidence_unreadable", {
      error: error?.message ?? String(error), ...corruptCode(error)
    });
  }
  if (!run) return envelope(taskId, link, null, "evidence_missing");
  if (isActiveRunState(run.state)) return envelope(taskId, link, run, "running");
  if (!TERMINAL_RUN_STATES.has(run.state)) return envelope(taskId, link, run, "unrecognized_state");

  let events;
  try {
    events = await readEvents(link.runId);
  } catch (error) {
    return envelope(taskId, link, run, "evidence_unreadable", {
      error: error?.message ?? String(error), ...corruptCode(error)
    });
  }
  // A dropped line could be the final transcript entry, so a result built
  // around it would not be faithful.
  const broken = events.find((event) => event?.parseError);
  if (broken) {
    return envelope(taskId, link, run, "evidence_unreadable", {
      error: `Run events contain unparseable line ${broken.line ?? "?"}.`,
      errorCode: "result_corrupt"
    });
  }

  const result = normalize({ runId: link.runId, metadata: run, events });
  const input = await readGentle(readGentleContext, projectRoot);
  const association = associate({
    result,
    provider: input.provider,
    mappedStatus: input.mappedStatus ?? null,
    rddMode: input.rddMode ?? "unknown"
  });
  return envelope(taskId, link, run, "terminal", {
    result: association.result,
    gentle: projectGentle(association, input)
  });
}
