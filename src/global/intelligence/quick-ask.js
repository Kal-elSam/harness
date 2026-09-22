import { spawn as defaultSpawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeExecutionEnv } from "../runtime/execution-adapters/claude.js";
import { ensureKairoAskAgent, KAIRO_ASK_AGENT_NAME } from "./opencode-ask-agent.js";
import { toRuntimeModelRef } from "./transport-registry.js";

// A real, read-only question -> answer call — no task, no plan, no
// approval gate. This spends real provider usage (unlike the zero-cost
// /usage local_command probes), which is expected: answering a real
// question is real work. Fail-closed: any spawn/parse error yields
// `status: "error"`, never a fabricated answer.
const DEFAULT_TIMEOUT_MS = 30_000;

// The child process never inherits Kairo's own real environment
// unscrubbed — `cwd` alone (even a sanitized snapshot dir) says nothing
// about what env vars a spawned process can read, and Kairo's own
// process env can carry real secrets (provider API keys, tokens) that
// have nothing to do with the question being asked. Mirrors
// execution-adapters/claude.js's own SAFE_ENV_KEYS precedent — reused
// directly for Claude; Codex gets an analogous, separately-scoped list
// (CODEX_HOME instead of CLAUDE_CONFIG_DIR) rather than a shared
// abstraction neither adapter asked for.
const CODEX_SAFE_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
  "TMPDIR", "TERM", "CODEX_HOME", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS"
]);
function buildCodexExecutionEnv(sourceEnv = process.env) {
  const env = Object.create(null);
  for (const key of CODEX_SAFE_ENV_KEYS) {
    if (sourceEnv[key] != null && sourceEnv[key] !== "") env[key] = sourceEnv[key];
  }
  return env;
}

// Same real scrubbing principle as Codex/Claude above — CURSOR_API_KEY/
// CURSOR_API_ENDPOINT are cursor-agent's own documented real auth env
// vars (verified via `cursor-agent -p --help`), never a guess.
const CURSOR_SAFE_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
  "TMPDIR", "TERM", "CURSOR_API_KEY", "CURSOR_API_ENDPOINT", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS"
]);
function buildCursorExecutionEnv(sourceEnv = process.env) {
  const env = Object.create(null);
  for (const key of CURSOR_SAFE_ENV_KEYS) {
    if (sourceEnv[key] != null && sourceEnv[key] !== "") env[key] = sourceEnv[key];
  }
  return env;
}

function unknown(error) {
  return { status: "error", answer: null, error: String(error) };
}

/**
 * Resets on every real stdout/stderr chunk from the child, never an
 * absolute deadline from process start — the same real distinction
 * execution-adapters/opencode.js's own idle timeout draws: a real, live
 * answer that's just taking a while (a heavier reasoning model, a cold
 * sandbox start) must never be killed for merely being slow, only a
 * process that's produced nothing at all for `timeoutMs` really looks
 * hung. A single-shot ask call, so this stays local rather than reusing
 * run-supervisor.js's own detached-run mechanism.
 * @param {import("node:child_process").ChildProcess} child
 * @param {number} timeoutMs
 * @param {() => void} onIdle
 * @returns {() => void} call to clear the timer once the call finishes
 */
function armIdleTimeout(child, timeoutMs, onIdle) {
  let handle = null;
  const reset = () => {
    if (handle) clearTimeout(handle);
    handle = setTimeout(onIdle, timeoutMs);
  };
  child.stdout?.on("data", reset);
  child.stderr?.on("data", reset);
  reset();
  return () => { if (handle) clearTimeout(handle); };
}

/** @param {{question:string, model:string|null, cwd:string, spawn:Function, timeoutMs:number, env:object}} args */
function askClaude({ question, model, cwd, spawn, timeoutMs, env }) {
  // --restricted: removes Bash/code-execution tools and WebFetch, ignores
  // project/user settings, and confines the remaining file tools to cwd
  // — the closest real equivalent to Codex's --sandbox read-only, since
  // plain -p alone enforces no tool restriction at all.
  // --strict-mcp-config: skip MCP servers too, so --restricted's own
  // isolation isn't reopened by a configured MCP server with broader access.
  const args = ["-p", question, "--output-format", "json", "--restricted", "--strict-mcp-config"];
  if (model) args.push("--model", model);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve(unknown(error?.message ?? error));
      return;
    }
    let stdout = "";
    let finished = false;
    const clearIdleTimer = armIdleTimeout(child, timeoutMs, () => finish(unknown(`claude -p idle-timed out after ${timeoutMs}ms with no output`)));
    function finish(result) {
      if (finished) return;
      finished = true;
      clearIdleTimer();
      try { child.kill?.(); } catch { /* best effort */ }
      resolve(result);
    }
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
    child.once?.("close", () => {
      let parsed;
      try { parsed = JSON.parse(stdout); } catch { return finish(unknown("malformed JSON from claude -p")); }
      if (typeof parsed?.result !== "string") return finish(unknown("no result text in claude -p response"));
      finish({ status: "answered", answer: parsed.result, error: null });
    });
  });
}

