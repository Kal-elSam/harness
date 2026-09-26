/**
 * Node ↔ Pi RPC JSONL bridge for the ratatui host.
 *
 * Owns process spawn + JSONL framing + workspace snapshot load.
 * Does NOT own UI chrome (ratatui does). Does NOT change `kairo ui` default.
 *
 * Contract: `openPiRpcBridge` always resolves with `hostOpen: true` once the
 * snapshot is loaded. Pi spawn / RPC failures surface on `engine` and never
 * prevent the host from opening.
 *
 * `engine.status === "no_model"` applies when RPC answered `get_state` without
 * a model. Real Pi often exits before RPC if no model is configured — that
 * cold-start is expected as `unavailable` until R4 verifies the real binary.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  loadKairoWorkspaceSnapshot
} from "./workspace-snapshot.js";
import {
  KAIRO_PI_PACKAGE_NAME,
  KAIRO_PI_PACKAGE_VERSION
} from "./launch-gentle-shell.js";
import { resolveHomeDir } from "../paths.js";

export { KAIRO_WORKSPACE_SNAPSHOT_SCHEMA };

const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;

/**
 * @param {object|null|undefined} data - `get_state` response data
 * @returns {{ status: "connected"|"no_model", reason: string|null, sessionId: string|null, model: object|null }}
 */
export function classifyPiEngineFromState(data = {}) {
  const sessionId = typeof data?.sessionId === "string" ? data.sessionId : null;
  const model = data?.model && typeof data.model === "object" ? data.model : null;
  if (!model) {
    return {
      status: "no_model",
      reason: "No model selected",
      sessionId,
      model: null
    };
  }
  return {
    status: "connected",
    reason: null,
    sessionId,
    model
  };
}

/**
 * Open the engine bridge for a Kairo host session.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {object} [options.env]
 * @param {() => Promise<object>} [options.loadSnapshot]
 * @param {() => string} [options.resolveCliPath]
 * @param {typeof spawn} [options.spawnImpl]
 * @param {string} [options.execPath]
 * @param {number} [options.connectTimeoutMs]
 * @param {string[]} [options.extraArgs] - appended after `--mode rpc`
 */
