import { spawn as defaultSpawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeExecutionEnv } from "../runtime/execution-adapters/claude.js";
import { buildKairoAskConfigContent, KAIRO_ASK_AGENT_NAME, KAIRO_ASK_CONFIG_ENV } from "./opencode-ask-agent.js";
import { toRuntimeModelRef } from "./transport-registry.js";
import { killProcessTree } from "./process-tree.js";

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

const DEFAULT_KILL_GRACE_MS = 2000;
const cancelled = () => ({ status: "cancelled", answer: null, error: null });

/**
 * Spawn options. `detached` (own process group, so the whole tree can be
 * signalled) is added ONLY when a signal is provided: with no signal the
 * options stay byte-identical to the historical ones.
 */
function spawnOptions(cwd, env, signal) {
  const options = { cwd, env, stdio: ["ignore", "pipe", "pipe"] };
  if (signal) options.detached = true;
  return options;
}

/** Newline-delimited splitter tolerant of fragmented chunks and a trailing partial line. */
function createLineSplitter(onLine) {
  let buffer = "";
  return {
    push(chunk) {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(line.trim());
    },
    flush() {
      const rest = buffer.trim();
      buffer = "";
      if (rest) onLine(rest);
    }
  };
}

/**
 * One run's lifecycle: idempotent finish, idle timeout, abort handling with
 * process-tree TERM -> KILL escalation, and guarded event emission.
 * A cancelled run resolves `cancelled` only after the child closed (or after
 * the KILL escalation), and never resolves as answered afterwards.
 * @param {{child:object, resolve:Function, timeoutMs:number, idleMessage:string, control:object}} args
 */
function createRun({ child, resolve, timeoutMs, idleMessage, control }) {
  const { signal, onEvent, killGraceMs = DEFAULT_KILL_GRACE_MS, killProcess } = control;
  let finished = false;
  let closed = false;
  let cancelling = false;
  let graceTimer = null;
  const clearIdle = armIdleTimeout(child, timeoutMs, () => finish(unknown(idleMessage)));

  function finish(result) {
    if (finished) return;
    finished = true;
    clearIdle();
    if (graceTimer) clearTimeout(graceTimer);
    signal?.removeEventListener?.("abort", onAbort);
    if (!signal) {
      try { child.kill?.(); } catch { /* best effort */ }
    } else if (!closed && !cancelling) {
      killProcessTree(child, "SIGTERM", killProcess);
    }
    resolve(result);
  }
  function onAbort() {
    if (finished || cancelling) return;
    cancelling = true;
    clearIdle();
    if (closed) return finish(cancelled());
    killProcessTree(child, "SIGTERM", killProcess);
    graceTimer = setTimeout(() => {
      killProcessTree(child, "SIGKILL", killProcess);
      finish(cancelled());
    }, killGraceMs);
  }
  // Registered before the adapter's own close/error handlers so a cancel wins.
  child.once?.("close", () => {
    closed = true;
    if (cancelling) finish(cancelled());
  });
  child.once?.("error", () => {
    if (!cancelling) return;
    closed = true;
    finish(cancelled());
  });
  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  }
  return {
    finish,
    get cancelling() { return cancelling; },
    /** Never throws; silent once the run finished or is being cancelled. */
    emit(event) {
      if (!onEvent || finished || cancelling) return;
      try {
        const out = onEvent(event);
        if (out && typeof out.then === "function") out.then(undefined, () => {});
      } catch { /* a broken listener must never break the run */ }
    }
  };
}

