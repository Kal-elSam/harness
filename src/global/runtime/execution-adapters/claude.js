import { createExecutionAdapter, parseNdjsonLine, buildPermissionsArgs } from "./create-execution-adapter.js";
import {
  ReviewExecError, assertBoundedProcessOk, runBoundedProcess
} from "../review/review-exec.js";

const EXECUTABLE = "claude";
const AUTH_TIMEOUT_MS = 10_000;
const AUTH_OUTPUT_LIMIT = 16_384;
const SAFE_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
  "TMPDIR", "TERM", "CLAUDE_CONFIG_DIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS"
]);
const SUBSCRIPTION_TYPE = /^(?:pro|max|team|enterprise)(?:[-_ ].*)?$/i;

export const CLAUDE_AUTH_ERRORS = Object.freeze({
  SUBSCRIPTION_REQUIRED: "claude_subscription_required",
  INVALID_STATUS: "claude_auth_status_invalid"
});

export function buildClaudeExecutionEnv(sourceEnv = process.env) {
  const env = Object.create(null);
  for (const key of SAFE_ENV_KEYS) {
    if (sourceEnv[key] != null && sourceEnv[key] !== "") env[key] = sourceEnv[key];
  }
  return env;
}

export async function verifyClaudeSubscriptionAuth({
  env = process.env, runProcess = runBoundedProcess
} = {}) {
  const result = await runProcess({
    command: EXECUTABLE,
    args: ["auth", "status"],
    env: buildClaudeExecutionEnv(env),
    stdin: null,
    timeoutMs: AUTH_TIMEOUT_MS,
    stdoutLimit: AUTH_OUTPUT_LIMIT,
    stderrLimit: AUTH_OUTPUT_LIMIT
  });
  assertBoundedProcessOk(result);
  let status;
  try { status = JSON.parse(String(result.stdout ?? "").trim()); }
  catch {
    throw new ReviewExecError("Claude auth status did not return valid JSON.", {
      code: CLAUDE_AUTH_ERRORS.INVALID_STATUS
    });
  }
  if (status?.loggedIn !== true || status?.authMethod !== "claude.ai"
    || status?.apiProvider !== "firstParty" || !SUBSCRIPTION_TYPE.test(status?.subscriptionType ?? "")) {
    throw new ReviewExecError(
      "Claude execution requires a first-party claude.ai Pro, Max, Team, or Enterprise subscription.",
      { code: CLAUDE_AUTH_ERRORS.SUBSCRIPTION_REQUIRED }
    );
  }
  return { mode: "subscription", subscriptionType: status.subscriptionType };
}

export function buildClaudeLaunch({ task, cwd, model, permissions = [], env = process.env }) {
  const unsafeArgs = buildPermissionsArgs(permissions);
  const permissionArgs = unsafeArgs.length > 0
    ? unsafeArgs
    : ["--permission-mode", "auto", "--permission-prompts", "none"];
  const args = ["-p", "--output-format", "stream-json", ...permissionArgs, task];
  if (model) args.unshift("--model", model);
  return { command: EXECUTABLE, args, cwd, env: buildClaudeExecutionEnv(env) };
}

function parseClaudeEventLine(line) {
  const parsed = parseNdjsonLine(line);
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.type === "tool_use" || parsed.type === "tool_call") {
    return { type: "tool_call", tool_name: parsed.name ?? parsed.tool ?? "unknown", status: parsed.status ?? "started" };
  }
  if (parsed.type === "usage" || parsed.usage) {
    const usage = parsed.usage ?? parsed;
    return {
      type: "usage",
      inputTokens: usage.input_tokens ?? usage.input ?? null,
      outputTokens: usage.output_tokens ?? usage.output ?? null,
      totalTokens: usage.total_tokens ?? usage.total ?? null,
      cost: usage.cost ?? null
    };
  }
  return parsed;
}

export default createExecutionAdapter({
  id: "claude",
  label: "Claude Code",
  executable: EXECUTABLE,
  capabilities: {
    structuredEvents: true, tokens: true, diff: false, cancel: true, transcript: true,
    permissionModes: ["safe", "force", "yolo"]
  },
  buildLaunch: buildClaudeLaunch,
  parseEventLine: parseClaudeEventLine,
  preflight: verifyClaudeSubscriptionAuth
});
