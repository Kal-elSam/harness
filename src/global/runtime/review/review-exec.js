import { spawn } from "node:child_process";

export const REVIEW_EXEC_ERROR_CODES = Object.freeze({
  NONZERO_EXIT: "nonzero_exit", TIMEOUT: "timeout", OUTPUT_OVERFLOW: "output_overflow",
  TERMINATION_FAILED: "termination_failed", SPAWN_FAILED: "spawn_failed"
});
export const REVIEW_EXEC_LIMITS = Object.freeze({
  STDOUT: 1_048_576, STDERR: 16_384, DEFAULT_TIMEOUT_MS: 180_000,
  TERMINATION_GRACE_MS: 1_000, KILL_GRACE_MS: 1_000
});

export class ReviewExecError extends Error {
  constructor(message, { code, details = null } = {}) {
    super(message);
    this.name = "ReviewExecError";
    this.code = code;
    this.details = details;
  }
}

/** Spawn without shell; stdin; capped streams; SIGTERM→SIGKILL. */
export function runBoundedProcess({
  command, args = [], cwd, env, stdin = null, spawnImpl = spawn,
  timeoutMs = REVIEW_EXEC_LIMITS.DEFAULT_TIMEOUT_MS,
  terminationGraceMs = REVIEW_EXEC_LIMITS.TERMINATION_GRACE_MS,
  killGraceMs = REVIEW_EXEC_LIMITS.KILL_GRACE_MS,
  stdoutLimit = REVIEW_EXEC_LIMITS.STDOUT, stderrLimit = REVIEW_EXEC_LIMITS.STDERR
} = {}) {
  if (typeof command !== "string" || !command) {
    return Promise.reject(new ReviewExecError("runBoundedProcess requires command.", {
      code: REVIEW_EXEC_ERROR_CODES.SPAWN_FAILED
    }));
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, { cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      reject(new ReviewExecError(`Failed to spawn "${command}": ${error.message}`, {
        code: REVIEW_EXEC_ERROR_CODES.SPAWN_FAILED, details: { command }
      }));
      return;
    }
    let stdout = "";
    let stderr = "";
    let stdoutOverflow = false;
    let stderrOverflow = false;
    let settled = false;
    let timedOut = false;
    let timers = [];
    const clearTimers = () => { for (const t of timers) clearTimeout(t); timers = []; };
    const schedule = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
    const detachIo = () => {
      child.stdout?.off?.("data", onStdout);
      child.stderr?.off?.("data", onStderr);
      child.off?.("close", onClose);
    };
    const settle = (result) => {
      if (settled) return;
      settled = true; clearTimers(); detachIo(); resolve(result);
    };
    const finish = (extra = {}) => settle({
      status: null, signal: null, timedOut, terminationFailed: false,
      stdoutOverflow, stderrOverflow, stdout, stderr, ...extra
    });
    const onStdout = (chunk) => {
      const next = appendLimited(stdout, chunk, stdoutLimit);
      stdout = next.text; if (next.overflow) stdoutOverflow = true;
    };
    const onStderr = (chunk) => {
      const next = appendLimited(stderr, chunk, stderrLimit);
      stderr = next.text; if (next.overflow) stderrOverflow = true;
    };
    const onError = (error) => {
      if (settled) return;
      settled = true; clearTimers(); detachIo();
      reject(new ReviewExecError(`Spawn error for "${command}": ${error.message}`, {
        code: REVIEW_EXEC_ERROR_CODES.SPAWN_FAILED, details: { command }
      }));
    };
    const onClose = (status, signal) => finish({ status: status ?? null, signal: signal ?? null });
    schedule(() => {
      if (settled) return;
      timedOut = true; safeKill(child, "SIGTERM");
      schedule(() => {
        if (settled) return;
        safeKill(child, "SIGKILL");
        schedule(() => {
          if (settled) return;
          try { child.unref?.(); } catch { /* ignore */ }
          finish({ terminationFailed: true });
        }, killGraceMs);
      }, terminationGraceMs);
    }, timeoutMs);
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);
    child.stdin?.on?.("error", () => {}); // absorb async EPIPE
    try { child.stdin?.end(stdin == null ? undefined : String(stdin)); }
    catch { try { child.stdin?.end(); } catch { /* ignore */ } }
  });
}

/** Nonzero/overflow/timeout fail even when output exists. */
export function assertBoundedProcessOk(result) {
  const fail = (code, message, details = null) => {
    throw new ReviewExecError(message, { code, details });
  };
  if (result.terminationFailed) fail(REVIEW_EXEC_ERROR_CODES.TERMINATION_FAILED, "Process did not terminate after SIGTERM/SIGKILL.");
  if (result.timedOut) fail(REVIEW_EXEC_ERROR_CODES.TIMEOUT, "Process timed out.", { signal: result.signal });
  if (result.stdoutOverflow || result.stderrOverflow) {
    fail(REVIEW_EXEC_ERROR_CODES.OUTPUT_OVERFLOW, "Process output exceeded capture limits.", {
      stdoutOverflow: result.stdoutOverflow, stderrOverflow: result.stderrOverflow
    });
  }
  if (result.status !== 0) {
    fail(REVIEW_EXEC_ERROR_CODES.NONZERO_EXIT, `Process exited with status ${result.status}.`, {
      status: result.status, signal: result.signal
    });
  }
  return result;
}

function appendLimited(current, chunk, limit) {
  if (current.length >= limit) return { text: current, overflow: true };
  const next = current + String(chunk);
  return next.length <= limit
    ? { text: next, overflow: false }
    : { text: next.slice(0, limit), overflow: true };
}

function safeKill(child, signal) {
  try { return typeof child.kill === "function" ? child.kill(signal) !== false : false; }
  catch { return false; }
}
