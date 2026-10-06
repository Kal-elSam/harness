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
  "kairo_plan_execution", "kairo_execute_plan", "kairo_cancel_execution",
  "kairo_setup", "kairo_setup_plan", "kairo_setup_run_analysis",
  "kairo_setup_approve_team", "kairo_setup_set_assignment"
]);

const str = { type: "string" };
const ref = { type: "string", description: "Session ref (id or unique prefix); ambiguous refs are rejected." };
const target = {
  type: "object",
  properties: {
    role: str, selection: { enum: ["assigned", "suggested-alternative"] },
    strategyFingerprint: { type: ["string", "null"] }, candidateKey: { type: ["string", "null"] },
    mode: { enum: ["standard", "read-only"] }
  },
  required: ["role", "selection", "strategyFingerprint", "candidateKey"]
};
const setupTarget = {
  type: "object",
  properties: {
    action: { enum: ["run_analysis", "approve_team", "set_assignment"] },
    subject: { type: ["string", "null"] }, candidateKey: { type: ["string", "null"] }, stateFingerprint: str
  },
  required: ["action", "subject", "candidateKey", "stateFingerprint"]
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
    schema({ taskId: str, role: str, mode: { enum: ["standard", "read-only"] }, ref }, ["taskId", "role"]),
    (ops, p) => ops.plan({ taskId: p.taskId, role: p.role, mode: p.mode, ref: p.ref }), "delegation_failed"],
  ["kairo_execute_plan", "Kairo Execute Plan", "Launch a previewed execution; requires its confirmationTarget.",
    schema({ taskId: str, confirmationTarget: target, ref }, ["taskId", "confirmationTarget"]),
    (ops, p) => ops.execute({ taskId: p.taskId, confirmationTarget: p.confirmationTarget, ref: p.ref }), "delegation_failed"],
  ["kairo_cancel_execution", "Kairo Cancel Execution", "Cancel a task's active execution (optional session ref enforces ownership).",
    schema({ taskId: str, ref }, ["taskId"]), (ops, p) => ops.cancel({ taskId: p.taskId, ref: p.ref }), "delegation_failed"],
  ["kairo_setup", "Kairo Setup", "Read setup state: installed vs access-verified providers, analyzer catalog, initial analyzer vs permanent orchestrator, draft/active team. Selects and starts nothing.",
    schema({ ref }), (ops, p) => ops.setup({ ref: p.ref }), "read_failed"],
  ["kairo_setup_plan", "Kairo Setup Plan", "Preview a setup action (run_analysis, approve_team, set_assignment); returns the confirmation target or a typed refusal. Changes nothing.",
    schema({ action: { enum: ["run_analysis", "approve_team", "set_assignment"] }, analyzerKey: str, role: str, candidateKey: str, ref }, ["action"]),
    (ops, p) => ops.planSetup(p), "setup_failed"],
  ["kairo_setup_run_analysis", "Kairo Setup Run Analysis", "GENERATIVE, spends provider usage: run the initial analysis; requires the confirmationTarget of a fresh preview.",
    schema({ confirmationTarget: setupTarget, ref }, ["confirmationTarget"]), (ops, p) => ops.runAnalysis(p), "analysis_failed"],
  ["kairo_setup_approve_team", "Kairo Setup Approve Team", "Approve the draft team; requires the confirmationTarget of a fresh preview.",
    schema({ confirmationTarget: setupTarget, ref }, ["confirmationTarget"]), (ops, p) => ops.approveTeam(p), "approval_failed"],
  ["kairo_setup_set_assignment", "Kairo Setup Set Assignment", "Change one role's assignment in the draft team; requires the confirmationTarget of a fresh preview.",
    schema({ confirmationTarget: setupTarget, ref }, ["confirmationTarget"]), (ops, p) => ops.setAssignment(p), "assignment_failed"]
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
