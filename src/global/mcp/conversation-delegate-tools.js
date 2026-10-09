/**
 * MCP delegation tools over the SAME conversation service the CLI uses.
 *
 * - kairo_plan_execution: read-only preview (service.planExecution); never launches.
 * - kairo_execute_plan (WRITE): the caller must echo the confirmationTarget of a
 *   preview. The target is re-validated against a fresh server-side preview and
 *   the launch happens only through service.executePlan({confirmationTarget}),
 *   whose execution link makes a repeated confirmed execute idempotent.
 * - kairo_cancel_execution (WRITE): service.cancelExecution.
 *
 * The project comes ONLY from the explicit workspace binding; inputs never
 * carry filesystem paths. MCP stays a transport: no second execution path.
 */
import * as z from "zod";
import { WORKSPACE_BINDING_CODES } from "./workspace-binding.js";
import { pubExecution, safeText } from "./conversation-read-tools.js";

export const KAIRO_MCP_CONVERSATION_DELEGATE_TOOLS = Object.freeze(["kairo_plan_execution"]);
export const KAIRO_MCP_CONVERSATION_DELEGATE_WRITE_TOOLS = Object.freeze([
  "kairo_execute_plan", "kairo_cancel_execution"
]);

const taskId = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);
const sessionRef = z.string().trim().min(1).max(128);
const opaque = z.string().min(1).max(256).nullable();
export const confirmationTargetSchema = z.object({
  role: z.string().trim().min(1).max(128),
  selection: z.enum(["assigned", "suggested-alternative"]),
  strategyFingerprint: opaque,
  candidateKey: opaque
});
export const conversationDelegateSchemas = Object.freeze({
  planExecution: z.object({ taskId, role: z.string().trim().min(1).max(128), ref: sessionRef.optional() }),
  executePlan: z.object({ taskId, confirmationTarget: confirmationTargetSchema, ref: sessionRef.optional() }),
  // The service's cancelExecution has no session ownership check, so no `ref` is accepted.
  cancelExecution: z.object({ taskId })
});

const scalar = (v) => (v === null || ["string", "number", "boolean"].includes(typeof v) ? v : null);
const pubTarget = (t) => (t == null ? null : {
  role: safeText(t.role), selection: scalar(t.selection ?? null),
  strategyFingerprint: scalar(t.strategyFingerprint ?? null), candidateKey: scalar(t.candidateKey ?? null)
});
const pubPreview = (p) => ({
  taskId: scalar(p?.taskId ?? null), decision: scalar(p?.decision ?? null), role: safeText(p?.role),
  provider: scalar(p?.provider ?? null), model: scalar(p?.model ?? null),
  assignmentSource: scalar(p?.assignmentSource ?? null), why: safeText(p?.why),
  confirmationTarget: pubTarget(p?.confirmationTarget),
  confirmationRequired: p?.confirmationTarget != null
});
const pubLaunch = (r) => ({
  taskId: scalar(r?.taskId ?? null), reused: r?.reused === true, ...pubExecution(r?.execution)
});

const TARGET_KEYS = ["role", "selection", "strategyFingerprint", "candidateKey"];
const sameTarget = (a, b) => a != null && b != null && TARGET_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));

function failCode(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const msg = String(error?.message ?? "");
  if (code === "SESSION_REF_AMBIGUOUS") return "session_ref_ambiguous";
  if (code === "SESSION_REF_UNKNOWN") return "session_ref_unknown";
  if (/belongs to a different session/i.test(msg)) return "session_mismatch";
  if (/has no .*execution/i.test(msg)) return "execution_not_found";
  if (/not found/i.test(msg)) return "task_not_found";
  if (/state changed since this was confirmed/i.test(msg)) return "confirmation_stale";
  return "delegation_failed";
}

/**
 * @param {{binding: object, getService: () => Promise<object>|object, mcpResult: Function}} args
 */
export function createConversationDelegateHandlers({ binding, getService, mcpResult }) {
  const fail = (code) => mcpResult({ ok: false, code, data: null, diagnostics: [code], isError: true });
  const guarded = (run) => async (args = {}) => {
    if (!binding?.writable) return fail(binding?.code ?? WORKSPACE_BINDING_CODES.UNBOUND);
    try {
      const service = await getService();
      return await run(service, binding.cwd, args);
    } catch (error) {
      return fail(failCode(error));
    }
  };
  const ok = (data) => mcpResult({ ok: true, code: "ok", data });
  const sessionIdFor = async (service, cwd, ref) => (
    ref ? (await service.resolveSession({ cwd, ref })).id : null
  );
  return {
    kairo_plan_execution: guarded(async (service, cwd, { taskId: id, role, ref } = {}) => ok(pubPreview(
      await service.planExecution({ cwd, taskId: id, role, sessionId: await sessionIdFor(service, cwd, ref) })
    ))),
    kairo_execute_plan: guarded(async (service, cwd, { taskId: id, confirmationTarget, ref } = {}) => {
      const parsed = confirmationTargetSchema.safeParse(confirmationTarget);
      if (!parsed.success) return fail("confirmation_required");
      const sessionId = await sessionIdFor(service, cwd, ref);
      const preview = await service.planExecution({ cwd, taskId: id, role: parsed.data.role, sessionId });
      if (!preview?.confirmationTarget) return fail("provider_unavailable");
      if (!sameTarget(parsed.data, preview.confirmationTarget)) return fail("confirmation_stale");
      return ok(pubLaunch(await service.executePlan({
        cwd, taskId: id, confirmationTarget: preview.confirmationTarget, sessionId
      })));
    }),
    kairo_cancel_execution: guarded(async (service, cwd, { taskId: id } = {}) => ok(pubLaunch(
      await service.cancelExecution({ cwd, taskId: id })
    )))
  };
}
