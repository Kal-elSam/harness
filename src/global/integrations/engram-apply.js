import {
  assertExplicitApplyConsent,
  promptApplyConfirmation,
  shouldPromptApplyConfirmation
} from "../apply-confirmation.js";
import { ENGRAM_INTEGRATION_STATUS } from "./engram-evidence.js";
import { planEngramConfigure } from "./engram-plan.js";
import { runEngramSetup } from "./engram-exec.js";

/** Apply Engram configure with consent; stop on first failure with partial receipt. */
export async function applyEngramConfigure({
  requestedAgentIds = null,
  detectedAgentIds = [],
  env = process.env,
  homeDir,
  dryRun = false,
  yes = false,
  json = false,
  interactive = null,
  plan = planEngramConfigure,
  runSetup = runEngramSetup,
  confirm = promptApplyConfirmation,
  now = () => new Date().toISOString()
} = {}) {
  assertExplicitApplyConsent({
    applying: !dryRun, dryRun, json, yes, interactive, command: "components configure"
  });

  const planned = plan({ requestedAgentIds, detectedAgentIds, env, homeDir, dryRun: true });
  if (dryRun) return { ...planned, applied: false, cancelled: false, receipt: null };
  if (planned.blocked) {
    throw new Error(planned.guidance ?? "Engram configure is blocked until the binary is supported.");
  }

  if (shouldPromptApplyConfirmation({ applying: true, dryRun, json, confirm: yes, interactive })) {
    const accepted = await confirm({
      command: "components configure engram-memory",
      question: "Apply Engram setup for the planned agents? [Y/n]: "
    });
    if (!accepted) return { ...planned, applied: false, cancelled: true, receipt: null };
  }

  const startedAt = now();
  const agentResults = [];
  let failed = null;

  for (const action of planned.actions) {
    if (action.action === "blocked" || !action.command) {
      failed = { agentId: action.agentId, slug: action.slug, error: action.reason ?? "Missing setup command." };
      break;
    }
    const [binaryPath, , slug] = action.command;
    const result = await runSetup({ binaryPath, slug, env });
    agentResults.push({
      agentId: action.agentId, slug, ok: result.ok, status: result.status,
      timedOut: result.timedOut, terminationFailed: result.terminationFailed,
      command: result.command, stdout: result.stdout, stderr: result.stderr
    });
    if (!result.ok) {
      failed = {
        agentId: action.agentId,
        slug,
        error: result.timedOut
          ? `Engram setup timed out for ${slug}.`
          : `Engram setup failed for ${slug} (exit ${result.status}).`
      };
      break;
    }
  }

  const completed = planned.actions
    .filter((action) => agentResults.some((entry) => entry.agentId === action.agentId && entry.ok))
    .map((action) => action.agentId);
  const remaining = planned.actions.map((a) => a.agentId).filter((id) => !completed.includes(id));

  const receipt = {
    id: `engram-${startedAt.replace(/[:.]/g, "-")}`,
    provider: "engram",
    componentId: "engram-memory",
    startedAt,
    finishedAt: now(),
    binary: planned.binary,
    agentsRequested: planned.actions.map((a) => a.agentId),
    agentsCompleted: completed,
    agentsRemaining: remaining,
    agentResults,
    ok: failed == null,
    partial: failed != null && completed.length > 0,
    failed,
    status: failed == null ? ENGRAM_INTEGRATION_STATUS.RESTART_REQUIRED : ENGRAM_INTEGRATION_STATUS.CONFLICT,
    persisted: false,
    touchedMemoryDb: false
  };

  return {
    ...planned,
    dryRun: false,
    executes: true,
    writes: true,
    applied: failed == null,
    cancelled: false,
    receipt
  };
}
