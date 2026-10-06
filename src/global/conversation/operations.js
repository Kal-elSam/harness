/**
 * Shared conversation operations: the ONE projection + operation layer used by
 * both MCP (Cursor) and the Pi host extension. Every operation delegates to
 * `createConversationService` (no other execution path) with an explicit
 * project root; nothing here reads process cwd, selects a team or launches
 * work except `execute`, which requires the preview confirmation target.
 */
import * as z from "zod";
import { safeText, scalar, id, ConversationOperationError } from "./operation-core.js";
import { createSetupOperations } from "./setup-operations.js";
import { EXECUTION_MODES, READ_ONLY_MODE, normalizeExecutionMode } from "./execution-mode.js";

export { safeText, scalar, ConversationOperationError };

export const pubSession = (s) => ({
  sessionId: id(s?.id), title: safeText(s?.title), mode: scalar(s?.mode ?? null),
  createdAt: scalar(s?.createdAt ?? null), updatedAt: scalar(s?.updatedAt ?? null)
});
export const pubExecution = (e) => (e == null ? null : {
  runId: id(e.runId), provider: scalar(e.provider ?? null), role: safeText(e.role), state: scalar(e.state ?? null),
  mode: e.mode === READ_ONLY_MODE ? READ_ONLY_MODE : "standard", active: e.active === true, error: safeText(e.error), startedAt: scalar(e.startedAt ?? null),
  updatedAt: scalar(e.updatedAt ?? null)
});
export const pubTask = (k) => ({
  taskId: id(k?.taskId), taskText: safeText(k?.taskText), state: scalar(k?.state ?? null),
  provider: scalar(k?.provider ?? null), model: safeText(k?.model), sessionId: id(k?.sessionId),
  execution: pubExecution(k?.execution), nextTransition: scalar(k?.nextTransition ?? null), artifactCount: Array.isArray(k?.artifacts) ? k.artifacts.length : 0,
  error: safeText(k?.error)
});
export const pubTeam = (t) => ({
  state: scalar(t?.state ?? null),
  roles: (t?.roles ?? []).map((r) => ({
    role: safeText(r?.role), provider: scalar(r?.provider ?? null), model: safeText(r?.model),
    modelId: scalar(r?.modelId ?? null), installed: r?.installed === true,
    launchable: r?.launchable === true, eligible: r?.eligible === true,
    blockedReason: safeText(r?.blockedReason)
  })),
  providers: (t?.providers ?? []).map((p) => ({
    id: scalar(p?.id ?? null), label: safeText(p?.label), installed: p?.installed === true,
    launchable: p?.launchable === true, reason: safeText(p?.reason),
    eligibility: p?.eligibility == null ? null : { ok: p.eligibility.ok === true, reason: safeText(p.eligibility.reason) }
  })),
  tasks: (t?.tasks ?? []).map(pubTask)
});
export const pubTaskResult = (r) => ({
  taskId: id(r?.taskId), runId: id(r?.runId), provider: scalar(r?.provider ?? null),
  status: scalar(r?.status ?? null), runState: scalar(r?.runState ?? null),
  result: r?.result == null ? null : {
    ok: r.result.ok === true, status: scalar(r.result.status ?? null),
    summary: safeText(r.result.summary), error: safeText(r.result.error)
  },
  errorCode: scalar(r?.errorCode ?? null),
  transitions: r?.transitions == null ? null : {
    state: scalar(r.transitions.state ?? null), next: scalar(r.transitions.next ?? null),
    recorded: (r.transitions.entries ?? []).map((e) => scalar(e?.kind ?? null))
  },
  gentle: r?.gentle == null ? null : {
    state: scalar(r.gentle.state ?? null), scope: scalar(r.gentle.scope ?? null),
    taskReview: scalar(r.gentle.taskReview ?? null), reason: safeText(r.gentle.reason),
    rddMode: ["on", "off"].includes(r.gentle.rddMode) ? r.gentle.rddMode : "unknown",
    rddSource: typeof r.gentle.rddSource === "string" && /^[a-z][a-z-]{0,31}$/.test(r.gentle.rddSource) ? r.gentle.rddSource : null
  }
});


const pubTarget = (t) => (t == null ? null : {
  role: safeText(t.role), selection: scalar(t.selection ?? null),
  strategyFingerprint: scalar(t.strategyFingerprint ?? null), candidateKey: scalar(t.candidateKey ?? null),
  // Standard stays byte-for-byte (no mode key); only read-only is bound explicitly.
  ...(t.mode === READ_ONLY_MODE ? { mode: READ_ONLY_MODE } : {})
});
export const pubPreview = (p) => ({
  taskId: scalar(p?.taskId ?? null), decision: scalar(p?.decision ?? null), role: safeText(p?.role),
  mode: p?.mode === READ_ONLY_MODE ? READ_ONLY_MODE : "standard",
  provider: scalar(p?.provider ?? null), model: scalar(p?.model ?? null),
  assignmentSource: scalar(p?.assignmentSource ?? null), why: safeText(p?.why),
  confirmationTarget: pubTarget(p?.confirmationTarget),
  confirmationRequired: p?.confirmationTarget != null
});
export const pubLaunch = (r) => ({
  taskId: scalar(r?.taskId ?? null), reused: r?.reused === true, ...pubExecution(r?.execution)
});

