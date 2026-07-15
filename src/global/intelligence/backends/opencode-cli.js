import { spawn } from "node:child_process";

const EXECUTABLE = "opencode";
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Supervised, non-mutating OpenCode CLI invocation.
 * Always uses `opencode run --format json --model` — never `--auto`.
 */
export function runOpencodeJson({
  modelRef,
  prompt,
  cwd,
  env,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS
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

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({ stdout, stderr, status: null, timedOut: true });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      settle({ stdout, stderr, status, timedOut: false });
    });
  });
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
