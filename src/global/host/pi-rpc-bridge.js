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
 * `engine.status === "no_model"` applies when the Architect route from active
 * `projectTeam` is missing or `set_model` failed. Spawn/RPC handshake failures
 * stay `unavailable`. Real Pi may exit before RPC without extension — fixed by
 * loading the Kairo extension on spawn (same flags as interactive host).
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
  KAIRO_PI_PACKAGE_VERSION,
  DEFAULT_EXTENSION_DIR,
  buildKairoPiResourceArgs
} from "./launch-gentle-shell.js";
import { redactText } from "../runtime/run-redact.js";
import { loadKairoProviderModels as loadKairoProviderModelsImpl } from "./kairo-route-provider.js";
import { resolveHomeDir } from "../paths.js";

const KAIRO_PROVIDER_ID = "kairo";

export { KAIRO_WORKSPACE_SNAPSHOT_SCHEMA };

const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;

/**
 * @param {object|null|undefined} data - `get_state` response data
 * @returns {{ status: "connected"|"no_model", reason: string|null, sessionId: string|null, model: object|null }}
 */
/**
 * Pick the Architect route from models produced by `buildKairoProviderModels`.
 * @param {object[]|null|undefined} models
 * @returns {object|null}
 */
export function selectArchitectKairoModel(models) {
  if (!Array.isArray(models) || models.length === 0) return null;
  return models.find((model) => model?.kairoRoute?.role === "Architect") ?? null;
}

/**
 * @param {object[]|null|undefined} models - launchable automatic projectTeam routes
 * @returns {string}
 */
export function missingArchitectRouteReason(models) {
  if (!Array.isArray(models) || models.length === 0) {
    return "No active strategy with automatic launchable projectTeam routes";
  }
  return "No Architect assignment with automatic access and a launchable adapter in projectTeam";
}

/**
 * @param {object} params
 * @param {string} params.cliPath
 * @param {string} [params.extensionDir]
 * @param {string[]} [params.extraArgs]
 * @returns {string[]}
 */
export function buildPiRpcSpawnArgs({
  cliPath,
  extensionDir = DEFAULT_EXTENSION_DIR,
  extraArgs = []
} = {}) {
  if (typeof cliPath !== "string" || !cliPath.trim()) {
    throw new Error("Pi CLI path is required");
  }
  return [
    cliPath,
    ...buildKairoPiResourceArgs(extensionDir),
    "--mode",
    "rpc",
    "--no-session",
    ...extraArgs
  ];
}

/**
 * @param {object} bridge
 * @param {object} params
 * @param {string} params.cwd
 * @param {(args: { cwd: string }) => Promise<object[]>} params.loadKairoProviderModels
 * @param {number} params.connectTimeoutMs
 * @param {object|null} [params.initialState]
 */
export async function resolveArchitectRouteForRpc(
  bridge,
  { cwd, loadKairoProviderModels, connectTimeoutMs, initialState = null }
) {
  const sessionId =
    typeof initialState?.sessionId === "string" ? initialState.sessionId : null;
  let models;
  try {
    models = await loadKairoProviderModels({ cwd });
  } catch (err) {
    return {
      status: "no_model",
      reason: err?.message ?? String(err),
      sessionId,
      model: null
    };
  }

  const architect = selectArchitectKairoModel(models);
  if (!architect?.id) {
    return {
      status: "no_model",
      reason: missingArchitectRouteReason(models),
      sessionId,
      model: null
    };
  }

  try {
    await bridge.request(
      {
        type: "set_model",
        provider: KAIRO_PROVIDER_ID,
        modelId: architect.id
      },
      connectTimeoutMs
    );
    const state = await bridge.request({ type: "get_state" }, connectTimeoutMs);
    return classifyPiEngineFromState(state);
  } catch (err) {
    return {
      status: "no_model",
      reason: `Architect route is configured but set_model failed: ${err?.message ?? err}`,
      sessionId,
      model: null
    };
  }
}

/**
 * With no model configured, Pi reports a placeholder model whose provider, api
 * and id are all the literal "unknown" instead of `null`.
 */
function isPiPlaceholderModel(model) {
  return (
    model.id === "unknown" && model.provider === "unknown" && model.api === "unknown"
  );
}

