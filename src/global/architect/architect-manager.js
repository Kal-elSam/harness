import {
  PLAN_STATES, ARCHITECT_SCHEMA, createArchitectureRequestKey,
  createTaskId, normalizeArchitectTask, sha256
} from "./architect-types.js";
import { runArchitectCodex } from "./architect-codex.js";
import {
  acquireRequestLock, findReusableRequest, prepareTaskDirectory, resolveHead,
  resolveProjectRoot, writeAtomicText, writeTaskArtifacts
} from "./architect-store.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";
import { compileContextPack } from "../intelligence/context-compiler.js";

const REQUEST_DISCOVERY_ATTEMPTS = 40;
const REQUEST_DISCOVERY_DELAY_MS = 25;

async function waitForReusableRequest(projectRoot, requestKey) {
  for (let attempt = 0; attempt < REQUEST_DISCOVERY_ATTEMPTS; attempt += 1) {
    const active = await findReusableRequest(projectRoot, requestKey, {
      states: [PLAN_STATES.DRAFT, PLAN_STATES.AWAITING_APPROVAL]
    });
    if (active) return active;
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DISCOVERY_DELAY_MS));
  }
  return null;
}

async function prepareUniqueTask(projectRoot, task, now) {
  const baseId = createTaskId(task, now);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const taskId = `${baseId.slice(0, 96 - suffix.length)}${suffix}`;
    try {
      const paths = await prepareTaskDirectory(projectRoot, taskId, { createExclusive: true });
      return { taskId, paths };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Unable to allocate a unique architecture task id.");
}

export async function createArchitecturePlan({
  task, cwd = process.cwd(), model = null, now = new Date(), runCodex = runArchitectCodex,
  resolveRoot = resolveProjectRoot, resolveGitHead = resolveHead,
  compileContext = compileContextPack, acquireLock = acquireRequestLock
} = {}) {
  if (typeof task !== "string" || !task.trim()) throw new Error("Architect task is required.");
  const projectRoot = await resolveRoot(cwd);
  const baseHead = resolveGitHead(projectRoot);
  const normalizedTask = normalizeArchitectTask(task);
  const normalizedModel = model == null ? null : String(model).trim() || null;
  const requestKey = createArchitectureRequestKey({
    projectRoot, baseHead, task: normalizedTask, model: normalizedModel
  });
  const reusable = await findReusableRequest(projectRoot, requestKey);
  if (reusable) return { status: reusable.status, paths: reusable.paths, reused: true };

  const lock = await acquireLock(projectRoot, requestKey, { now });
  if (!lock.acquired) {
    const active = await waitForReusableRequest(projectRoot, requestKey);
    if (active) return { status: active.status, paths: active.paths, reused: true };
    throw new Error("An identical architecture request is already starting. Retry shortly.");
  }

  let paths;
  try {
    const afterLock = await findReusableRequest(projectRoot, requestKey);
    if (afterLock) return { status: afterLock.status, paths: afterLock.paths, reused: true };
    const orphan = await findReusableRequest(projectRoot, requestKey, { states: [PLAN_STATES.DRAFT] });
    if (orphan) {
      await writeAtomicJson(orphan.paths.statusPath, {
        ...orphan.status,
        state: PLAN_STATES.FAILED,
        updatedAt: now.toISOString(),
        error: {
          code: "stale_architect_request",
          message: "Recovered an interrupted architecture request whose owner is no longer active."
        }
      });
    }
    const prepared = await prepareUniqueTask(projectRoot, normalizedTask, now);
    const taskId = prepared.taskId;
    paths = prepared.paths;
    const taskMarkdown = `# Task\n\n${normalizedTask}\n`;
    const createdAt = now.toISOString();
    const draft = {
      schema: ARCHITECT_SCHEMA, taskId, state: PLAN_STATES.DRAFT,
      requestKey, provider: "codex", model: normalizedModel, projectRoot, baseHead,
      taskDigest: sha256(normalizedTask), taskArtifactDigest: sha256(taskMarkdown),
      planArtifactDigest: null, usage: null,
      createdAt, updatedAt: createdAt, decisionAt: null, decisionHead: null,
      artifacts: { task: ".ai/tasks/" + taskId + "/task.md", plan: ".ai/tasks/" + taskId + "/plan.md" }
    };
    await writeAtomicText(paths.taskPath, taskMarkdown);
    await writeAtomicJson(paths.statusPath, draft);
    try {
      const contextPack = await compileContext({
        workspaceRoot: projectRoot, task: normalizedTask, relevantPaths: [], includePrivate: false
      });
      const result = await runCodex({
        task: normalizedTask, cwd: projectRoot, model: normalizedModel, contextPack
      });
      const planMarkdown = `# Architecture Plan\n\n${result.plan.trim()}\n`;
      const awaiting = {
        ...draft,
        state: PLAN_STATES.AWAITING_APPROVAL,
        planArtifactDigest: sha256(planMarkdown),
        usage: result.usage ?? null,
        updatedAt: new Date().toISOString()
      };
      await writeTaskArtifacts({
        projectRoot, taskId, task: normalizedTask, plan: result.plan, status: awaiting
      });
      return { status: awaiting, paths, reused: false };
    } catch (error) {
      await writeAtomicJson(paths.statusPath, {
        ...draft, state: PLAN_STATES.FAILED, updatedAt: new Date().toISOString(),
        error: { code: error?.code ?? "architect_failed", message: error?.message ?? String(error) }
      });
      throw error;
    }
  } finally {
    await lock.release();
  }
}
