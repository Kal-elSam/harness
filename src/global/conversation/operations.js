/**
 * Shared conversation operations: the ONE projection + operation layer used by
 * both MCP (Cursor) and the Pi host extension. Every operation delegates to
 * `createConversationService` (no other execution path) with an explicit
 * project root; nothing here reads process cwd, selects a team or launches
 * work except `execute`, which requires the preview confirmation target.
 */
import * as z from "zod";
import { redactSecrets } from "./secret-scanner.js";

const MAX_TEXT = 500;
const CREDENTIAL_RES = [
  /\bauthorization\s*[:=]\s*(?:bearer\s+)?\S+/gi,
  /\bbearer\s+\S+/gi,
  /\b(?:token|secret|password|passwd|api[_-]?key|credential|auth[_-]?key)s?\s*[:=]\s*\S+/gi
];
const PATH_RES = [
  /[A-Za-z]:\\[^\s"'`]+/g,
  /(?<![\w/.:])~?(?:\/[^\s/"'`]+){2,}/g,
  /(?<![\w/.:])\/(?:Users|home|tmp|var|etc|private|opt|root)\b/g
];

/** Free text from the service: redact credentials and absolute paths, cap length. */
export function safeText(value) {
  if (typeof value !== "string") return null;
  let text = value;
  for (const re of CREDENTIAL_RES) text = text.replace(re, "[redacted]");
  for (const re of PATH_RES) text = text.replace(re, "[path]");
  text = redactSecrets(text).text.replace(/\s+/g, " ").trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}...` : text;
}

export const scalar = (v) => (v === null || ["string", "number", "boolean"].includes(typeof v) ? v : null);
const id = (v) => (typeof v === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(v) ? v : null);

export const pubSession = (s) => ({
  sessionId: id(s?.id), title: safeText(s?.title), mode: scalar(s?.mode ?? null),
  createdAt: scalar(s?.createdAt ?? null), updatedAt: scalar(s?.updatedAt ?? null)
});
export const pubExecution = (e) => (e == null ? null : {
  runId: id(e.runId), provider: scalar(e.provider ?? null), state: scalar(e.state ?? null),
  active: e.active === true, error: safeText(e.error), startedAt: scalar(e.startedAt ?? null),
  updatedAt: scalar(e.updatedAt ?? null)
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
  tasks: (t?.tasks ?? []).map((k) => ({
    taskId: id(k?.taskId), taskText: safeText(k?.taskText), state: scalar(k?.state ?? null),
    provider: scalar(k?.provider ?? null), model: safeText(k?.model), sessionId: id(k?.sessionId),
    execution: pubExecution(k?.execution), nextTransition: scalar(k?.nextTransition ?? null), artifactCount: Array.isArray(k?.artifacts) ? k.artifacts.length : 0,
    error: safeText(k?.error)
  }))
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
    taskReview: scalar(r.gentle.taskReview ?? null), reason: safeText(r.gentle.reason)
  }
});


const pubTarget = (t) => (t == null ? null : {
  role: safeText(t.role), selection: scalar(t.selection ?? null),
  strategyFingerprint: scalar(t.strategyFingerprint ?? null), candidateKey: scalar(t.candidateKey ?? null)
});
export const pubPreview = (p) => ({
  taskId: scalar(p?.taskId ?? null), decision: scalar(p?.decision ?? null), role: safeText(p?.role),
  provider: scalar(p?.provider ?? null), model: scalar(p?.model ?? null),
  assignmentSource: scalar(p?.assignmentSource ?? null), why: safeText(p?.why),
  confirmationTarget: pubTarget(p?.confirmationTarget),
  confirmationRequired: p?.confirmationTarget != null
});
export const pubLaunch = (r) => ({
  taskId: scalar(r?.taskId ?? null), reused: r?.reused === true, ...pubExecution(r?.execution)
});

const TARGET_KEYS = ["role", "selection", "strategyFingerprint", "candidateKey"];
export const sameTarget = (a, b) => a != null && b != null && TARGET_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));

/** Typed operation failure; `code` is the stable public code. */
export class ConversationOperationError extends Error {
  constructor(code) { super(code); this.name = "ConversationOperationError"; this.code = code; }
}

/** Map a service error to a public code. `fallback` differs for reads vs delegation. */
export function operationFailCode(error, fallback) {
  if (error instanceof ConversationOperationError) return error.code;
  const code = typeof error?.code === "string" ? error.code : "";
  const msg = String(error?.message ?? "");
  if (code === "SESSION_REF_AMBIGUOUS") return "session_ref_ambiguous";
  if (code === "SESSION_REF_UNKNOWN") return "session_ref_unknown";
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
    taskResult: ({ taskId, ref } = {}) => run("read_failed", async (service) => pubTaskResult(
      await service.readTaskResult({ cwd, taskId, sessionId: await sessionIdFor(service, ref) })
    )),
    plan: ({ taskId, role, ref } = {}) => run("delegation_failed", async (service) => pubPreview(
      await service.planExecution({ cwd, taskId, role, sessionId: await sessionIdFor(service, ref) })
    )),
    execute: ({ taskId, confirmationTarget, ref } = {}) => run("delegation_failed", async (service) => {
      const parsed = confirmationTargetShape(confirmationTarget);
      if (!parsed) throw new ConversationOperationError("confirmation_required");
      const sessionId = await sessionIdFor(service, ref);
      const preview = await service.planExecution({ cwd, taskId, role: parsed.role, sessionId });
      if (!preview?.confirmationTarget) throw new ConversationOperationError("provider_unavailable");
      if (!sameTarget(parsed, preview.confirmationTarget)) throw new ConversationOperationError("confirmation_stale");
      return pubLaunch(await service.executePlan({
        cwd, taskId, confirmationTarget: preview.confirmationTarget, sessionId
      }));
    }),
    cancel: ({ taskId } = {}) => run("delegation_failed", async (service) => pubLaunch(
      await service.cancelExecution({ cwd, taskId })
    ))
  };
}

const opaque = z.string().min(1).max(256).nullable();
export const confirmationTargetSchema = z.object({
  role: z.string().trim().min(1).max(128),
  selection: z.enum(["assigned", "suggested-alternative"]),
  strategyFingerprint: opaque,
  candidateKey: opaque
});
const confirmationTargetShape = (t) => {
  const parsed = confirmationTargetSchema.safeParse(t);
  return parsed.success ? parsed.data : null;
};