export function classifyPiEngineFromState(data = {}) {
  const sessionId = typeof data?.sessionId === "string" ? data.sessionId : null;
  const reported = data?.model && typeof data.model === "object" ? data.model : null;
  const model = reported && !isPiPlaceholderModel(reported) ? reported : null;
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
 * @param {string} [options.extensionDir]
 * @param {(args: { cwd: string }) => Promise<object[]>} [options.loadKairoProviderModels]
 * @param {number} [options.stopKillGraceMs] - SIGKILL a child that ignored SIGTERM this long after stop()
 * @param {number} [options.maxLineBytes] - drop a stdout line longer than this (no newline within the cap)
 * @param {number} [options.maxBufferedEvents] - newest events kept for takeEvents()
 */
export async function openPiRpcBridge({
  cwd = process.cwd(),
  env = process.env,
  loadSnapshot = () => loadKairoWorkspaceSnapshot({ cwd }),
  resolveCliPath = () => defaultResolveKairoPiCliPath(),
  spawnImpl = spawn,
  execPath = process.execPath,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  extraArgs = [],
  extensionDir = DEFAULT_EXTENSION_DIR,
  loadKairoProviderModels = loadKairoProviderModelsImpl,
  stopKillGraceMs = DEFAULT_STOP_KILL_GRACE_MS,
  maxLineBytes = DEFAULT_MAX_LINE_BYTES,
  maxBufferedEvents = DEFAULT_MAX_BUFFERED_EVENTS
} = {}) {
  const snapshot = await loadSnapshot();
  assertWorkspaceSnapshot(snapshot);

  const bridge = createBridgeShell({ snapshot, stopKillGraceMs, maxLineBytes, maxBufferedEvents });

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
  let args;
  try {
    args = buildPiRpcSpawnArgs({ cliPath, extensionDir, extraArgs });
  } catch (err) {
    bridge.engine = {
      status: "unavailable",
      reason: err?.message ?? String(err),
      sessionId: null,
      model: null
    };
    return bridge;
  }

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
    bridge.engine = await resolveArchitectRouteForRpc(bridge, {
      cwd,
      loadKairoProviderModels,
      connectTimeoutMs,
      initialState: state
    });
  } catch (err) {
    bridge.engine = {
      status: "unavailable",
      reason: err?.message ?? String(err),
      sessionId: null,
      model: null
    };
    // The bridge is unusable: do not leave a wedged Pi child (and its pipes) running.
    bridge._abandonChild(err instanceof Error ? err : new Error(String(err)));
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

const DEFAULT_STOP_KILL_GRACE_MS = 2000;
const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_EVENTS = 10_000;

function createBridgeShell({
  snapshot,
  stopKillGraceMs = DEFAULT_STOP_KILL_GRACE_MS,
  maxLineBytes = DEFAULT_MAX_LINE_BYTES,
  maxBufferedEvents = DEFAULT_MAX_BUFFERED_EVENTS
}) {
  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;
  let stdoutBuffer = Buffer.alloc(0);
  let discardingLongLine = false;
  let stopped = false;
  let child = null;
  let childExited = false;
  let exitError = null;
  const eventBuffer = [];

  /** Push to the bounded queue (newest kept) and to every listener. */
  const publish = (record) => {
    eventBuffer.push(record);
    if (eventBuffer.length > maxBufferedEvents) eventBuffer.splice(0, eventBuffer.length - maxBufferedEvents);
    for (const listener of listeners) {
      try {
        listener(record);
      } catch {
        // Listener errors must not break the bridge.
      }
    }
  };

  /** End stdin and SIGTERM the child; SIGKILL it later if it ignored that. Never blocks. */
  const terminateChild = () => {
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
    if (stopKillGraceMs > 0) {
      const timer = setTimeout(() => {
        if (childExited) return;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, stopKillGraceMs);
      timer.unref?.();
    }
  };

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
      if (stopped) return Promise.reject(new Error("Pi RPC bridge stopped"));
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
    /**
     * One-way stdin write (U3b): used for `extension_ui_response` and any
     * other record that must NOT register in `pending` / wait for a typed
     * `response` envelope. Caller supplies the full JSON object (including
     * its own `id` when correlating an extension UI dialog).
     * @param {object} record
     */
    sendRaw(record) {
      if (stopped) throw new Error("Pi RPC bridge stopped");
      if (exitError) throw exitError;
      if (!child?.stdin) throw new Error("Pi RPC child has no stdin");
      if (record == null || typeof record !== "object") {
        throw new TypeError("sendRaw record must be an object");
      }
      child.stdin.write(`${JSON.stringify(record)}\n`);
    },
    /** Alias for {@link sendRaw} — same fire-and-forget contract. */
    writeLine(record) {
      return bridge.sendRaw(record);
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
      terminateChild();
    },
    /** Handshake failed: stop using the child, keep the original reason, and terminate it. */
    _abandonChild(reason) {
      bridge._setExitError(reason, { intentional: true });
      terminateChild();
    },
    _markChildExited() {
      childExited = true;
    },
    _ingestStdout(chunk) {
      stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)]);
      for (;;) {
        const idx = stdoutBuffer.indexOf(0x0a); // LF only — never Unicode line separators
        if (idx < 0) break;
        let line = stdoutBuffer.subarray(0, idx);
        stdoutBuffer = stdoutBuffer.subarray(idx + 1);
        if (discardingLongLine) {
          discardingLongLine = false; // the oversized line ends here
          continue;
        }
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
        dispatchRecord(bridge, pending, publish, record);
      }
      // A line that never ends must not grow the buffer (and every concat) without bound.
      if (stdoutBuffer.length > maxLineBytes) {
        stdoutBuffer = Buffer.alloc(0);
        if (!discardingLongLine) {
          discardingLongLine = true;
          publish({ type: "bridge_warning", reason: `Pi stdout line exceeded ${maxLineBytes} bytes; dropped` });
        }
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
      publish(notice);
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

function dispatchRecord(bridge, pending, publish, record) {
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
  publish(record);
}

const STDERR_TAIL_MAX = 2000;
// Raw window kept larger than the surfaced tail so redaction sees whole
// secrets (also across chunk boundaries) before the final truncation.
const STDERR_RAW_MAX = STDERR_TAIL_MAX * 4;

// Credentials are short; a longer leading run is opaque output, not a cut secret.
const PARTIAL_TOKEN_MAX = 256;

function dropLeadingPartialToken(text) {
  // The leading token may be the cut tail of a secret; discard it.
  const m = /^(\S*)\s/.exec(text);
  if (!m || m[1].length > PARTIAL_TOKEN_MAX) return text;
  return text.slice(m[0].length);
}

function formatStderrTail(raw, rawTruncated) {
  const window = rawTruncated ? dropLeadingPartialToken(raw) : raw;
  const redacted = redactText(window);
  if (redacted.length <= STDERR_TAIL_MAX) return redacted;
  // Already redacted over the larger window, so a straddling secret is a marker.
  return redacted.slice(-STDERR_TAIL_MAX);
}

function withStderrTail(message, tail) {
  const text = formatStderrTail(tail.raw, tail.truncated).trim();
  return text ? `${message}: ${text}` : message;
}

function attachChild(bridge, child) {
  bridge._setChild(child);
  const stderrTail = { raw: "", truncated: false };
  child.stdout?.on("data", (chunk) => bridge._ingestStdout(chunk));
  child.stderr?.on("data", (chunk) => {
    // stderr is diagnostic only — never protocol. Keep a bounded tail so a
    // startup failure is shown verbatim instead of a bare exit code.
    // Redaction happens on the assembled window when the reason is formatted.
    const next = stderrTail.raw + String(chunk);
    if (next.length > STDERR_RAW_MAX) {
      stderrTail.raw = next.slice(-STDERR_RAW_MAX);
      stderrTail.truncated = true;
    } else {
      stderrTail.raw = next;
    }
  });
  // An async write error (EPIPE, write after end) or a second child 'error' is an unhandled
  // 'error' event, i.e. an uncaught exception that would take the whole host down.
  child.stdin?.on?.("error", (err) => {
    if (bridge._isStopped() || bridge._getExitError()) return;
    bridge._setExitError(new Error(withStderrTail(`Agent stdin error: ${err?.message ?? err}`, stderrTail)));
  });
  child.on("error", (err) => {
    if (!bridge._isStopped() && bridge._getExitError()) return;
    bridge._setExitError(new Error(withStderrTail(`Agent process error: ${err?.message ?? err}`, stderrTail)), {
      intentional: bridge._isStopped()
    });
  });
  child.once("exit", (code, signal) => {
    bridge._markChildExited();
    if (bridge._isStopped()) {
      bridge._setExitError(new Error("Pi RPC bridge stopped"), { intentional: true });
      return;
    }
    if (bridge._getExitError()) return;
    const detail =
      signal != null
        ? `Agent process exited from signal ${signal}`
        : `Agent process exited with code ${code ?? 1}`;
    bridge._setExitError(new Error(withStderrTail(detail, stderrTail)));
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
