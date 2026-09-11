import { constants } from "node:fs";
import {
  lstat, mkdir, open, readdir, readFile, realpath, rename, rmdir, unlink
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";
import { ARCHITECT_SCHEMA, PLAN_STATES, assertTaskId, sha256 } from "./architect-types.js";

export const TASKS_RELATIVE_DIR = join(".ai", "tasks");
export const EXECUTION_SCHEMA = "kairo.architect-execution/v1";
const REQUEST_LOCKS_DIR = ".requests";
const DEFAULT_REQUEST_LOCK_STALE_MS = 15 * 60 * 1000;

function isInside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
}

async function statOrNull(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function assertSafeFile(path) {
  const stat = await statOrNull(path);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsafe artifact path: ${path}`);
}

async function ensureSafeDirectory(root, segments) {
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    const before = await statOrNull(current);
    if (before?.isSymbolicLink() || (before && !before.isDirectory())) {
      throw new Error(`Unsafe artifact directory: ${current}`);
    }
    if (!before) await mkdir(current);
    const after = await lstat(current);
    if (after.isSymbolicLink() || !after.isDirectory()) throw new Error(`Unsafe artifact directory: ${current}`);
    const canonical = await realpath(current);
    if (!isInside(root, canonical)) throw new Error(`Artifact directory escapes project: ${current}`);
  }
  return current;
}

export async function resolveProjectRoot(cwd, { exec = execFileSync } = {}) {
  const requested = await realpath(resolve(cwd ?? process.cwd()));
  let root;
  try {
    root = String(exec("git", ["rev-parse", "--show-toplevel"], {
      cwd: requested, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
    })).trim();
  } catch {
    throw new Error(`Architect requires a Git repository: ${requested}`);
  }
  const canonical = await realpath(root);
  if (!isInside(canonical, requested)) throw new Error("Resolved cwd is outside the Git project root.");
  return canonical;
}

export function resolveHead(projectRoot, { exec = execFileSync } = {}) {
  try {
    return String(exec("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
    })).trim();
  } catch {
    throw new Error("Architect requires a repository with a valid HEAD commit.");
  }
}

export function taskPaths(projectRoot, taskId) {
  const safeId = assertTaskId(taskId);
  const tasksRoot = join(projectRoot, TASKS_RELATIVE_DIR);
  const taskDir = join(tasksRoot, safeId);
  if (!isInside(tasksRoot, taskDir)) throw new Error("Task path escapes project artifacts.");
  return {
    tasksRoot, taskDir,
    taskPath: join(taskDir, "task.md"),
    planPath: join(taskDir, "plan.md"),
    statusPath: join(taskDir, "status.json"),
    executionPath: join(taskDir, "execution.json")
  };
}

export async function prepareTaskDirectory(projectRoot, taskId, { createExclusive = false } = {}) {
  const paths = taskPaths(projectRoot, taskId);
  if (createExclusive) {
    await ensureSafeDirectory(projectRoot, [".ai", "tasks"]);
    await mkdir(paths.taskDir);
    const canonical = await realpath(paths.taskDir);
    if (!isInside(projectRoot, canonical)) throw new Error(`Task directory escapes project: ${paths.taskDir}`);
  } else {
    await ensureSafeDirectory(projectRoot, [".ai", "tasks", taskId]);
  }
  for (const path of [paths.taskPath, paths.planPath, paths.statusPath, paths.executionPath]) await assertSafeFile(path);
  return paths;
}

export async function writeAtomicText(targetPath, value) {
  await assertSafeFile(targetPath);
  const tempPath = join(dirname(targetPath), `.${basename(targetPath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    await handle.writeFile(String(value), "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, targetPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function writeTaskArtifacts({ projectRoot, taskId, task, plan, status }) {
  const paths = await prepareTaskDirectory(projectRoot, taskId);
  await writeAtomicText(paths.taskPath, `# Task\n\n${String(task).trim()}\n`);
  await writeAtomicText(paths.planPath, `# Architecture Plan\n\n${String(plan).trim()}\n`);
  await writeAtomicJson(paths.statusPath, status);
  return paths;
}

export async function readTaskRecord(projectRoot, taskId) {
  const paths = taskPaths(projectRoot, taskId);
  const rootStat = await statOrNull(paths.taskDir);
  if (!rootStat) return null;
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`Unsafe task directory: ${paths.taskDir}`);
  const [canonicalProject, canonicalTaskDir] = await Promise.all([realpath(projectRoot), realpath(paths.taskDir)]);
  if (!isInside(canonicalProject, canonicalTaskDir)) throw new Error(`Task directory escapes project: ${paths.taskDir}`);
  for (const path of [paths.taskPath, paths.planPath, paths.statusPath, paths.executionPath]) await assertSafeFile(path);
  const [taskMarkdown, statusRaw] = await Promise.all([
    readFile(paths.taskPath, "utf8"), readFile(paths.statusPath, "utf8")
  ]);
  const status = JSON.parse(statusRaw);
  const expectedArtifacts = {
    task: `.ai/tasks/${taskId}/task.md`,
    plan: `.ai/tasks/${taskId}/plan.md`
  };
  if (status.schema !== ARCHITECT_SCHEMA || status.taskId !== taskId
    || status.projectRoot !== canonicalProject
    || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(status.baseHead ?? "")
    || status.artifacts?.task !== expectedArtifacts.task
    || status.artifacts?.plan !== expectedArtifacts.plan) {
    throw new Error(`Invalid task status: ${taskId}`);
  }
  let planMarkdown = null;
  const planStat = await statOrNull(paths.planPath);
  if (planStat) planMarkdown = await readFile(paths.planPath, "utf8");
  else if (status.state !== PLAN_STATES.FAILED && status.state !== PLAN_STATES.DRAFT) {
    throw new Error(`Plan artifact missing: ${taskId}`);
  }
  return { status, taskMarkdown, planMarkdown, paths };
}

export async function listTaskRecords(projectRoot) {
  const tasksRoot = join(projectRoot, TASKS_RELATIVE_DIR);
  const stat = await statOrNull(tasksRoot);
  if (!stat) return [];
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe tasks directory: ${tasksRoot}`);
  const entries = await readdir(tasksRoot, { withFileTypes: true });
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(entry.name)) continue;
    try {
      const record = await readTaskRecord(projectRoot, entry.name);
      if (record) rows.push(record.status);
    } catch { /* malformed task is not advertised */ }
  }
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function findReusableRequest(projectRoot, requestKey, {
  states = [PLAN_STATES.AWAITING_APPROVAL]
} = {}) {
  const records = await listTaskRecords(projectRoot);
  const status = records.find((row) => row.requestKey === requestKey
    && states.includes(row.state));
  return status ? readTaskRecord(projectRoot, status.taskId) : null;
}

function assertRequestKey(requestKey) {
  if (!/^[0-9a-f]{64}$/.test(requestKey ?? "")) throw new Error("Invalid architecture request key.");
  return requestKey;
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

async function staleRequestLock(lockDir, leasePath, { nowMs, staleAfterMs }) {
  const lockStat = await statOrNull(lockDir);
  if (!lockStat) return true;
  if (lockStat.isSymbolicLink() || !lockStat.isDirectory()) {
    throw new Error(`Unsafe architecture request lock: ${lockDir}`);
  }
  let lease = null;
  try {
    await assertSafeFile(leasePath);
    lease = JSON.parse(await readFile(leasePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  const createdMs = Date.parse(lease?.createdAt ?? "");
  const ageMs = nowMs - (Number.isFinite(createdMs) ? createdMs : lockStat.mtimeMs);
  if (Number.isSafeInteger(lease?.pid) && lease.pid > 0) return !processIsAlive(lease.pid);
  return ageMs >= staleAfterMs;
}

async function removeRequestLock(lockDir, leasePath) {
  await assertSafeFile(leasePath);
  await unlink(leasePath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  await rmdir(lockDir);
}

export async function acquireRequestLock(projectRoot, requestKey, {
  now = new Date(), staleAfterMs = DEFAULT_REQUEST_LOCK_STALE_MS
} = {}) {
  const key = assertRequestKey(requestKey);
  const requestsRoot = await ensureSafeDirectory(projectRoot, [".ai", "tasks", REQUEST_LOCKS_DIR]);
  const lockDir = join(requestsRoot, `${key}.lock`);
  const leasePath = join(lockDir, "lease.json");
  const token = randomBytes(16).toString("hex");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDir);
      await writeAtomicJson(leasePath, {
        requestKey: key, token, pid: process.pid, createdAt: now.toISOString()
      }, { createExclusive: true });
      return {
        acquired: true,
        async release() {
          let lease;
          try { lease = JSON.parse(await readFile(leasePath, "utf8")); }
          catch (error) { if (error.code === "ENOENT") return; throw error; }
          if (lease.token !== token) return;
          await removeRequestLock(lockDir, leasePath);
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") {
        await removeRequestLock(lockDir, leasePath).catch(() => {});
        throw error;
      }
      if (attempt === 0 && await staleRequestLock(lockDir, leasePath, {
        nowMs: now.getTime(), staleAfterMs
      })) {
        await removeRequestLock(lockDir, leasePath).catch((removeError) => {
          if (removeError.code !== "ENOENT" && removeError.code !== "ENOTEMPTY") throw removeError;
        });
        continue;
      }
      return { acquired: false, release: async () => {} };
    }
  }
  return { acquired: false, release: async () => {} };
}

export function verifyArtifactDigests(record) {
  if (sha256(record.taskMarkdown) !== record.status.taskArtifactDigest) throw new Error("Task artifact changed after planning.");
  if (sha256(record.planMarkdown) !== record.status.planArtifactDigest) throw new Error("Plan artifact changed after planning.");
}

export function resolveWorkingTreeFingerprint(projectRoot, { exec = execFileSync } = {}) {
  const diff = exec("git", ["diff", "--binary", "HEAD", "--", ".", ":(exclude).ai/tasks/**"], {
    cwd: projectRoot, encoding: null, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024
  });
  const untrackedRaw = exec("git", [
    "ls-files", "--others", "--exclude-standard", "-z", "--", ".", ":(exclude).ai/tasks/**"
  ], { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const hash = createHash("sha256").update("kairo-working-tree/v1\0").update(diff);
  for (const file of String(untrackedRaw).split("\0").filter(Boolean).sort()) {
    const path = join(projectRoot, file);
    const stat = lstatSync(path);
    hash.update("\0").update(file).update("\0");
    if (stat.isSymbolicLink()) hash.update("symlink\0").update(readlinkSync(path));
    else if (stat.isFile()) hash.update("file\0").update(readFileSync(path));
    else hash.update("other\0");
  }
  return hash.digest("hex");
}

export async function readExecutionLink(projectRoot, taskId) {
  const record = await readTaskRecord(projectRoot, taskId);
  if (!record) return null;
  const paths = taskPaths(projectRoot, taskId);
  await assertSafeFile(paths.executionPath);
  const stat = await statOrNull(paths.executionPath);
  if (!stat) return null;
  const link = JSON.parse(await readFile(paths.executionPath, "utf8"));
  if (link?.schema !== EXECUTION_SCHEMA || link?.taskId !== taskId
    || !/^run_[a-z0-9_]+$/.test(link?.runId ?? "") || link?.provider !== "claude") {
    throw new Error(`Invalid execution artifact: ${taskId}`);
  }
  return link;
}

export async function writeExecutionLink(projectRoot, taskId, link) {
  const paths = await prepareTaskDirectory(projectRoot, taskId);
  const value = { ...link, schema: EXECUTION_SCHEMA, taskId, provider: "claude" };
  await writeAtomicJson(paths.executionPath, value, { createExclusive: true });
  return value;
}

export async function updateExecutionLink(projectRoot, taskId, link) {
  const paths = await prepareTaskDirectory(projectRoot, taskId);
  const value = { ...link, schema: EXECUTION_SCHEMA, taskId, provider: "claude" };
  await writeAtomicJson(paths.executionPath, value);
  return value;
}

export async function verifyPlanForExecution(projectRoot, taskId, {
  exec, checkWorkingTree = true
} = {}) {
  const record = await readTaskRecord(projectRoot, taskId);
  if (!record) throw new Error(`Plan "${taskId}" not found.`);
  if (record.status.state !== PLAN_STATES.APPROVED) {
    throw new Error(`Plan "${taskId}" is ${record.status.state}; explicit approval is required.`);
  }
  verifyArtifactDigests(record);
  const currentHead = resolveHead(projectRoot, { exec });
  if (currentHead !== record.status.baseHead) throw new Error(`Plan "${taskId}" is stale: repository HEAD changed.`);
  if (!checkWorkingTree) return record;
  if (!record.status.workingTreeFingerprint) {
    throw new Error(`Plan "${taskId}" predates working-tree fingerprints and cannot execute automatically.`);
  }
  const currentFingerprint = resolveWorkingTreeFingerprint(projectRoot, { exec });
  if (currentFingerprint !== record.status.workingTreeFingerprint) {
    throw new Error(`Plan "${taskId}" is stale: working tree changed after approval.`);
  }
  return record;
}

export async function transitionTask(projectRoot, taskId, nextState, { now = new Date(), exec } = {}) {
  if (![PLAN_STATES.APPROVED, PLAN_STATES.REJECTED].includes(nextState)) throw new Error(`Invalid plan decision "${nextState}".`);
  const record = await readTaskRecord(projectRoot, taskId);
  if (!record) throw new Error(`Plan "${taskId}" not found.`);
  if (record.status.state !== PLAN_STATES.AWAITING_APPROVAL) {
    throw new Error(`Plan "${taskId}" is ${record.status.state}; expected awaiting_approval.`);
  }
  verifyArtifactDigests(record);
  const currentHead = resolveHead(projectRoot, { exec });
  if (currentHead !== record.status.baseHead) {
    throw new Error(`Plan "${taskId}" is stale: repository HEAD changed.`);
  }
  const next = {
    ...record.status,
    state: nextState,
    updatedAt: now.toISOString(),
    decisionAt: now.toISOString(),
    decisionHead: currentHead,
    ...(nextState === PLAN_STATES.APPROVED
      ? { workingTreeFingerprint: resolveWorkingTreeFingerprint(projectRoot, { exec }) }
      : {})
  };
  await writeAtomicJson(record.paths.statusPath, next);
  return { ...record, status: next };
}