/**
 * cursor-agent's own real, documented read-only mode (verified via
 * `cursor-agent -p --help`): "ask: Q&A style for explanations and
 * questions (read-only)" — never combined with --force/--yolo, which
 * would grant real write/shell access. A real invalid-model failure
 * (verified live) exits non-zero with a plain-text error on stderr, no
 * JSON at all — unlike Claude's/Codex's own failure shapes, so a failed
 * JSON parse here reports the real stderr text, never a generic guess.
 * @param {{question:string, model:string|null, cwd:string, spawn:Function, timeoutMs:number, env:object}} args
 */
function askCursor({ question, model, cwd, spawn, timeoutMs, env }) {
  const args = ["-p", question, "--mode", "ask", "--output-format", "json"];
  if (model) args.push("--model", model);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("cursor-agent", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve(unknown(error?.message ?? error));
      return;
    }
    let stdout = "";
    let stderr = "";
    let finished = false;
    const clearIdleTimer = armIdleTimeout(child, timeoutMs, () => finish(unknown(`cursor-agent idle-timed out after ${timeoutMs}ms with no output`)));
    function finish(result) {
      if (finished) return;
      finished = true;
      clearIdleTimer();
      try { child.kill?.(); } catch { /* best effort */ }
      resolve(result);
    }
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
    child.once?.("close", (code) => {
      let parsed;
      try { parsed = JSON.parse(stdout); } catch {
        return finish(unknown(stderr.trim() || `cursor-agent exited ${code} with no parseable output`));
      }
      if (parsed?.is_error === true || typeof parsed?.result !== "string") {
        return finish(unknown(parsed?.result ?? stderr.trim() ?? "cursor-agent returned no answer"));
      }
      finish({ status: "answered", answer: parsed.result, error: null });
    });
  });
}

// Same real scrubbing principle as the others — OPENCODE_API_KEY is
// opencode's own documented real auth env var (types.js's
// OPENCODE_API_KEY_ENV).
const OPENCODE_SAFE_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
  "TMPDIR", "TERM", "OPENCODE_API_KEY", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS"
]);
function buildOpencodeExecutionEnv(sourceEnv = process.env) {
  const env = Object.create(null);
  for (const key of OPENCODE_SAFE_ENV_KEYS) {
    if (sourceEnv[key] != null && sourceEnv[key] !== "") env[key] = sourceEnv[key];
  }
  return env;
}

/**
 * OpenCode's real CLI has no flag-driven read-only mode (verified via
 * `opencode run --help`) — its permission model lives only in
 * opencode.json, so this always runs against Kairo's own real, verified
 * read-only agent (see opencode-ask-agent.js's own doc — live-verified
 * both that it genuinely blocks a real write attempt and that
 * `--agent`/`--model` compose correctly), ensured to exist in the user's
 * global config before every call (cheap idempotent check — no real
 * write unless actually missing or drifted).
 *
 * Verified live (`opencode run --agent kairo-ask --format json`): the
 * real NDJSON stream emits `type: "text"` events carrying the real
 * answer in `part.text` (possibly across multiple steps — accumulated in
 * order) and a real `type: "error"` event on failure, both handled
 * per-line as chunks arrive, mirroring the same idle-reset principle as
 * every other ask call here.
 * @param {{question:string, model:string|null, cwd:string, spawn:Function, timeoutMs:number, env:object}} args
 */
async function askOpencode({ question, model, cwd, spawn, timeoutMs, env, ensureAgent = ensureKairoAskAgent }) {
  try {
    await ensureAgent();
  } catch (error) {
    return unknown(`could not ensure Kairo's read-only OpenCode agent: ${error?.message ?? error}`);
  }
  const args = ["run", "--agent", KAIRO_ASK_AGENT_NAME, "--format", "json"];
  if (model) args.push("--model", model);
  args.push(question);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("opencode", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve(unknown(error?.message ?? error));
      return;
    }
    let buffer = "";
    const answerParts = [];
    let realError = null;
    let stderr = "";
    let finished = false;
    const clearIdleTimer = armIdleTimeout(child, timeoutMs, () => finish(unknown(`opencode run idle-timed out after ${timeoutMs}ms with no output`)));
    function finish(result) {
      if (finished) return;
      finished = true;
      clearIdleTimer();
      try { child.kill?.(); } catch { /* best effort */ }
      resolve(result);
    }
    function handleLine(line) {
      let parsed;
      try { parsed = JSON.parse(line); } catch { return; }
      if (parsed?.type === "text" && typeof parsed?.part?.text === "string") {
        answerParts.push(parsed.part.text);
      } else if (parsed?.type === "error") {
        realError = parsed.error?.data?.message ?? parsed.error?.name ?? "opencode run returned a real error event";
      }
    }
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) handleLine(line.trim());
    });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
    child.once?.("close", (code) => {
      if (buffer.trim()) handleLine(buffer.trim());
      if (realError) return finish(unknown(realError));
      const answer = answerParts.join("").trim();
      if (!answer) return finish(unknown(stderr.trim() || `opencode run exited ${code} with no real text output`));
      finish({ status: "answered", answer, error: null });
    });
  });
}

