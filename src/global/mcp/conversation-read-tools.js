/**
 * Read-only MCP projections over the shared conversation service.
 *
 * The project is identified ONLY by the explicit workspace binding (never by
 * process cwd, env folders or tool input). Without a bound project the tools
 * refuse and the service is never built or called. MCP stays a transport:
 * nothing here selects a team, plans, executes or launches.
 */
import * as z from "zod";
import { createConversationOperations, safeText, pubExecution, pubTaskResult, operationFailCode } from "../conversation/operations.js";
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

export { safeText, pubExecution, pubTaskResult };

/**
 * @param {{binding: object, getService: () => Promise<object>|object, mcpResult: Function}} args
 */
export function createConversationReadHandlers({ binding, getService, mcpResult }) {
  const fail = (code) => mcpResult({ ok: false, code, data: null, diagnostics: [code], isError: true });
  const ops = binding?.writable ? createConversationOperations({ cwd: binding.cwd, getService }) : null;
  const guarded = (run) => async (args = {}) => {
    if (!ops) return fail(binding?.code ?? WORKSPACE_BINDING_CODES.UNBOUND);
    try {
      return mcpResult({ ok: true, code: "ok", data: await run(ops, args) });
    } catch (error) {
      return fail(operationFailCode(error, "read_failed"));
    }
  };
  return {
    kairo_sessions: guarded((ops, { ref } = {}) => ops.sessions({ ref })),
    kairo_team: guarded((ops, { ref } = {}) => ops.team({ ref })),
    kairo_task_result: guarded((ops, { taskId, ref } = {}) => ops.taskResult({ taskId, ref }))
  };
}
