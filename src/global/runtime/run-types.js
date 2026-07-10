import { createHash } from "node:crypto";

export const RUN_STATES = {
  PENDING: "pending",
  STARTING: "starting",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  INTERRUPTED: "interrupted"
};

export const STARTING_GRACE_MS = 30_000;

export const RUN_EVENT_TYPES = {
  RUN_STARTED: "run.started",
  RUN_COMPLETED: "run.completed",
  RUN_FAILED: "run.failed",
  RUN_CANCELLED: "run.cancelled",
  STDOUT: "process.stdout",
  STDERR: "process.stderr",
  TOOL_CALL: "agent.tool_call",
  TOOL_RESULT: "agent.tool_result",
  ASSISTANT: "agent.assistant",
  TOKEN_USAGE: "agent.token_usage",
  DIFF_SUMMARY: "agent.diff_summary",
  SYSTEM: "agent.system",
  RESULT: "agent.result",
  TRANSCRIPT: "run.transcript"
};

export const TERMINAL_RUN_STATES = new Set([
  RUN_STATES.COMPLETED,
  RUN_STATES.FAILED,
  RUN_STATES.CANCELLED,
  RUN_STATES.INTERRUPTED
]);

export const ACTIVE_RUN_STATES = new Set([
  RUN_STATES.PENDING,
  RUN_STATES.STARTING,
  RUN_STATES.RUNNING
]);

export function isTerminalRunState(state) {
  return TERMINAL_RUN_STATES.has(state);
}

export function isActiveRunState(state) {
  return state === RUN_STATES.PENDING
    || state === RUN_STATES.STARTING
    || state === RUN_STATES.RUNNING;
}

export function createRunId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `run_${timestamp}_${random}`;
}

export function createTaskFingerprint(task) {
  const normalized = String(task ?? "").replace(/\s+/g, " ").trim();
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return {
    taskDigest: digest,
    taskLength: normalized.length
  };
}

export function formatTaskLabel(metadata) {
  const digest = metadata?.taskDigest ?? "unknown";
  const length = metadata?.taskLength ?? 0;
  return `task:${digest} (${length} chars, content not stored)`;
}

export function createRunMetadata({
  runId,
  agentId,
  provider,
  model = null,
  task,
  cwd,
  permissions = [],
  captureTranscript = false,
  cliVersion,
  profileSources = null
}) {
  const { taskDigest, taskLength } = createTaskFingerprint(task);
  const now = new Date().toISOString();

  return {
    runId,
    agentId,
    provider,
    model,
    taskDigest,
    taskLength,
    cwd,
    permissions,
    captureTranscript,
    cliVersion,
    profileSources,
    state: RUN_STATES.PENDING,
    pid: null,
    supervisorPid: null,
    exitCode: null,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    tools: [],
    commands: [],
    tokenUsage: null,
    cost: null,
    diffSummary: null,
    error: null
  };
}