// ---------------------------------------------------------------------------
// Codex `exec --json` event mapping — THE ONE PLACE to adjust.
//
// UNVERIFIED: the field names below follow Codex's documented JSONL event
// schema as best known, but were NOT checked against the real CLI (no
// provider is invoked during development). Confirm against
// `codex exec --help` / a real `--json` run before the real validation.
// Unknown event shapes are ignored, never guessed.
//
//   item.started   item.type in TOOL_ITEM_TYPES     -> {kind:"tool_start", id, name}
//   item.completed item.type in TOOL_ITEM_TYPES     -> {kind:"tool_end", id, name, ok}
//                    ok = status !== "failed" && (exit_code == null || exit_code === 0)
//   item.completed item.type "reasoning"            -> {kind:"progress", id, summary: item.text}
//   item.completed item.type "error"                -> {kind:"error", message: item.message}
//   turn.failed                                     -> {kind:"error", message: error.message}
//   error                                           -> {kind:"error", message}
//   item.completed agent_message / turn.* / thread.* -> ignored (the FINAL
//                    answer always comes from the -o file, emitted once as "final")
//   name: command | "server.tool" | query | item type; trimmed to 200 chars.
// ---------------------------------------------------------------------------
const CODEX_TOOL_ITEM_TYPES = new Set(["command_execution", "mcp_tool_call", "web_search", "file_change"]);
const EVENT_TEXT_MAX = 200;
const clip = (value) => String(value).slice(0, EVENT_TEXT_MAX);

function codexItemName(item) {
  if (typeof item.command === "string" && item.command) return clip(item.command);
  if (typeof item.tool === "string" && item.tool) return clip(item.server ? `${item.server}.${item.tool}` : item.tool);
  if (typeof item.query === "string" && item.query) return clip(item.query);
  return clip(item.type);
}

/** @returns {object|null} a provider event, or null for unknown/ignored shapes */
function mapCodexEvent(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const item = parsed.item && typeof parsed.item === "object" ? parsed.item : null;
  switch (parsed.type) {
    case "item.started":
      if (item && CODEX_TOOL_ITEM_TYPES.has(item.type) && item.id != null) {
        return { kind: "tool_start", id: String(item.id), name: codexItemName(item) };
      }
      return null;
    case "item.completed":
      if (!item) return null;
      if (CODEX_TOOL_ITEM_TYPES.has(item.type) && item.id != null) {
        const ok = item.status !== "failed" && (item.exit_code == null || item.exit_code === 0);
        return { kind: "tool_end", id: String(item.id), name: codexItemName(item), ok };
      }
      if (item.type === "reasoning" && typeof item.text === "string" && item.text) {
        return { kind: "progress", id: item.id != null ? String(item.id) : null, summary: clip(item.text) };
      }
      if (item.type === "error" && typeof item.message === "string") return { kind: "error", message: clip(item.message) };
      return null;
    case "turn.failed":
      return typeof parsed.error?.message === "string" ? { kind: "error", message: clip(parsed.error.message) } : null;
    case "error":
      return typeof parsed.message === "string" ? { kind: "error", message: clip(parsed.message) } : null;
    default:
      return null;
  }
}