/** @param {{question:string, model:string|null, cwd:string, spawn:Function, timeoutMs:number, env:object}} args */
async function askCodex({ question, model, cwd, spawn, timeoutMs, env }) {
  let outDir;
  try {
    outDir = await mkdtemp(join(tmpdir(), "kairo-ask-codex-"));
  } catch (error) {
    return unknown(error?.message ?? error);
  }
  const outFile = join(outDir, "answer.txt");
  // read-only sandbox has nothing to approve, so --approve-for-me would
  // conflict with --sandbox (the real CLI rejects combining them).
  // --skip-git-repo-check: `cwd` is sometimes a sanitized snapshot
  // directory (see conversation/sanitized-snapshot.js), which is
  // deliberately not a real git repo (it excludes .git entirely) —
  // without this, codex exec would refuse to run there at all. Harmless
  // when cwd genuinely is a real git repo (the plain ASK-mode case).
  const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-o", outFile];
  if (model) args.unshift("--model", model);
  args.push(question);

  try {
    return await new Promise((resolve) => {
      let child;
      try {
        child = spawn("codex", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        resolve(unknown(error?.message ?? error));
        return;
      }
      let finished = false;
      // Real codex stderr — captured so a missing output file (below)
      // reports WHY codex actually failed (rate limit, auth, a real model
      // error), never just the raw filesystem ENOENT for a file that's
      // missing BECAUSE codex failed, not the other way around.
      let stderr = "";
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      const clearIdleTimer = armIdleTimeout(child, timeoutMs, () => finish(unknown(`codex exec idle-timed out after ${timeoutMs}ms with no output`)));
      function finish(result) {
        if (finished) return;
        finished = true;
        clearIdleTimer();
        try { child.kill?.(); } catch { /* best effort */ }
        resolve(result);
      }
      child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
      child.once?.("close", async (code) => {
        try {
          const text = (await readFile(outFile, "utf8")).trim();
          if (!text) return finish(unknown(stderr.trim() || "codex exec produced no final message"));
          finish({ status: "answered", answer: text, error: null });
        } catch {
          finish(unknown(stderr.trim() || `codex exec exited ${code} without writing its output file`));
        }
      });
    });
  } finally {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Asks the given provider a real, read-only question and returns its real
 * answer text — every real automatic PROJECT TEAM adapter today (Codex,
 * Claude, Cursor, OpenCode Go, OpenCode Zen); any other provider yields
 * an honest "unsupported" result rather than a guess. OpenCode's real CLI
 * has no flag-driven read-only mode (verified via `opencode run --help`:
 * `--auto` only ever loosens permissions further, never restricts them),
 * so it always runs against Kairo's own real, verified read-only agent
 * instead (see opencode-ask-agent.js) — a project/user-config-independent
 * guarantee, never relying on whatever the local opencode.json happens to
 * already allow.
 * @param {object} args
 * @param {"codex"|"claude"|"cursor"|"opencode-go"|"opencode-zen"} args.provider
 * @param {string} args.question
 * @param {string|null} [args.model]
 * @param {string} args.cwd
 */
export async function askProvider({
  provider, question, model = null, cwd, spawn = defaultSpawn, timeoutMs = DEFAULT_TIMEOUT_MS, sourceEnv = process.env,
  ensureOpencodeAskAgent = ensureKairoAskAgent
}) {
  if (provider === "claude") return askClaude({ question, model, cwd, spawn, timeoutMs, env: buildClaudeExecutionEnv(sourceEnv) });
  if (provider === "codex") return askCodex({ question, model, cwd, spawn, timeoutMs, env: buildCodexExecutionEnv(sourceEnv) });
  if (provider === "cursor") return askCursor({ question, model, cwd, spawn, timeoutMs, env: buildCursorExecutionEnv(sourceEnv) });
  if (provider === "opencode-go" || provider === "opencode-zen") {
    // The real catalog stores bare model ids (see opencode-models.js's
    // normalizeModel) — the CLI needs the real, fully-qualified
    // "opencode-go/<id>" (or "opencode/<id>" for Zen) ref to
    // deterministically route to the intended product, exactly like
    // service.js's executePlan already does for real task execution.
    const runtimeModel = model ? toRuntimeModelRef(provider === "opencode-go" ? "go" : "zen", model) : null;
    return askOpencode({
      question, model: runtimeModel, cwd, spawn, timeoutMs, env: buildOpencodeExecutionEnv(sourceEnv),
      ensureAgent: ensureOpencodeAskAgent
    });
  }
  return { status: "unsupported", answer: null, error: `ASK is not supported for provider "${provider}" yet.` };
}
