import { REVIEW_AGENTS } from "./review-types.js";
import { ReviewExecError, assertBoundedProcessOk, runBoundedProcess } from "./review-exec.js";
import { validateReviewOutput } from "./review-validate.js";

export const REVIEW_CODEX_ERROR_CODES = Object.freeze({
  INVALID_JSONL: "invalid_jsonl", MISSING_AGENT_MESSAGE: "missing_agent_message",
  STREAM_ERROR: "stream_error", INVALID_CWD: "invalid_cwd"
});

const EXECUTABLE = "codex";
const ENV_INHERIT_NONE = "shell_environment_policy.inherit=none";
const CLI_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TERM",
  "CODEX_HOME", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_BASE",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"
]);

/** Exact read-only argv: ephemeral, no user config, no bypass; prompt via `-`. */
export function buildCodexReviewArgs({ cwd, model = null } = {}) {
  if (typeof cwd !== "string" || !cwd) {
    throw new ReviewExecError("Codex review requires an explicit cwd.", {
      code: REVIEW_CODEX_ERROR_CODES.INVALID_CWD
    });
  }
  const args = [
    "exec", "--json", "--ephemeral", "--ignore-user-config",
    "--sandbox", "read-only", "--ask-for-approval", "never",
    "-C", cwd, "-c", ENV_INHERIT_NONE
  ];
  if (model) args.push("-m", String(model));
  args.push("-");
  return args;
}

/** Preserve only env needed to start/authenticate the CLI. */
export function buildCodexCliEnv(sourceEnv = process.env) {
  const env = Object.create(null);
  for (const key of CLI_ENV_KEYS) {
    if (sourceEnv[key] != null && sourceEnv[key] !== "") env[key] = sourceEnv[key];
  }
  return env;
}

/** Prompt is mode + snapshot paths only — no diffs/transcripts. */
export function buildCodexReviewPrompt(snapshot) {
  const files = Array.isArray(snapshot?.files) ? snapshot.files : [];
  return [
    `Bounded review mode=${snapshot?.mode ?? "working-tree"}.`,
    "Respond JSON only: {\"findings\":[{\"severity\":\"high|medium|low\",\"title\":\"...\",\"path\":\"...\",\"line\":null,\"problem\":\"...\",\"recommendation\":\"...\"}],\"warnings\":[]}.",
    "Cite only snapshot paths:",
    ...(files.length ? files.map((f) => `- ${f.path} (${f.status})`) : ["(none)"])
  ].join("\n");
}

/** Parse Codex JSONL: last agent_message + usage. Trailing partial line ignored. */
export function parseCodexReviewJsonl(stdout) {
  let agentText = null;
  let usage = null;
  let streamError = null;
  const raw = String(stdout ?? "");
  const parts = raw.split(/\r?\n/);
  const complete = raw.endsWith("\n") || raw.endsWith("\r\n") ? parts : parts.slice(0, -1);
  for (const line of complete) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try { event = JSON.parse(trimmed); }
    catch (error) {
      throw new ReviewExecError(`Malformed Codex JSONL: ${error.message}`, {
        code: REVIEW_CODEX_ERROR_CODES.INVALID_JSONL
      });
    }
    if (!event || typeof event !== "object") {
      throw new ReviewExecError("Malformed Codex JSONL event.", {
        code: REVIEW_CODEX_ERROR_CODES.INVALID_JSONL
      });
    }
    if (event.type === "error") {
      streamError = String(event.message ?? "Codex stream error.");
    } else if (event.type === "turn.failed") {
      streamError = String(event.error?.message ?? "Codex turn failed.");
    } else if (event.type === "turn.completed" && event.usage && typeof event.usage === "object") {
      const input = Number.isFinite(event.usage.input_tokens) ? event.usage.input_tokens : null;
      const output = Number.isFinite(event.usage.output_tokens) ? event.usage.output_tokens : null;
      usage = {
        inputTokens: input, outputTokens: output,
        totalTokens: input != null && output != null ? input + output : null, cost: null
      };
    } else if (event.type === "item.completed" && event.item?.type === "agent_message"
      && typeof event.item.text === "string") {
      agentText = event.item.text;
    }
  }
  if (streamError) {
    throw new ReviewExecError(streamError, { code: REVIEW_CODEX_ERROR_CODES.STREAM_ERROR });
  }
  if (typeof agentText !== "string" || agentText.trim() === "") {
    throw new ReviewExecError("Codex JSONL missing final agent_message.", {
      code: REVIEW_CODEX_ERROR_CODES.MISSING_AGENT_MESSAGE
    });
  }
  return { agentText, usage };
}

/** Run Codex read-only review. No receipts/drift; never returns prompt/JSONL/streams. */
export async function runCodexReview({
  snapshot, cwd, model = null, env = process.env, spawnImpl,
  timeoutMs, terminationGraceMs, killGraceMs, runProcess = runBoundedProcess
} = {}) {
  const result = await runProcess({
    command: EXECUTABLE, args: buildCodexReviewArgs({ cwd, model }), cwd,
    env: buildCodexCliEnv(env), stdin: buildCodexReviewPrompt(snapshot), spawnImpl,
    timeoutMs, terminationGraceMs, killGraceMs
  });
  assertBoundedProcessOk(result);
  const parsed = parseCodexReviewJsonl(result.stdout);
  const validated = validateReviewOutput(parsed.agentText, snapshot);
  return {
    agentId: REVIEW_AGENTS.CODEX,
    model: validated.model ?? (model ? String(model) : null),
    findings: validated.findings, warnings: validated.warnings,
    usage: validated.usage ?? parsed.usage
  };
}
