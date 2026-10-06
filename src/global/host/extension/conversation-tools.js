/**
 * Pi tools over the SAME conversation operations MCP uses
 * (src/global/conversation/operations.js). Pi is a transport here: no other
 * execution path, no team selection, no session binding or launch changes.
 * The project is the host's own cwd resolved to its project root; without a
 * host ctx the tools refuse (never process.cwd()).
 */
import { resolveProjectRoot } from "../../architect/architect-store.js";
import { resolveHomeDir } from "../../paths.js";
import { ConversationOperationError, createConversationOperations, operationFailCode } from "../../conversation/operations.js";

export const KAIRO_PI_CONVERSATION_TOOLS = Object.freeze([
  "kairo_sessions", "kairo_team", "kairo_task_result",
  "kairo_plan_execution", "kairo_execute_plan", "kairo_cancel_execution"
]);

const str = { type: "string" };
const ref = { type: "string", description: "Session ref (id or unique prefix); ambiguous refs are rejected." };
const target = {
  type: "object",
  properties: {
    role: str, selection: { enum: ["assigned", "suggested-alternative"] },
    strategyFingerprint: { type: ["string", "null"] }, candidateKey: { type: ["string", "null"] }
  },
  required: ["role", "selection", "strategyFingerprint", "candidateKey"]
};
const schema = (properties, required = []) => ({ type: "object", properties, required });

const DEFS = [
  ["kairo_sessions", "Kairo Sessions", "List this project's Kairo sessions (or resolve one ref).", schema({ ref }),
    (ops, p) => ops.sessions({ ref: p.ref }), "read_failed"],
  ["kairo_team", "Kairo Team", "Read this project's team, providers and task states.", schema({ ref }),
    (ops, p) => ops.team({ ref: p.ref }), "read_failed"],
  ["kairo_task_result", "Kairo Task Result", "Read a task's run result, transitions and next transition.",
    schema({ taskId: str, ref }, ["taskId"]), (ops, p) => ops.taskResult({ taskId: p.taskId, ref: p.ref }), "read_failed"],
  ["kairo_plan_execution", "Kairo Plan Execution", "Preview an execution (read-only); returns the confirmation target.",
    schema({ taskId: str, role: str, ref }, ["taskId", "role"]),
    (ops, p) => ops.plan({ taskId: p.taskId, role: p.role, ref: p.ref }), "delegation_failed"],
  ["kairo_execute_plan", "Kairo Execute Plan", "Launch a previewed execution; requires its confirmationTarget.",
    schema({ taskId: str, confirmationTarget: target, ref }, ["taskId", "confirmationTarget"]),
    (ops, p) => ops.execute({ taskId: p.taskId, confirmationTarget: p.confirmationTarget, ref: p.ref }), "delegation_failed"],
  ["kairo_cancel_execution", "Kairo Cancel Execution", "Cancel a task's active execution.",
    schema({ taskId: str }, ["taskId"]), (ops, p) => ops.cancel({ taskId: p.taskId }), "delegation_failed"]
];

/**
 * @param {object} pi Pi extension API (registerTool optional in tests).
 * @param {{getService?: Function, createService?: Function, resolveProjectRootImpl?: Function, env?: object}} [deps]
 */
export function registerKairoConversationTools(pi, deps = {}) {
  const { env = process.env, resolveProjectRootImpl = resolveProjectRoot } = deps;
  let service = deps.conversationService ?? null;
  const getService = deps.getService ?? (async () => {
    if (service) return service;
    const build = deps.createService ?? (async (d) => {
      const { createConversationService } = await import("../../conversation/service.js");
      return createConversationService(d);
    });
    service = await build({ homeDir: resolveHomeDir(env) });
    return service;
  });
  for (const [name, label, description, parameters, run, fallback] of DEFS) {
    pi.registerTool?.({
      name, label, description, parameters,
      async execute(_id, params = {}, _signal, _onUpdate, ctx) {
        const cwd = ctx?.cwd;
        if (typeof cwd !== "string" || cwd === "") throw new ConversationOperationError("project_unbound");
        try {
          const projectRoot = await resolveProjectRootImpl(cwd);
          const data = await run(createConversationOperations({ cwd: projectRoot, getService }), params);
          return { content: [{ type: "text", text: JSON.stringify(data) }], details: data };
        } catch (error) {
          throw new ConversationOperationError(operationFailCode(error, fallback));
        }
      }
    });
  }
}
