/**
 * Read-only MCP projections over the shared conversation service.
 *
 * The project is identified ONLY by the explicit workspace binding (never by
 * process cwd, env folders or tool input). Without a bound project the tools
 * refuse and the service is never built or called. MCP stays a transport:
 * nothing here selects a team, plans, executes or launches.
 */
import * as z from "zod";
import { redactSecrets } from "../conversation/secret-scanner.js";
import { WORKSPACE_BINDING_CODES } from "./workspace-binding.js";

export const KAIRO_MCP_CONVERSATION_READ_TOOLS = Object.freeze([
  "kairo_sessions", "kairo_team", "kairo_task_result"
]);

const sessionRef = z.string().trim().min(1).max(128);
export const conversationReadSchemas = Object.freeze({
  sessions: z.object({ ref: sessionRef.optional() }),
  team: z.object({ ref: sessionRef.optional() }),
  taskResult: z.object({
    taskId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
    ref: sessionRef.optional()
  })
});

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

const scalar = (v) => (v === null || ["string", "number", "boolean"].includes(typeof v) ? v : null);
const id = (v) => (typeof v === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(v) ? v : null);

const pubSession = (s) => ({
  sessionId: id(s?.id), title: safeText(s?.title), mode: scalar(s?.mode ?? null),
  createdAt: scalar(s?.createdAt ?? null), updatedAt: scalar(s?.updatedAt ?? null)
});
const pubExecution = (e) => (e == null ? null : {
  runId: id(e.runId), provider: scalar(e.provider ?? null), state: scalar(e.state ?? null),
  active: e.active === true, error: safeText(e.error), startedAt: scalar(e.startedAt ?? null),
  updatedAt: scalar(e.updatedAt ?? null)
});
const pubTeam = (t) => ({
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
    execution: pubExecution(k?.execution), artifactCount: Array.isArray(k?.artifacts) ? k.artifacts.length : 0,
    error: safeText(k?.error)
  }))
});
const pubTaskResult = (r) => ({
  taskId: id(r?.taskId), runId: id(r?.runId), provider: scalar(r?.provider ?? null),
  status: scalar(r?.status ?? null), runState: scalar(r?.runState ?? null),
  result: r?.result == null ? null : {
    ok: r.result.ok === true, status: scalar(r.result.status ?? null),
    summary: safeText(r.result.summary), error: safeText(r.result.error)
  },
  gentle: r?.gentle == null ? null : {
    state: scalar(r.gentle.state ?? null), scope: scalar(r.gentle.scope ?? null),
    taskReview: scalar(r.gentle.taskReview ?? null), reason: safeText(r.gentle.reason)
  }
});

function failCode(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "SESSION_REF_AMBIGUOUS") return "session_ref_ambiguous";
  if (code === "SESSION_REF_UNKNOWN") return "session_ref_unknown";
  if (/not found/i.test(String(error?.message ?? ""))) return "task_not_found";
  return "read_failed";
}

/**
 * @param {{binding: object, getService: () => Promise<object>|object, mcpResult: Function}} args
 */
export function createConversationReadHandlers({ binding, getService, mcpResult }) {
  const fail = (code) => mcpResult({ ok: false, code, data: null, diagnostics: [code], isError: true });
  const guarded = (run) => async (args = {}) => {
    if (!binding?.writable) return fail(binding?.code ?? WORKSPACE_BINDING_CODES.UNBOUND);
    try {
      const service = await getService();
      return mcpResult({ ok: true, code: "ok", data: await run(service, binding.cwd, args) });
    } catch (error) {
      return fail(failCode(error));
    }
  };
  const sessionIdFor = async (service, cwd, ref) => (
    ref ? (await service.resolveSession({ cwd, ref })).id : null
  );
  return {
    kairo_sessions: guarded(async (service, cwd, { ref } = {}) => {
      if (ref) return { sessions: [pubSession(await service.resolveSession({ cwd, ref }))] };
      return { sessions: (await service.listSessions({ cwd })).map(pubSession) };
    }),
    kairo_team: guarded(async (service, cwd, { ref } = {}) => pubTeam(
      await service.readTeam({ cwd, sessionId: await sessionIdFor(service, cwd, ref) })
    )),
    kairo_task_result: guarded(async (service, cwd, { taskId, ref } = {}) => pubTaskResult(
      await service.readTaskResult({ cwd, taskId, sessionId: await sessionIdFor(service, cwd, ref) })
    ))
  };
}