export async function openPiRpcBridge({
  cwd = process.cwd(),
  env = process.env,
  loadSnapshot = () => loadKairoWorkspaceSnapshot({ cwd }),
  resolveCliPath = () => defaultResolveKairoPiCliPath(),
  spawnImpl = spawn,
  execPath = process.execPath,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  extraArgs = []
} = {}) {
  const snapshot = await loadSnapshot();
  assertWorkspaceSnapshot(snapshot);

  const bridge = createBridgeShell({ snapshot });

  let cliPath;
  try {
    cliPath = resolveCliPath();
  } catch (err) {
    bridge.engine = {
      status: "unavailable",
      reason: err?.message ?? String(err),
      sessionId: null,
      model: null
    };
    return bridge;
  }

  if (typeof cliPath !== "string" || !cliPath.trim()) {
    bridge.engine = {
      status: "unavailable",
      reason: "Pi CLI path is empty",
      sessionId: null,
      model: null
    };
    return bridge;
  }

  const hostEnv = buildRpcChildEnv(env);
  const args = [cliPath, "--mode", "rpc", "--no-session", ...extraArgs];

  let child;
  try {
    child = spawnImpl(execPath, args, {
      cwd,
      env: hostEnv,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (err) {
    bridge.engine = {
      status: "unavailable",
      reason: err?.message ?? String(err),
      sessionId: null,
      model: null
    };
    return bridge;
  }

  attachChild(bridge, child);

  try {
    await waitForChildReady(bridge, connectTimeoutMs);
    const state = await bridge.request({ type: "get_state" }, connectTimeoutMs);
    bridge.engine = classifyPiEngineFromState(state);
  } catch (err) {
    bridge.engine = {
      status: "unavailable",
      reason: err?.message ?? String(err),
      sessionId: null,
      model: null
    };
  }

  return bridge;
}

function assertWorkspaceSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== KAIRO_WORKSPACE_SNAPSHOT_SCHEMA) {
    throw new Error(
      `Expected snapshot schema ${KAIRO_WORKSPACE_SNAPSHOT_SCHEMA}, got ${snapshot?.schema ?? "missing"}`
    );
  }
}

function createBridgeShell({ snapshot }) {
  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;
  let stdoutBuffer = Buffer.alloc(0);
  let stopped = false;
  let child = null;
  let exitError = null;
  const eventBuffer = [];

  const bridge = {
    /** Always true after openPiRpcBridge returns — UI may paint. */
    hostOpen: true,
    snapshot,
    engine: {
      status: "starting",
      reason: null,
      sessionId: null,
      model: null
    },
    /**
     * Subscribe to session/protocol events (non-response records).
     * @returns {() => void} unsubscribe
     */
    onEvent(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("onEvent listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Drain buffered session events since the last take (FIFO). */
    takeEvents() {
      return eventBuffer.splice(0, eventBuffer.length);
    },
    request(command, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
      if (exitError) return Promise.reject(exitError);
      if (!child?.stdin) return Promise.reject(new Error("Pi RPC child has no stdin"));
      const id = `kairo-${nextId++}`;
      const payload = { ...command, id };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Pi RPC timed out waiting for ${command.type ?? "command"}`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (data) => {
            clearTimeout(timer);
            resolve(data);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          }
        });
        try {
          child.stdin.write(`${JSON.stringify(payload)}\n`);
        } catch (err) {
          pending.delete(id);
          clearTimeout(timer);
          reject(err);
        }
      });
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const [, entry] of pending) {
        entry.reject(new Error("Pi RPC bridge stopped"));
      }
      pending.clear();
      const previous = bridge.engine;
      bridge.engine = {
        status: "stopped",
        reason: null,
        sessionId: previous.sessionId ?? null,
        model: previous.model ?? null
      };
      if (!child) return;
      try {
        child.stdin?.end();
      } catch {
        // ignore
      }
      if (!child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
    },
    _ingestStdout(chunk) {
      stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)]);
      for (;;) {
        const idx = stdoutBuffer.indexOf(0x0a); // LF only — never Unicode line separators
        if (idx < 0) break;
        let line = stdoutBuffer.subarray(0, idx);
        stdoutBuffer = stdoutBuffer.subarray(idx + 1);
        if (line.length && line[line.length - 1] === 0x0d) {
          line = line.subarray(0, line.length - 1);
        }
        if (!line.length) continue;
        let record;
        try {
          record = JSON.parse(line.toString("utf8"));
        } catch {
          continue;
        }
        dispatchRecord(bridge, pending, eventBuffer, listeners, record);
      }
    },
    _setChild(c) {
      child = c;
    },
    _setExitError(err, { intentional = false } = {}) {
      exitError = err;
      for (const [, entry] of pending) entry.reject(err);
      pending.clear();
      if (intentional || stopped) return;
      const previous = bridge.engine;
      bridge.engine = {
        status: "unavailable",
        reason: err?.message ?? String(err),
        sessionId: previous.sessionId ?? null,
        model: null
      };
      const notice = {
        type: "engine_unavailable",
        reason: bridge.engine.reason,
        sessionId: bridge.engine.sessionId
      };
      eventBuffer.push(notice);
      for (const listener of listeners) {
        try {
          listener(notice);
        } catch {
          // Listener errors must not break the bridge.
        }
      }
    },
    _getExitError() {
      return exitError;
    },
    _isStopped() {
      return stopped;
    }
  };
  return bridge;
}

function dispatchRecord(bridge, pending, eventBuffer, listeners, record) {
  if (record?.type === "response" && record.id != null && pending.has(record.id)) {
    const entry = pending.get(record.id);
    pending.delete(record.id);
    if (record.success === false) {
      entry.reject(new Error(record.error ?? `Pi RPC ${record.command} failed`));
      return;
    }
    entry.resolve(record.data ?? {});
    return;
  }
  eventBuffer.push(record);
  for (const listener of listeners) {
    try {
      listener(record);
    } catch {
      // Listener errors must not break the bridge.
    }
  }
}

function attachChild(bridge, child) {
  bridge._setChild(child);
  child.stdout?.on("data", (chunk) => bridge._ingestStdout(chunk));
  child.stderr?.on("data", () => {
    // stderr is diagnostic only — never protocol
  });
  child.once("error", (err) => {
    bridge._setExitError(new Error(`Agent process error: ${err.message}`), {
      intentional: bridge._isStopped()
    });
  });
  child.once("exit", (code, signal) => {
    if (bridge._isStopped()) {
      bridge._setExitError(new Error("Pi RPC bridge stopped"), { intentional: true });
      return;
    }
    if (bridge._getExitError()) return;
    const detail =
      signal != null
        ? `Agent process exited from signal ${signal}`
        : `Agent process exited with code ${code ?? 1}`;
    bridge._setExitError(new Error(detail));
  });
}

function waitForChildReady(bridge, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const exitErr = bridge._getExitError();
      if (exitErr) {
        reject(exitErr);
        return;
      }
      // Child is usable once stdin exists and no exit yet.
      resolve();
    };
    // Spawn errors are async via 'error' — give them a microtask turn.
    queueMicrotask(() => {
      if (bridge._getExitError()) {
        reject(bridge._getExitError());
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Pi RPC child failed to start"));
        return;
      }
      tick();
    });
  });
}

function buildRpcChildEnv(env) {
  const home = resolveHomeDir(env);
  return {
    ...env,
    PI_CODING_AGENT_DIR: join(home, ".harness", "pi-agent"),
    KAIRO_PI_EMPTY_SESSIONS: "1",
    PI_SKIP_VERSION_CHECK: "1"
  };
}

/**
 * Resolve the Kairo-only Pi fork CLI bundle path (same pin as launchGentleShell).
 * Exported for tests / host wiring; does not spawn.
 */
export function defaultResolveKairoPiCliPath(resolveEntryImpl = defaultResolveEntry) {
  const entryPath = resolveEntryImpl();
  if (typeof entryPath !== "string" || !entryPath.trim()) {
    throw new Error(
      `Kairo-only Pi fork "${KAIRO_PI_PACKAGE_NAME}"@${KAIRO_PI_PACKAGE_VERSION} is not installed.`
    );
  }
  let dir = dirname(entryPath);
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg?.name === KAIRO_PI_PACKAGE_NAME) {
          if (pkg.version !== KAIRO_PI_PACKAGE_VERSION) {
            throw new Error(
              `Kairo-only Pi fork version mismatch: found "${pkg.version}", expected "${KAIRO_PI_PACKAGE_VERSION}".`
            );
          }
          const cliPath = join(dir, "dist", "bundle", "cli.js");
          if (!existsSync(cliPath)) {
            throw new Error(`Kairo-only Pi fork bundle is missing: "${cliPath}" does not exist.`);
          }
          return cliPath;
        }
      } catch (err) {
        if (err?.message?.includes("version mismatch") || err?.message?.includes("bundle is missing")) {
          throw err;
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not find "${KAIRO_PI_PACKAGE_NAME}" package.json walking up from "${entryPath}".`
  );
}

function defaultResolveEntry() {
  return fileURLToPath(import.meta.resolve(KAIRO_PI_PACKAGE_NAME));
}
