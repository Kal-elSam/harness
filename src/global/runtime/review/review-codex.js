import { REVIEW_AGENTS, REVIEW_SCOPE_MODES } from "./review-types.js";
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

function requireSnapshotCwd(snapshot) {
  const cwd = snapshot?.cwd;
  if (typeof cwd !== "string" || !cwd) {
    throw new ReviewExecError("Codex review requires snapshot.cwd.", {
      code: REVIEW_CODEX_ERROR_CODES.INVALID_CWD
    });
  }
  return cwd;
}

/** Global approval before `exec`; read-only/ephemeral after; prompt via `-`. */
export function buildCodexReviewArgs(snapshot, { model = null } = {}) {
  const cwd = requireSnapshotCwd(snapshot);
  const args = [
    "--ask-for-approval", "never",
    "exec", "--json", "--ephemeral", "--ignore-user-config",
    "--sandbox", "read-only", "-C", cwd, "-c", ENV_INHERIT_NONE
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

function scopeRefLine(snapshot) {
  if (snapshot?.mode === REVIEW_SCOPE_MODES.BASE) return `base=${snapshot.base ?? ""}`;
  if (snapshot?.mode === REVIEW_SCOPE_MODES.COMMIT) return `commit=${snapshot.commit ?? ""}`;
  return "ref=working-tree";
}

/** Prompt is mode + exact scope ref + snapshot paths — no diffs/transcripts. */
export function buildCodexReviewPrompt(snapshot) {
  const files = Array.isArray(snapshot?.files) ? snapshot.files : [];
  return [
    `Bounded review mode=${snapshot?.mode ?? "working-tree"} ${scopeRefLine(snapshot)}.`,
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
    if (event.type === "error") streamError = String(event.message ?? "Codex stream error.");
    else if (event.type === "turn.failed") streamError = String(event.error?.message ?? "Codex turn failed.");
    else if (event.type === "turn.completed" && event.usage && typeof event.usage === "object") {
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
  if (streamError) throw new ReviewExecError(streamError, { code: REVIEW_CODEX_ERROR_CODES.STREAM_ERROR });
  if (typeof agentText !== "string" || agentText.trim() === "") {
    throw new ReviewExecError("Codex JSONL missing final agent_message.", {
      code: REVIEW_CODEX_ERROR_CODES.MISSING_AGENT_MESSAGE
    });
  }
  return { agentText, usage };
}

/** Run Codex read-only review bound to snapshot.cwd. No receipts/drift/raw streams. */
export async function runCodexReview({
  snapshot, model = null, env = process.env, spawnImpl,
  timeoutMs, terminationGraceMs, killGraceMs, runProcess = runBoundedProcess
} = {}) {
  const cwd = requireSnapshotCwd(snapshot);
  const requestedModel = model == null || model === "" ? null : String(model);
  const result = await runProcess({
    command: EXECUTABLE, args: buildCodexReviewArgs(snapshot, { model: requestedModel }), cwd,
    env: buildCodexCliEnv(env), stdin: buildCodexReviewPrompt(snapshot), spawnImpl,
    timeoutMs, terminationGraceMs, killGraceMs
  });
  assertBoundedProcessOk(result);
  const parsed = parseCodexReviewJsonl(result.stdout);
  const validated = validateReviewOutput(parsed.agentText, snapshot);
  return {
    agentId: REVIEW_AGENTS.CODEX, model: requestedModel,
    findings: validated.findings, warnings: validated.warnings, usage: parsed.usage
  };
}
