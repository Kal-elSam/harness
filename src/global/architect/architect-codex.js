import {
  ReviewExecError,
  assertBoundedProcessOk,
  runBoundedProcess
} from "../runtime/review/review-exec.js";
import { buildCodexCliEnv } from "../runtime/review/review-codex.js";

export const ARCHITECT_CODEX_ERRORS = Object.freeze({
  INVALID_JSONL: "invalid_jsonl",
  MISSING_PLAN: "missing_plan",
  STREAM_ERROR: "stream_error",
  SUBSCRIPTION_AUTH_REQUIRED: "subscription_auth_required"
});

const AUTH_TIMEOUT_MS = 10_000;
const AUTH_OUTPUT_LIMIT = 8_192;

export function buildArchitectCodexArgs({ cwd, model = null } = {}) {
  if (typeof cwd !== "string" || !cwd) throw new Error("Architect requires cwd.");
  const args = [
    "--ask-for-approval", "never",
    "exec", "--json", "--ephemeral", "--ignore-user-config",
    "--sandbox", "read-only", "-C", cwd,
    "-c", "shell_environment_policy.inherit=none"
  ];
  if (model) args.push("-m", String(model));
  args.push("-");
  return args;
}

export function buildArchitectPrompt(task, { contextPack = null } = {}) {
  return [
    "You are the architecture planner for this repository.",
    "Use the bounded Kairo context pack below as primary evidence.",
    "Do not broadly scan the repository. Inspect additional files only when the context pack identifies a concrete gap required to plan safely.",
    "Honor all AGENTS.md and governance instructions included in the context pack.",
    "Do not modify files, run destructive commands, or implement code.",
    "Return a concise implementation plan in Markdown with: Goal, Verified context, Design, Files, Tests, Risks, and Acceptance criteria.",
    "Challenge unsupported assumptions and identify any blocking unknowns.",
    "",
    "TASK",
    String(task).trim(),
    "",
    "BOUNDED KAIRO CONTEXT PACK",
    contextPack?.systemPrompt ?? "No context pack was available; state this limitation in Verified context."
  ].join("\n");
}

export function buildArchitectCodexEnv(sourceEnv = process.env) {
  const env = buildCodexCliEnv(sourceEnv);
  // M1 is subscription-only. Never let an ambient API key or alternate paid
  // endpoint turn subscription exhaustion into PAYG.
  for (const key of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_BASE"]) delete env[key];
  return env;
}

export async function verifyCodexSubscriptionAuth({
  env = process.env, runProcess = runBoundedProcess
} = {}) {
  const result = await runProcess({
    command: "codex",
    args: ["login", "status"],
    env: buildArchitectCodexEnv(env),
    stdin: null,
    timeoutMs: AUTH_TIMEOUT_MS,
    stdoutLimit: AUTH_OUTPUT_LIMIT,
    stderrLimit: AUTH_OUTPUT_LIMIT
  });
  assertBoundedProcessOk(result);
  const evidence = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!/(?:^|\n)Logged in using ChatGPT\r?(?:\n|$)/.test(evidence)) {
    throw new ReviewExecError(
      "Codex must be logged in using ChatGPT subscription auth; API-key and unknown auth modes are refused.",
      { code: ARCHITECT_CODEX_ERRORS.SUBSCRIPTION_AUTH_REQUIRED }
    );
  }
  return { mode: "chatgpt" };
}

export function parseArchitectCodexJsonl(stdout) {
  let plan = null;
  let usage = null;
  let streamError = null;
  const raw = String(stdout ?? "");
  const lines = raw.split(/\r?\n/);
  const complete = raw.endsWith("\n") || raw.endsWith("\r\n") ? lines : lines.slice(0, -1);
  for (const line of complete) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try { event = JSON.parse(trimmed); }
    catch (error) {
      throw new ReviewExecError(`Malformed Codex JSONL: ${error.message}`, {
        code: ARCHITECT_CODEX_ERRORS.INVALID_JSONL
      });
    }
    if (!event || typeof event !== "object") {
      throw new ReviewExecError("Malformed Codex JSONL event.", {
        code: ARCHITECT_CODEX_ERRORS.INVALID_JSONL
      });
    }
    if (event.type === "error") streamError = String(event.message ?? "Codex stream error.");
    else if (event.type === "turn.failed") streamError = String(event.error?.message ?? "Codex turn failed.");
    else if (event.type === "turn.completed" && event.usage && typeof event.usage === "object") {
      const input = Number.isFinite(event.usage.input_tokens) ? event.usage.input_tokens : null;
      const output = Number.isFinite(event.usage.output_tokens) ? event.usage.output_tokens : null;
      usage = {
        inputTokens: input,
        outputTokens: output,
        totalTokens: input != null && output != null ? input + output : null,
        cost: null
      };
    } else if (event.type === "item.completed" && event.item?.type === "agent_message"
      && typeof event.item.text === "string") {
      plan = event.item.text;
    }
  }
  if (streamError) {
    throw new ReviewExecError(streamError, { code: ARCHITECT_CODEX_ERRORS.STREAM_ERROR });
  }
  if (typeof plan !== "string" || !plan.trim()) {
    throw new ReviewExecError("Codex JSONL missing final architecture plan.", {
      code: ARCHITECT_CODEX_ERRORS.MISSING_PLAN
    });
  }
  return { plan: plan.trim(), usage };
}

export async function runArchitectCodex({
  task, cwd, model = null, contextPack = null, env = process.env, spawnImpl, timeoutMs,
  runProcess = runBoundedProcess, verifyAuth = verifyCodexSubscriptionAuth
} = {}) {
  const codexEnv = buildArchitectCodexEnv(env);
  await verifyAuth({ env: codexEnv });
  const result = await runProcess({
    command: "codex",
    args: buildArchitectCodexArgs({ cwd, model }),
    cwd,
    env: codexEnv,
    stdin: buildArchitectPrompt(task, { contextPack }),
    spawnImpl,
    timeoutMs
  });
  assertBoundedProcessOk(result);
  return parseArchitectCodexJsonl(result.stdout);
}
