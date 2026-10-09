/**
 * Interactive login runner that never touches the sidecar RPC stdio.
 *
 * The CLI is driven on a dedicated session: either a host-bridged TTY
 * (production) or an in-process fake CLI (tests). Sidecar JSONL stays intact.
 *
 * Runner contract matches provider-connections/runner.js:
 *   runner(argv, { interactive }) -> { done: Promise<{code,stdout,stderr}>, kill() }
 */

import { EventEmitter } from "node:events";

/**
 * Host-bridged interactive runner for the Ratatui sidecar.
 * On interactive spawn: emits a yield request, waits for the host to run the
 * CLI on the real TTY, then resolves with the host-reported exit code.
 *
 * @param {{
 *   onYield: (session: { sessionId: string, argv: string[] }) => void,
 *   onCancel?: (sessionId: string) => void,
 *   createId?: () => string
 * }} deps
 */
export function createHostBridgedInteractiveRunner(deps) {
  if (typeof deps?.onYield !== "function") {
    throw new Error("incomplete_interactive_runner: onYield is required");
  }
  /** @type {Map<string, { resolve: Function, reject: Function, killed: boolean }>} */
  const pending = new Map();
  let seq = 0;
  const createId = deps.createId ?? (() => `pty-${Date.now()}-${++seq}`);

  function runner(argv, { interactive = false } = {}) {
    if (!interactive) {
      const err = new Error("host-bridged runner is interactive-only");
      err.code = "EINVAL";
      throw err;
    }
    if (!Array.isArray(argv) || argv.length === 0) {
      const err = new Error("argv required");
      err.code = "EINVAL";
      throw err;
    }
    const sessionId = createId();
    let settle;
    const done = new Promise((resolve, reject) => {
      settle = { resolve, reject, killed: false };
      pending.set(sessionId, settle);
    });
    deps.onYield({ sessionId, argv: [...argv] });
    return {
      done,
      kill() {
        const entry = pending.get(sessionId);
        if (!entry || entry.killed) return;
        entry.killed = true;
        pending.delete(sessionId);
        deps.onCancel?.(sessionId);
        entry.resolve({ code: null, stdout: "", stderr: "cancelled" });
      },
      sessionId
    };
  }

  runner.complete = (sessionId, result = {}) => {
    const entry = pending.get(sessionId);
    if (!entry || entry.killed) return false;
    pending.delete(sessionId);
    entry.resolve({
      code: Number.isInteger(result.code) ? result.code : null,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? "")
    });
    return true;
  };

  runner.fail = (sessionId, error) => {
    const entry = pending.get(sessionId);
    if (!entry || entry.killed) return false;
    pending.delete(sessionId);
    entry.reject(error instanceof Error ? error : new Error(String(error)));
    return true;
  };

  runner.hasPending = (sessionId) => pending.has(sessionId);
  runner.pendingCount = () => pending.size;
  return runner;
}

/**
 * In-process fake CLI session for tests. Proves stdin/stdout/cancel/restore
 * without inheriting process stdio and without a real TTY.
 *
 * @param {{
 *   script?: (session: FakeCliSession) => void | Promise<void>,
 *   exitCode?: number
 * }} [options]
 */
export function createFakeCliInteractiveRunner(options = {}) {
  const calls = [];
  const sessions = [];

  function runner(argv, { interactive = false } = {}) {
    if (!interactive) {
      const err = new Error("fake CLI runner is interactive-only");
      err.code = "EINVAL";
      throw err;
    }
    const session = new FakeCliSession(argv);
    calls.push({ argv: [...argv], opts: { interactive } });
    sessions.push(session);
    let killed = false;
    const done = (async () => {
      try {
        if (typeof options.script === "function") {
          await options.script(session);
        } else {
          session.writeOutput("fake-cli: ready\n");
          const line = await session.readLine({ timeoutMs: 2000 });
          session.writeOutput(`fake-cli: got ${line}\n`);
        }
        if (killed || session.cancelled) {
          return { code: null, stdout: session.stdout, stderr: "cancelled" };
        }
        return {
          code: Number.isInteger(options.exitCode) ? options.exitCode : 0,
          stdout: session.stdout,
          stderr: session.stderr
        };
      } catch (err) {
        if (killed || session.cancelled || err?.name === "AbortError") {
          return { code: null, stdout: session.stdout, stderr: "cancelled" };
        }
        throw err;
      }
    })();
    return {
      done,
      kill() {
        killed = true;
        session.cancel();
      },
      session
    };
  }

  runner.calls = calls;
  runner.sessions = sessions;
  return runner;
}

export class FakeCliSession extends EventEmitter {
  /**
   * @param {string[]} argv
   */
  constructor(argv) {
    super();
    this.argv = [...argv];
    this.stdout = "";
    this.stderr = "";
    this.cancelled = false;
    /** @type {string[]} */
    this.inputLog = [];
    /** @type {((line: string) => void)[]} */
    this._waiters = [];
    this._buffer = "";
  }

  writeOutput(text) {
    this.stdout += text;
    this.emit("output", text);
  }

  writeError(text) {
    this.stderr += text;
    this.emit("error-output", text);
  }

  /** Host/user types into the fake CLI (not RPC stdin). */
  writeInput(chunk) {
    if (this.cancelled) return;
    const text = String(chunk);
    this.inputLog.push(text);
    this._buffer += text;
    this.emit("input", text);
    this._flushLines();
  }

  _flushLines() {
    let idx;
    while ((idx = this._buffer.indexOf("\n")) >= 0) {
      const line = this._buffer.slice(0, idx);
      this._buffer = this._buffer.slice(idx + 1);
      const waiter = this._waiters.shift();
      if (waiter) waiter(line);
    }
  }

  readLine({ timeoutMs = 1000 } = {}) {
    if (this.cancelled) {
      const err = new Error("cancelled");
      err.name = "AbortError";
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this._waiters.indexOf(onLine);
        if (i >= 0) this._waiters.splice(i, 1);
        reject(new Error("fake-cli read timeout"));
      }, timeoutMs);
      const onLine = (line) => {
        clearTimeout(timer);
        if (line === "__cancelled__" || this.cancelled) {
          const err = new Error("cancelled");
          err.name = "AbortError";
          reject(err);
          return;
        }
        resolve(line);
      };
      this._waiters.push(onLine);
      this._flushLines();
    });
  }

  cancel() {
    this.cancelled = true;
    const waiters = this._waiters.splice(0);
    for (const waiter of waiters) {
      waiter("__cancelled__");
    }
    this.emit("cancelled");
  }
}