const TARGET_KEYS = ["role", "selection", "strategyFingerprint", "candidateKey"];
// Absent mode == "standard"; an unknown mode never equals anything.
const targetMode = (t) => normalizeExecutionMode(t?.mode);
export const sameTarget = (a, b) => a != null && b != null
  && TARGET_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null))
  && targetMode(a) != null && targetMode(a) === targetMode(b);

/** Map a service error to a public code. `fallback` differs for reads vs delegation. */
export function operationFailCode(error, fallback) {
  if (error instanceof ConversationOperationError) return error.code;
  const code = typeof error?.code === "string" ? error.code : "";
  const msg = String(error?.message ?? "");
  if (code === "read_only_unsupported" || code === "invalid_execution_mode") return code;
  if (code === "SESSION_REF_AMBIGUOUS") return "session_ref_ambiguous";
  if (code === "SESSION_REF_UNKNOWN") return "session_ref_unknown";
  if (/analysis is already running/i.test(msg)) return "analysis_in_progress";
  if (/not eligible to run/i.test(msg)) return "analyzer_unavailable";
  if (/belongs to a different session/i.test(msg)) return "session_mismatch";
  if (/has no .*execution/i.test(msg)) return "execution_not_found";
  if (/not found/i.test(msg)) return "task_not_found";
  if (/state changed since this was confirmed/i.test(msg)) return "confirmation_stale";
  return fallback;
}

/**
 * @param {{cwd: string, getService: () => Promise<object>|object}} args
 * Returns projected (public) data; throws ConversationOperationError.
 */
export function createConversationOperations({ cwd, getService }) {
  const run = async (fallback, fn) => {
    try {
      return await fn(await getService());
    } catch (error) {
      throw new ConversationOperationError(operationFailCode(error, fallback));
    }
  };
  const sessionIdFor = async (service, ref) => (
    ref ? (await service.resolveSession({ cwd, ref })).id : null
  );
  return {
    sessions: ({ ref } = {}) => run("read_failed", async (service) => (
      ref ? { sessions: [pubSession(await service.resolveSession({ cwd, ref }))] }
        : { sessions: (await service.listSessions({ cwd })).map(pubSession) }
    )),
    team: ({ ref } = {}) => run("read_failed", async (service) => pubTeam(
      await service.readTeam({ cwd, sessionId: await sessionIdFor(service, ref) })
    )),
    // Light read for hosts: sessions + tasks, no provider probes (see service.readWork).
    work: ({ ref } = {}) => run("read_failed", async (service) => {
      const work = await service.readWork({ cwd, sessionId: await sessionIdFor(service, ref) });
      return { sessions: (work.sessions ?? []).map(pubSession), tasks: (work.tasks ?? []).map(pubTask) };
    }),
    taskResult: ({ taskId, ref } = {}) => run("read_failed", async (service) => pubTaskResult(
      await service.readTaskResult({ cwd, taskId, sessionId: await sessionIdFor(service, ref) })
    )),
    plan: ({ taskId, role, ref, mode } = {}) => run("delegation_failed", async (service) => pubPreview(
      await service.planExecution({
        cwd, taskId, role, sessionId: await sessionIdFor(service, ref),
        ...(mode == null || mode === "standard" ? {} : { mode })
      })
    )),
    execute: ({ taskId, confirmationTarget, ref } = {}) => run("delegation_failed", async (service) => {
      const parsed = confirmationTargetShape(confirmationTarget);
      if (!parsed) throw new ConversationOperationError("confirmation_required");
      const sessionId = await sessionIdFor(service, ref);
      const mode = normalizeExecutionMode(parsed.mode);
      const preview = await service.planExecution({
        cwd, taskId, role: parsed.role, sessionId, ...(mode === READ_ONLY_MODE ? { mode } : {})
      });
      if (!preview?.confirmationTarget) throw new ConversationOperationError("provider_unavailable");
      if (!sameTarget(parsed, preview.confirmationTarget)) throw new ConversationOperationError("confirmation_stale");
      return pubLaunch(await service.executePlan({
        cwd, taskId, confirmationTarget: preview.confirmationTarget, sessionId,
        ...(mode === READ_ONLY_MODE ? { mode } : {})
      }));
    }),
    ...createSetupOperations({ cwd, run, sessionIdFor }),
    // Without `ref` the call is unchanged; with it, only that session's own task may be cancelled.
    cancel: ({ taskId, ref } = {}) => run("delegation_failed", async (service) => {
      const sessionId = await sessionIdFor(service, ref);
      return pubLaunch(await service.cancelExecution({ cwd, taskId, ...(sessionId ? { sessionId } : {}) }));
    })
  };
}

const opaque = z.string().min(1).max(256).nullable();
export const confirmationTargetSchema = z.object({
  role: z.string().trim().min(1).max(128),
  selection: z.enum(["assigned", "suggested-alternative"]),
  strategyFingerprint: opaque,
  candidateKey: opaque,
  mode: z.enum(EXECUTION_MODES).optional()
});
const confirmationTargetShape = (t) => {
  const parsed = confirmationTargetSchema.safeParse(t);
  return parsed.success ? parsed.data : null;
};