/** @param {{question:string, model:string|null, cwd:string, spawn:Function, timeoutMs:number, env:object}} args */
function askClaude({ question, model, cwd, spawn, timeoutMs, env, control }) {
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
      child = spawn("claude", args, spawnOptions(cwd, env, control.signal));
    } catch (error) {
      resolve(unknown(error?.message ?? error));
      return;
    }
    let stdout = "";
    const run = createRun({ child, resolve, timeoutMs, idleMessage: `claude -p idle-timed out after ${timeoutMs}ms with no output`, control });
    const finish = run.finish;
    // Final JSON only (no incremental output): a start marker, then the result.
    run.emit({ kind: "progress", summary: "claude -p started" });
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
    child.once?.("close", () => {
      let parsed;
      try { parsed = JSON.parse(stdout); } catch { return finish(unknown("malformed JSON from claude -p")); }
      // `claude -p --output-format json` reports failures as a normal result
      // object with is_error true and the error text in `result`.
      if (parsed?.is_error === true) return finish(unknown(typeof parsed.result === "string" ? parsed.result : "claude -p reported an error"));
      if (typeof parsed?.result !== "string") return finish(unknown("no result text in claude -p response"));
      run.emit({ kind: "final", text: parsed.result });
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
function askCursor({ question, model, cwd, spawn, timeoutMs, env, control }) {
  const args = ["-p", question, "--mode", "ask", "--output-format", "json"];
  if (model) args.push("--model", model);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("cursor-agent", args, spawnOptions(cwd, env, control.signal));
    } catch (error) {
      resolve(unknown(error?.message ?? error));
      return;
    }
    let stdout = "";
    let stderr = "";
    const run = createRun({ child, resolve, timeoutMs, idleMessage: `cursor-agent idle-timed out after ${timeoutMs}ms with no output`, control });
    const finish = run.finish;
    run.emit({ kind: "progress", summary: "cursor-agent started" });
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
      run.emit({ kind: "final", text: parsed.result });
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
 * opencode config, so this always runs against Kairo's own read-only agent
 * (see opencode-ask-agent.js), injected per run through the child's
 * OPENCODE_CONFIG_CONTENT env var. The user's global opencode.json is
 * never touched.
 *
 * Verified live (`opencode run --agent kairo-ask --format json`): the
 * real NDJSON stream emits `type: "text"` events carrying the real
 * answer in `part.text` (possibly across multiple steps — accumulated in
 * order) and a real `type: "error"` event on failure, both handled
 * per-line as chunks arrive, mirroring the same idle-reset principle as
 * every other ask call here.
 * @param {{question:string, model:string|null, cwd:string, spawn:Function, timeoutMs:number, env:object}} args
 */
async function askOpencode({ question, model, cwd, spawn, timeoutMs, env: baseEnv, control }) {
  if (control.signal?.aborted) return cancelled();
  // Per-run isolated config: the read-only agent travels in the child's env,
  // never in the user's global opencode.json.
  const env = Object.assign(Object.create(null), baseEnv, { [KAIRO_ASK_CONFIG_ENV]: buildKairoAskConfigContent() });
  const args = ["run", "--agent", KAIRO_ASK_AGENT_NAME, "--format", "json"];
  if (model) args.push("--model", model);
  args.push(question);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("opencode", args, spawnOptions(cwd, env, control.signal));
    } catch (error) {
      resolve(unknown(error?.message ?? error));
      return;
    }
    const answerParts = [];
    let realError = null;
    let stderr = "";
    const run = createRun({ child, resolve, timeoutMs, idleMessage: `opencode run idle-timed out after ${timeoutMs}ms with no output`, control });
    const finish = run.finish;
    function handleLine(line) {
      let parsed;
      try { parsed = JSON.parse(line); } catch { return; }
      if (parsed?.type === "text" && typeof parsed?.part?.text === "string") {
        answerParts.push(parsed.part.text);
        run.emit({ kind: "text", text: parsed.part.text });
      } else if (parsed?.type === "error") {
        realError = parsed.error?.data?.message ?? parsed.error?.name ?? "opencode run returned a real error event";
        run.emit({ kind: "error", message: String(realError) });
      }
    }
    const lines = createLineSplitter(handleLine);
    child.stdout?.on("data", (chunk) => lines.push(chunk));
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
    child.once?.("close", (code) => {
      lines.flush();
      if (realError) return finish(unknown(realError));
      const answer = answerParts.join("").trim();
      if (!answer) return finish(unknown(stderr.trim() || `opencode run exited ${code} with no real text output`));
      // The text was already streamed part by part: the final marker carries no text.
      run.emit({ kind: "final" });
      finish({ status: "answered", answer, error: null });
    });
  });
}

