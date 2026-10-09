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
import { createConversationOperations, confirmationTargetSchema, operationFailCode } from "../conversation/operations.js";

export const KAIRO_MCP_CONVERSATION_DELEGATE_TOOLS = Object.freeze(["kairo_plan_execution"]);
export const KAIRO_MCP_CONVERSATION_DELEGATE_WRITE_TOOLS = Object.freeze([
  "kairo_execute_plan", "kairo_cancel_execution"
]);

const taskId = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);
const sessionRef = z.string().trim().min(1).max(128);
export const conversationDelegateSchemas = Object.freeze({
  planExecution: z.object({ taskId, role: z.string().trim().min(1).max(128), ref: sessionRef.optional() }),
  executePlan: z.object({ taskId, confirmationTarget: confirmationTargetSchema, ref: sessionRef.optional() }),
  cancelExecution: z.object({ taskId, ref: sessionRef.optional() })
});

export { confirmationTargetSchema };

/**
 * @param {{binding: object, getService: () => Promise<object>|object, mcpResult: Function}} args
 */
export function createConversationDelegateHandlers({ binding, getService, mcpResult }) {
  const fail = (code) => mcpResult({ ok: false, code, data: null, diagnostics: [code], isError: true });
  const ops = binding?.writable ? createConversationOperations({ cwd: binding.cwd, getService }) : null;
  const guarded = (run) => async (args = {}) => {
    if (!ops) return fail(binding?.code ?? WORKSPACE_BINDING_CODES.UNBOUND);
    try {
      return mcpResult({ ok: true, code: "ok", data: await run(ops, args) });
    } catch (error) {
      return fail(operationFailCode(error, "delegation_failed"));
    }
  };
  return {
    kairo_plan_execution: guarded((ops, { taskId: id, role, ref } = {}) => ops.plan({ taskId: id, role, ref })),
    kairo_execute_plan: guarded((ops, { taskId: id, confirmationTarget, ref } = {}) => ops.execute({ taskId: id, confirmationTarget, ref })),
    kairo_cancel_execution: guarded((ops, { taskId: id, ref } = {}) => ops.cancel({ taskId: id, ref }))
  };
}
