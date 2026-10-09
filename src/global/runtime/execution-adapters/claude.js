import { createExecutionAdapter, parseNdjsonLine, buildPermissionsArgs } from "./create-execution-adapter.js";
import { assertReadOnlyExclusive } from "../run-permissions.js";
import {
  isReadOnlyPermissions, verifyClaudeReadOnlySandbox, wrapWithWriteSandbox
} from "../readonly-containment.js";
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
  // In-memory only: the caller hashes it (account-fingerprint.js) before any
  // persistence. null when `claude auth status` exposes no stable identity.
  const parts = ["email", "orgId", "organizationId", "accountUuid", "userId"]
    .map((key) => (typeof status?.[key] === "string" ? status[key].trim() : ""))
    .filter(Boolean);
  return {
    mode: "subscription",
    subscriptionType: status.subscriptionType,
    accountIdentifier: parts.length > 0 ? parts.join("|") : null
  };
}

// Read-only tool surface: no Edit/Write/NotebookEdit/Bash/WebFetch. `--restricted`
// also drops code-running tools and ignores user/project settings files.
const READ_ONLY_TOOLS = "Read,Grep,Glob";
const READ_ONLY_DENIED_TOOLS = "Edit,Write,NotebookEdit,Bash";
// Claude Code rejects `-p --output-format stream-json` without `--verbose`.
const STREAM_ARGS = Object.freeze(["-p", "--output-format", "stream-json", "--verbose"]);

export function buildClaudeLaunch({ task, cwd, model, permissions = [], env = process.env }) {
  if (isReadOnlyPermissions(permissions)) {
    assertReadOnlyExclusive(permissions);
    const readOnlyArgs = [
      ...STREAM_ARGS,
      "--restricted", "--tools", READ_ONLY_TOOLS, "--disallowedTools", READ_ONLY_DENIED_TOOLS,
      "--permission-mode", "dontAsk", "--permission-prompts", "none", task
    ];
    if (model) readOnlyArgs.unshift("--model", model);
    return wrapWithWriteSandbox(
      { command: EXECUTABLE, args: readOnlyArgs, cwd, env: buildClaudeExecutionEnv(env) },
      { cwd }
    );
  }
  const unsafeArgs = buildPermissionsArgs(permissions);
  const permissionArgs = unsafeArgs.length > 0
    ? unsafeArgs
    : ["--permission-mode", "auto", "--permission-prompts", "none"];
  const args = [...STREAM_ARGS, ...permissionArgs, task];
  if (model) args.unshift("--model", model);
  return { command: EXECUTABLE, args, cwd, env: buildClaudeExecutionEnv(env) };
}

function parseClaudeEventLine(line) {
  const parsed = parseNdjsonLine(line);
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.type === "tool_use" || parsed.type === "tool_call") {
    return { type: "tool_call", tool_name: parsed.name ?? parsed.tool ?? "unknown", status: parsed.status ?? "started" };
  }
  // The terminal `result` line carries both the final text and `usage`; it must
  // stay a result event (summary source) rather than collapse into usage.
  if (parsed.type === "result") return parsed;
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

export async function preflightClaude(context = {}) {
  const { verifyAuth = verifyClaudeSubscriptionAuth, verifyReadOnlySandbox = verifyClaudeReadOnlySandbox } = context;
  // Containment first: a read-only run without verified write containment never reaches auth or launch.
  if (isReadOnlyPermissions(context.permissions)) await verifyReadOnlySandbox({ cwd: context.cwd });
  return verifyAuth();
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
  preflight: preflightClaude
});
