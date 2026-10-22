import { resolve } from "node:path";
import { createArchitecturePlan } from "./architect-manager.js";
import { PLAN_STATES } from "./architect-types.js";
import {
  listTaskRecords, readTaskRecord, resolveProjectRoot, transitionTask
} from "./architect-store.js";
import { printJson } from "../json-output.js";
import { commandHeader } from "../brand/index.js";
import { createConversationService } from "../team/service.js";

/**
 * Preview/confirm contract: no --confirm is a read-only preview; --confirm
 * re-fetches the preview and executes only its confirmationTarget. PROJECT TEAM
 * is the sole authority, so --role is required and never inferred.
 */
async function runExecuteAction(service, options) {
  if (!options.role) {
    throw new Error("Missing --role. PROJECT TEAM is the sole authority for execution — pick the real role this task is for (see 'kairo plans show <taskId>' and the active team's roles).");
  }
  const preview = await service.planExecution({ cwd: options.cwd, taskId: options.taskId, role: options.role });
  if (!options.confirm) return preview;
  if (!preview.confirmationTarget) {
    throw new Error(`Cannot execute "${options.taskId}": ${preview.why}`);
  }
  return service.executePlan({ cwd: options.cwd, taskId: options.taskId, confirmationTarget: preview.confirmationTarget });
}

function publicRecord(projectRoot, record) {
  const status = record.status ?? record;
  const planExists = record.planMarkdown != null
    || [PLAN_STATES.AWAITING_APPROVAL, PLAN_STATES.APPROVED, PLAN_STATES.REJECTED].includes(status.state);
  return {
    ...status,
    ...(record.taskMarkdown ? { taskMarkdown: record.taskMarkdown } : {}),
    ...(record.planMarkdown ? { planMarkdown: record.planMarkdown } : {}),
    planPath: status.artifacts?.plan && planExists
      ? (record.paths?.planPath ?? resolve(projectRoot, status.artifacts.plan))
      : null
  };
}

export async function runArchitectCli(options, deps = {}) {
  const createPlan = deps.createPlan ?? createArchitecturePlan;
  const result = await createPlan({ task: options.task, cwd: options.cwd, model: options.model });
  const data = {
    ...publicRecord(result.status.projectRoot, { status: result.status, paths: result.paths }),
    reused: result.reused === true
  };
  if (options.json) printJson(data);
  else {
    console.log(commandHeader(`architecture plan · ${data.taskId}`));
    console.log(`State: ${data.state}`);
    if (data.planPath) {
      console.log(`Plan: ${data.artifacts.plan}`);
      console.log(`Approve: kairo plans approve ${data.taskId}`);
    } else {
      console.log("Planning is still active; no plan artifact is ready yet.");
    }
  }
  return data;
}

export async function runPlansCli(options, deps = {}) {
  const action = options.plansAction ?? "list";
  if (action === "execute" || action === "cancel" || action === "result") {
    const service = deps.service ?? createConversationService(deps);
    let result;
    if (action === "execute") result = await runExecuteAction(service, options);
    else if (action === "cancel") result = await service.cancelExecution({ cwd: options.cwd, taskId: options.taskId });
    else result = await service.readTaskResult({ cwd: options.cwd, taskId: options.taskId });
    if (options.json) printJson(result);
    else console.log(JSON.stringify(result, null, 2));
    return result;
  }
  const projectRoot = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
  if (action === "list") {
    const plans = await (deps.listRecords ?? listTaskRecords)(projectRoot);
    const data = { projectRoot, plans };
    if (options.json) printJson(data);
    else {
      console.log(commandHeader("architecture plans"));
      for (const plan of plans) console.log(`  ${plan.taskId}  ${plan.state}  ${plan.artifacts?.plan ?? ""}`);
      if (!plans.length) console.log("  (no plans)");
    }
    return data;
  }
  if (action === "show") {
    const record = await (deps.readRecord ?? readTaskRecord)(projectRoot, options.taskId);
    if (!record) throw new Error(`Plan "${options.taskId}" not found.`);
    const data = publicRecord(projectRoot, record);
    if (options.json) printJson(data);
    else {
      console.log(commandHeader(`architecture plan · ${data.taskId}`));
      console.log(record.planMarkdown ?? `No plan artifact (${data.state}): ${data.error?.message ?? "planning did not complete"}`);
    }
    return data;
  }
  const state = action === "approve" ? PLAN_STATES.APPROVED : PLAN_STATES.REJECTED;
  const record = await (deps.transition ?? transitionTask)(projectRoot, options.taskId, state);
  const data = publicRecord(projectRoot, record);
  if (options.json) printJson(data);
  else console.log(`${data.taskId}: ${data.state}`);
  return data;
}