/** @param {{question:string, model:string|null, cwd:string, spawn:Function, timeoutMs:number, env:object}} args */
async function askCodex({ question, model, cwd, spawn, timeoutMs, env, control }) {
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
  // JSONL progress events only when someone listens; -o stays the source of
  // truth for the final answer either way.
  if (control.onEvent) args.push("--json");
  args.push(question);

  try {
    if (control.signal?.aborted) return cancelled();
    return await new Promise((resolve) => {
      let child;
      try {
        child = spawn("codex", args, spawnOptions(cwd, env, control.signal));
      } catch (error) {
        resolve(unknown(error?.message ?? error));
        return;
      }
      // Real codex stderr — captured so a missing output file (below)
      // reports WHY codex actually failed (rate limit, auth, a real model
      // error), never just the raw filesystem ENOENT for a file that's
      // missing BECAUSE codex failed, not the other way around.
      let stderr = "";
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      const run = createRun({ child, resolve, timeoutMs, idleMessage: `codex exec idle-timed out after ${timeoutMs}ms with no output`, control });
      const finish = run.finish;
      const lines = createLineSplitter((line) => {
        let parsed;
        try { parsed = JSON.parse(line); } catch { return; }
        const event = mapCodexEvent(parsed);
        if (event) run.emit(event);
      });
      if (control.onEvent) child.stdout?.on("data", (chunk) => lines.push(chunk));
      child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
      child.once?.("close", async (code) => {
        // A cancelled turn never reads (or trusts) the -o answer file.
        if (run.cancelling) return;
        if (control.onEvent) lines.flush();
        try {
          const text = (await readFile(outFile, "utf8")).trim();
          if (!text) return finish(unknown(stderr.trim() || "codex exec produced no final message"));
          run.emit({ kind: "final", text });
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
 * @param {AbortSignal} [args.signal] abort terminates the provider process
 *   tree (SIGTERM to the group, SIGKILL after `killGraceMs`); the call then
 *   resolves `{status:"cancelled", answer:null, error:null}` on child close, or
 *   right after SIGKILL if it has not closed by then (reaping is not awaited).
 *   Already aborted => resolves cancelled without spawning.
 * @param {(event:object) => void} [args.onEvent] provider progress events
 *   (`progress|text|tool_start|tool_end|error|final`); exceptions are ignored.
 * @param {number} [args.killGraceMs] TERM -> KILL grace (default 2000)
 * @param {Function} [args.killProcess] injectable `process.kill` (tests)
 * @returns {Promise<{status:"answered"|"error"|"unsupported"|"cancelled", answer:string|null, error:string|null}>}
 */
export async function askProvider({
  provider, question, model = null, cwd, spawn = defaultSpawn, timeoutMs = DEFAULT_TIMEOUT_MS, sourceEnv = process.env,
  signal = undefined, onEvent = undefined,
  killGraceMs = DEFAULT_KILL_GRACE_MS, killProcess = undefined
}) {
  // Optional cancellation/progress. With neither `signal` nor `onEvent` every
  // adapter behaves (and spawns) exactly as before.
  const control = { signal, onEvent: typeof onEvent === "function" ? onEvent : undefined, killGraceMs, killProcess };
  if (signal?.aborted) return cancelled();
  if (provider === "claude") return askClaude({ question, model, cwd, spawn, timeoutMs, env: buildClaudeExecutionEnv(sourceEnv), control });
  if (provider === "codex") return askCodex({ question, model, cwd, spawn, timeoutMs, env: buildCodexExecutionEnv(sourceEnv), control });
  if (provider === "cursor") return askCursor({ question, model, cwd, spawn, timeoutMs, env: buildCursorExecutionEnv(sourceEnv), control });
  if (provider === "opencode-go" || provider === "opencode-zen") {
    // The real catalog stores bare model ids (see opencode-models.js's
    // normalizeModel) — the CLI needs the real, fully-qualified
    // "opencode-go/<id>" (or "opencode/<id>" for Zen) ref to
    // deterministically route to the intended product, exactly like
    // service.js's executePlan already does for real task execution.
    const runtimeModel = model ? toRuntimeModelRef(provider === "opencode-go" ? "go" : "zen", model) : null;
    return askOpencode({
      question, model: runtimeModel, cwd, spawn, timeoutMs, env: buildOpencodeExecutionEnv(sourceEnv), control
    });
  }
  return { status: "unsupported", answer: null, error: `ASK is not supported for provider "${provider}" yet.` };
}
