import { REVIEW_AGENTS, REVIEW_SCOPE_MODES } from "./review-types.js";
import { ReviewExecError, assertBoundedProcessOk, runBoundedProcess } from "./review-exec.js";
import { validateReviewOutput } from "./review-validate.js";

export const REVIEW_PI_ERROR_CODES = Object.freeze({
  INVALID_JSONL: "invalid_jsonl", MISSING_AGENT_MESSAGE: "missing_agent_message",
  STREAM_ERROR: "stream_error", INVALID_CWD: "invalid_cwd"
});

const EXECUTABLE = "pi";
const READ_ONLY_TOOLS = "read,grep,find,ls";
const CLI_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TERM",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "GOOGLE_API_KEY", "GEMINI_API_KEY",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"
]);

function requireSnapshotCwd(snapshot) {
  const cwd = snapshot?.cwd;
  if (typeof cwd !== "string" || !cwd) {
    throw new ReviewExecError("Pi review requires snapshot.cwd.", {
      code: REVIEW_PI_ERROR_CODES.INVALID_CWD
    });
  }
  return cwd;
}

/** JSON mode, ephemeral, read-only tools, ambient resources + project trust off. */
export function buildPiReviewArgs(snapshot, { model = null } = {}) {
  requireSnapshotCwd(snapshot);
  const args = [
    "--mode", "json", "--no-session",
    "--tools", READ_ONLY_TOOLS,
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
    "--no-approve"
  ];
  if (model) args.push("--model", String(model));
  args.push(buildPiReviewPrompt(snapshot));
  return args;
}

/** Preserve only env needed to start/authenticate the CLI. */
export function buildPiCliEnv(sourceEnv = process.env) {
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
export function buildPiReviewPrompt(snapshot) {
  const files = Array.isArray(snapshot?.files) ? snapshot.files : [];
  return [
    `Bounded review mode=${snapshot?.mode ?? "working-tree"} ${scopeRefLine(snapshot)}.`,
    "Respond JSON only: {\"findings\":[{\"severity\":\"high|medium|low\",\"title\":\"...\",\"path\":\"...\",\"line\":null,\"problem\":\"...\",\"recommendation\":\"...\"}],\"warnings\":[]}.",
    "Cite only snapshot paths:",
    ...(files.length ? files.map((f) => `- ${f.path} (${f.status})`) : ["(none)"])
  ].join("\n");
}

function assistantText(message) {
  if (!Array.isArray(message?.content)) return null;
  const text = message.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  return text.trim() === "" ? null : text;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = Number.isFinite(usage.input) ? usage.input
    : Number.isFinite(usage.inputTokens) ? usage.inputTokens
      : Number.isFinite(usage.input_tokens) ? usage.input_tokens : null;
  const output = Number.isFinite(usage.output) ? usage.output
    : Number.isFinite(usage.outputTokens) ? usage.outputTokens
      : Number.isFinite(usage.output_tokens) ? usage.output_tokens : null;
  const total = Number.isFinite(usage.totalTokens) ? usage.totalTokens
    : Number.isFinite(usage.total) ? usage.total
      : Number.isFinite(usage.total_tokens) ? usage.total_tokens
        : input != null && output != null ? input + output : null;
  const cost = typeof usage.cost === "number" ? usage.cost
    : typeof usage.cost?.total === "number" ? usage.cost.total : null;
  return { inputTokens: input, outputTokens: output, totalTokens: total, cost };
}

/** Parse Pi JSONL: last assistant message_end + turn_end usage. Trailing partial ignored. */
export function parsePiReviewJsonl(stdout) {
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
      throw new ReviewExecError(`Malformed Pi JSONL: ${error.message}`, {
        code: REVIEW_PI_ERROR_CODES.INVALID_JSONL
      });
    }
    if (!event || typeof event !== "object") {
      throw new ReviewExecError("Malformed Pi JSONL event.", {
        code: REVIEW_PI_ERROR_CODES.INVALID_JSONL
      });
    }
    if (event.type === "error") {
      streamError = String(event.message ?? event.errorMessage ?? "Pi stream error.");
    } else if (event.type === "message_end" && event.message?.role === "assistant") {
      const stop = event.message.stopReason;
      if (stop === "error" || stop === "aborted") {
        streamError = String(event.message.errorMessage ?? `Pi stopReason ${stop}.`);
      } else {
        const text = assistantText(event.message);
        if (text != null) agentText = text;
      }
    } else if (event.type === "turn_end") {
      const next = normalizeUsage(event.message?.usage);
      if (next) usage = next;
    }
  }
  if (streamError) throw new ReviewExecError(streamError, { code: REVIEW_PI_ERROR_CODES.STREAM_ERROR });
  if (typeof agentText !== "string" || agentText.trim() === "") {
    throw new ReviewExecError("Pi JSONL missing final assistant message_end.", {
      code: REVIEW_PI_ERROR_CODES.MISSING_AGENT_MESSAGE
    });
  }
  return { agentText, usage };
}

/** Run Pi read-only review bound to snapshot.cwd. No receipts/drift/raw streams. */
export async function runPiReview({
  snapshot, model = null, env = process.env, spawnImpl,
  timeoutMs, terminationGraceMs, killGraceMs, runProcess = runBoundedProcess
} = {}) {
  const cwd = requireSnapshotCwd(snapshot);
  const requestedModel = model == null || model === "" ? null : String(model);
  const result = await runProcess({
    command: EXECUTABLE, args: buildPiReviewArgs(snapshot, { model: requestedModel }), cwd,
    env: buildPiCliEnv(env), spawnImpl, timeoutMs, terminationGraceMs, killGraceMs
  });
  assertBoundedProcessOk(result);
  const parsed = parsePiReviewJsonl(result.stdout);
  const validated = validateReviewOutput(parsed.agentText, snapshot);
  return {
    agentId: REVIEW_AGENTS.PI, model: requestedModel,
    findings: validated.findings, warnings: validated.warnings, usage: parsed.usage
  };
}
