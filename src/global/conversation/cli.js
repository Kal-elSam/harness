import { createConversationService } from "./service.js";
import { printJson } from "../json-output.js";

/**
 * The scripted CLI's own preview/confirm contract, mirroring the cockpit
 * and browser local UI exactly: no `--confirm` is always a read-only
 * preview (service.planExecution — never reserves quota or starts a run);
 * `--confirm` re-fetches that same preview fresh, right before executing,
 * and executes exactly what it shows — `--model` can no longer bypass
 * PROJECT TEAM routing when `--role` is given (only a confirmed
 * `confirmationTarget` reaches executePlan on that path). Without `--role`
 * (no active project team yet), the legacy text-classification path stays
 * exactly as it always was, just gated behind the same explicit --confirm
 * step instead of firing immediately.
 * @param {ReturnType<typeof createConversationService>} service
 * @param {object} options
 */
async function runExecuteAction(service, options) {
  const preview = await service.planExecution({ cwd: options.cwd, taskId: options.taskId, role: options.role ?? null });
  if (!options.confirm) return preview;

  const isProjectTeamPreview = Object.prototype.hasOwnProperty.call(preview, "confirmationTarget");
  if (isProjectTeamPreview) {
    if (!preview.confirmationTarget) {
      throw new Error(`Cannot execute "${options.taskId}": ${preview.why}`);
    }
    return service.executePlan({ cwd: options.cwd, taskId: options.taskId, confirmationTarget: preview.confirmationTarget });
  }

  if (preview.decision !== "ROUTED") {
    throw new Error(`Cannot execute "${options.taskId}": ${preview.why}`);
  }
  return service.executePlan({
    cwd: options.cwd, taskId: options.taskId, agentId: preview.provider, model: options.model ?? preview.model
  });
}

export async function runConversationCli(options, deps = {}) {
  const service = deps.service ?? createConversationService(deps);
  const action = options.conversationAction ?? "snapshot";
  let result;
  if (action === "snapshot") result = await service.snapshot({ cwd: options.cwd });
  else if (action === "architect") {
    result = await service.submitArchitecture({ cwd: options.cwd, task: options.task, model: options.model });
  } else if (action === "show") {
    result = await service.showPlan({ cwd: options.cwd, taskId: options.taskId });
  } else if (action === "approve" || action === "reject") {
    result = await service.decidePlan({
      cwd: options.cwd,
      taskId: options.taskId,
      decision: action === "approve" ? "approved" : "rejected"
    });
  } else if (action === "execute") {
    result = await runExecuteAction(service, options);
  } else if (action === "cancel") {
    result = await service.cancelExecution({ cwd: options.cwd, taskId: options.taskId });
  } else throw new Error(`Unknown conversation action "${action}".`);
  if (options.json) printJson(result);
  else console.log(JSON.stringify(result, null, 2));
  return result;
}
