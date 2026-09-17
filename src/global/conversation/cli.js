import { createConversationService } from "./service.js";
import { printJson } from "../json-output.js";

/**
 * The scripted CLI's own preview/confirm contract, mirroring the cockpit
 * and browser local UI exactly: no `--confirm` is always a read-only
 * preview (service.planExecution — never reserves quota or starts a run);
 * `--confirm` re-fetches that same preview fresh, right before executing,
 * and executes exactly what it shows. PROJECT TEAM is the sole authority
 * for execution — `--role` is required (never inferred from task text),
 * and there is no `--model`/`--agent` override left to bypass it; only a
 * confirmed `confirmationTarget` from the fresh preview ever reaches
 * executePlan.
 * @param {ReturnType<typeof createConversationService>} service
 * @param {object} options
 */
async function runExecuteAction(service, options) {
  if (!options.role) {
    throw new Error(`Missing --role. PROJECT TEAM is the sole authority for execution — pick the real role this task is for (see /project or 'conversation snapshot' for the active team's roles).`);
  }
  const preview = await service.planExecution({ cwd: options.cwd, taskId: options.taskId, role: options.role });
  if (!options.confirm) return preview;

  if (!preview.confirmationTarget) {
    throw new Error(`Cannot execute "${options.taskId}": ${preview.why}`);
  }
  return service.executePlan({ cwd: options.cwd, taskId: options.taskId, confirmationTarget: preview.confirmationTarget });
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
