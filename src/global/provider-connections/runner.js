// Process execution with timeout and AbortSignal, over an injected runner.
//
// Runner contract (so tests never spawn anything):
//   runner(argv, { interactive }) -> { done: Promise<{ code, stdout?, stderr? }>, kill() }
// `done` rejects with an error carrying `.code` (e.g. "ENOENT") when the
// process cannot start. Never a shell, never a string command.

import { spawn as nodeSpawn } from "node:child_process";
import { SECRET_ENV_KEYS } from "./allowlist.js";

const MAX_CAPTURE_BYTES = 64 * 1024;

function classifyError(error) {
  if (error?.code === "ENOENT") return { kind: "missing" };
  return { kind: "error" };
}

/**
 * @returns {Promise<{kind: "exit", code: number|null, stdout: string, stderr: string}
 *   | {kind: "timeout"|"cancelled"|"missing"|"error"}>}
 */
export function execute(runner, argv, { interactive = false, signal, timeoutMs } = {}) {
  if (signal?.aborted) return Promise.resolve({ kind: "cancelled" });
  let handle;
  try {
    handle = runner(argv, { interactive });
  } catch (error) {
    return Promise.resolve(classifyError(error));
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (outcome, kill) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      if (kill) {
        try { handle.kill?.(); } catch { /* best effort */ }
      }
      resolve(outcome);
    };
    const onAbort = () => finish({ kind: "cancelled" }, true);
    signal?.addEventListener?.("abort", onAbort, { once: true });
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => finish({ kind: "timeout" }, true), timeoutMs);
    }
    Promise.resolve(handle.done).then(
      (done) => finish({
        kind: "exit",
        code: Number.isInteger(done?.code) ? done.code : null,
        stdout: String(done?.stdout ?? ""),
        stderr: String(done?.stderr ?? "")
      }, false),
      (error) => finish(classifyError(error), false)
    );
  });
}

export function sanitizeEnv(env = process.env) {
  const clean = { ...env };
  for (const key of SECRET_ENV_KEYS) delete clean[key];
  return clean;
}

/**
 * Production runner. `interactive` inherits stdio so the vendor CLI can own
 * the terminal/browser flow; otherwise output is captured (size-capped) and
 * stdin is closed. No shell; credential env vars are stripped.
 */
export function createSpawnRunner({ spawn = nodeSpawn, env = process.env } = {}) {
  return function spawnRunner(argv, { interactive = false } = {}) {
    const child = spawn(argv[0], argv.slice(1), {
      shell: false,
      env: sanitizeEnv(env),
      stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    const done = new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const append = (current, chunk) => (current.length >= MAX_CAPTURE_BYTES ? current : current + chunk);
      child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
      child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
    return { done, kill: () => child.kill("SIGTERM") };
  };
}
