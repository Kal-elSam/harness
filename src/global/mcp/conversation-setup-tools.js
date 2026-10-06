/**
 * MCP setup tools over the shared conversation operations.
 *
 * - kairo_setup (read): installed vs access-verified providers, analyzer
 *   catalog, initial analyzer vs permanent orchestrator, draft/active status.
 * - kairo_setup_plan (read): preview of one setup mutation + confirmation target.
 * - kairo_setup_run_analysis / kairo_setup_approve_team / kairo_setup_set_assignment
 *   (WRITE): the caller must echo the confirmationTarget of a fresh preview;
 *   it is re-derived server-side before anything happens.
 *
 * The project comes ONLY from the explicit workspace binding.
 */
import * as z from "zod";
import { WORKSPACE_BINDING_CODES } from "./workspace-binding.js";
import { createConversationOperations, operationFailCode } from "../conversation/operations.js";
import { SETUP_ACTIONS, setupConfirmationTargetSchema } from "../conversation/setup-operations.js";

export const KAIRO_MCP_CONVERSATION_SETUP_TOOLS = Object.freeze(["kairo_setup", "kairo_setup_plan"]);
export const KAIRO_MCP_CONVERSATION_SETUP_WRITE_TOOLS = Object.freeze([
  "kairo_setup_run_analysis", "kairo_setup_approve_team", "kairo_setup_set_assignment"
]);

const sessionRef = z.string().trim().min(1).max(128);
const key = z.string().trim().min(1).max(256);
const confirmed = z.object({ confirmationTarget: setupConfirmationTargetSchema, ref: sessionRef.optional() });
export const conversationSetupSchemas = Object.freeze({
  setup: z.object({ ref: sessionRef.optional() }),
  setupPlan: z.object({
    action: z.enum(SETUP_ACTIONS), analyzerKey: key.optional(), role: z.string().trim().min(1).max(128).optional(),
    candidateKey: key.optional(), ref: sessionRef.optional()
  }),
  setupRunAnalysis: confirmed,
  setupApproveTeam: confirmed,
  setupSetAssignment: confirmed
});

/**
 * @param {{binding: object, getService: () => Promise<object>|object, mcpResult: Function}} args
 */
export function createConversationSetupHandlers({ binding, getService, mcpResult }) {
  const fail = (code) => mcpResult({ ok: false, code, data: null, diagnostics: [code], isError: true });
  const ops = binding?.writable ? createConversationOperations({ cwd: binding.cwd, getService }) : null;
  const guarded = (fallback, run) => async (args = {}) => {
    if (!ops) return fail(binding?.code ?? WORKSPACE_BINDING_CODES.UNBOUND);
    try {
      return mcpResult({ ok: true, code: "ok", data: await run(ops, args) });
    } catch (error) {
      return fail(operationFailCode(error, fallback));
    }
  };
  return {
    kairo_setup: guarded("read_failed", (o, { ref } = {}) => o.setup({ ref })),
    kairo_setup_plan: guarded("setup_failed", (o, a = {}) => o.planSetup(a)),
    kairo_setup_run_analysis: guarded("analysis_failed", (o, a = {}) => o.runAnalysis(a)),
    kairo_setup_approve_team: guarded("approval_failed", (o, a = {}) => o.approveTeam(a)),
    kairo_setup_set_assignment: guarded("assignment_failed", (o, a = {}) => o.setAssignment(a))
  };
}
