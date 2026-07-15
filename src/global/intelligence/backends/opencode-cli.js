import { spawn } from "node:child_process";

const EXECUTABLE = "opencode";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_TERMINATION_GRACE_MS = 1000;
const DEFAULT_KILL_GRACE_MS = 1000;
const STDERR_LIMIT = 480;
const STDOUT_BUFFER_LIMIT = 1_048_576;
const STDERR_BUFFER_LIMIT = STDERR_LIMIT;

function isSensitiveEnvName(name) {
  return /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(String(name ?? ""));
}

function appendLimited(current, chunk, limit) {
  if (current.length >= limit) return current;
  const next = current + String(chunk);
  return next.length > limit ? next.slice(0, limit) : next;
}

/**
 * Supervised, non-mutating OpenCode CLI invocation.
 * Always uses `opencode run --format json --model` — never `--auto`.
 * Timeout: SIGTERM → grace → SIGKILL → grace → unref + terminationFailed.
 */
export function runOpencodeJson({
  modelRef,
  prompt,
  cwd,
  env,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS
} = {}) {
  if (!modelRef || typeof modelRef !== "string") {
    return Promise.reject(new Error("runOpencodeJson requires modelRef."));
  }
  if (prompt == null) {
    return Promise.reject(new Error("runOpencodeJson requires prompt."));
  }

  const args = ["run", "--format", "json", "--model", modelRef, String(prompt)];

  return new Promise((resolve, reject) => {
    const child = spawnImpl(EXECUTABLE, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timers = [];

    const clearTimers = () => {
      for (const timer of timers) clearTimeout(timer);
      timers = [];
    };

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimers();
      detachIo();
      resolve(result);
    };

    const schedule = (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timers.push(timer);
      return timer;
    };

    const finish = ({ status = null, signal = null, terminationFailed = false } = {}) => {
      settle({
        stdout,
        stderr,
        status,
        signal,
        timedOut,
        terminationFailed
      });
    };

    const forceUnref = () => {
      try {
        child.unref?.();
      } catch {
        /* ignore unref failures */
      }
    };

    const onStdout = (chunk) => {
      stdout = appendLimited(stdout, chunk, STDOUT_BUFFER_LIMIT);
    };
    const onStderr = (chunk) => {
      stderr = appendLimited(stderr, chunk, STDERR_BUFFER_LIMIT);
    };
    // Keep listening after settle so late errors never crash Node.
    const onError = (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      detachIo();
      reject(error);
    };
    const onClose = (status, signal) => {
      finish({
        status: status ?? null,
        signal: signal ?? null,
        terminationFailed: false
      });
    };

    const detachIo = () => {
      child.stdout?.off?.("data", onStdout);
      child.stderr?.off?.("data", onStderr);
      child.off?.("close", onClose);
    };

    const onTimeout = () => {
      if (settled) return;
      timedOut = true;
      safeKill(child, "SIGTERM");
      schedule(() => {
        if (settled) return;
        safeKill(child, "SIGKILL");
        schedule(() => {
          if (settled) return;
          forceUnref();
          finish({ terminationFailed: true });
        }, killGraceMs);
      }, terminationGraceMs);
    };

    schedule(onTimeout, timeoutMs);

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);
  });
}

export function sanitizeCliStderr(text, { limit = STDERR_LIMIT } = {}) {
  let out = String(text ?? "").replace(/\s+/g, " ").trim();
  out = out.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
  out = out.replace(
    /\b([A-Z][A-Z0-9_]*)\s*[:=]\s*(["'])(?:\\.|(?!\2).)*\2/g,
    (match, name) => (isSensitiveEnvName(name) ? `${name}=[REDACTED]` : match)
  );
  out = out.replace(/\b([A-Z][A-Z0-9_]*)\s*[:=]\s*\S+/g, (match, name) => (
    isSensitiveEnvName(name) ? `${name}=[REDACTED]` : match
  ));
  if (out.length > limit) {
    if (limit <= 0) return "";
    if (limit === 1) return "…";
    out = `${out.slice(0, limit - 1)}…`;
  }
  return out;
}

function safeKill(child, signal) {
  try {
    if (typeof child.kill !== "function") return false;
    return child.kill(signal) !== false;
  } catch {
    return false;
  }
}

/**
 * Parse NDJSON OpenCode `--format json` events into text, usage, and errors.
 * Rejects malformed stdout explicitly (any non-empty line that is not JSON).
 */
export function parseOpencodeJsonEvents(stdout) {
  const events = [];
  const texts = [];
  let error = null;
  const usage = {
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    estimatedCost: null
  };

  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return {
        content: null,
        error: "OpenCode CLI returned malformed JSON events.",
        events,
        usage
      };
    }

    events.push(event);

    if (event.type === "error" || event.error) {
      error =
        event.error?.message ??
        event.message ??
        "OpenCode CLI error event";
      continue;
    }

    if (event.type === "text") {
      if (typeof event.part?.text === "string") texts.push(event.part.text);
      else if (typeof event.text === "string") texts.push(event.text);
    }

    if (event.type === "step_finish" && event.part) {
      applyStepFinishUsage(usage, event.part);
    }
  }

  return {
    content: texts.length > 0 ? texts.join("") : null,
    error,
    events,
    usage
  };
}

function applyStepFinishUsage(usage, part) {
  const tokens = part.tokens ?? part.usage ?? {};
  if (tokens.input != null || tokens.prompt != null) {
    usage.inputTokens = tokens.input ?? tokens.prompt;
  }
  if (tokens.output != null || tokens.completion != null) {
    usage.outputTokens = tokens.output ?? tokens.completion;
  }
  const cached = tokens.cache?.read ?? tokens.cached;
  if (cached != null) usage.cachedTokens = cached;
  if (typeof part.cost === "number") usage.estimatedCost = part.cost;
}
