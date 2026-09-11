import { createConversationService } from "./service.js";
import { printJson } from "../json-output.js";

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
    result = await service.executePlan({ cwd: options.cwd, taskId: options.taskId, model: options.model });
  } else if (action === "cancel") {
    result = await service.cancelExecution({ cwd: options.cwd, taskId: options.taskId });
  } else throw new Error(`Unknown conversation action "${action}".`);
  if (options.json) printJson(result);
  else console.log(JSON.stringify(result, null, 2));
  return result;
}
