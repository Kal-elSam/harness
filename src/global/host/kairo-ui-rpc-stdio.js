/**
 * Thin JSONL sidecar: Rust kairo-ui ↔ openPiRpcBridge ↔ Pi RPC.
 *
 * stdin commands (one JSON object per LF-terminated line):
 *   { "op": "prompt", "message": "..." }
 *   { "op": "abort" }
 *   { "op": "compact" }
 *   { "op": "cycle_model" }
 *   { "op": "new_session" }
 *   { "op": "switch_session", "sessionPath": "..." }
 *   { "op": "switch_session_index", "index": 0 }
 *   { "op": "list_sessions" }
 *   { "op": "reload_snapshot" }
 *   { "op": "stop" }
 *
 * stdout records (JSONL): { type: "ready", engine, snapshot?, kairoModels?, sessions? },
 * { type: "engine", engine }, { type: "transcript", messages }, { type: "sessions", sessions },
 * forwarded Pi session events, { type: "error", message }, and bridge engine_unavailable.
 */

import { fileURLToPath } from "node:url";
import {
  openPiRpcBridge,
  classifyPiEngineFromState,
  resolveArchitectRouteForRpc
} from "./pi-rpc-bridge.js";
import { loadKairoWorkspaceSnapshot } from "./workspace-snapshot.js";
import { loadKairoProviderModels } from "./kairo-route-provider.js";
import { listPiSessionFilesForCwd } from "./pi-rpc-sessions.js";
import { mapPiMessagesToTranscriptRows } from "./pi-rpc-transcript.js";
import {
  formatEngineModelLabel,
  kairoSetModelCommand,
  pickNextKairoModel
} from "./pi-rpc-kairo-models.js";

/**
 * @param {object[]} models
 * @returns {object[]}
 */
export function serializeKairoModelsForHost(models) {
  if (!Array.isArray(models)) return [];
  return models.map((m) => ({
    id: m?.id ?? null,
    name: m?.name ?? null,
    role: m?.kairoRoute?.role ?? null
  }));
}

/**
 * @param {import("./pi-rpc-bridge.js").openPiRpcBridge extends Function ? Awaited<ReturnType<typeof openPiRpcBridge>> : never} bridge
 */
export async function fetchTranscriptRows(bridge) {
  const data = await bridge.request({ type: "get_messages" });
  return mapPiMessagesToTranscriptRows(data?.messages);
}

/**
 * Refresh host engine from Pi `get_state`.
 * When `reapplyArchitect` is true (session create/switch only — never after
 * `cycle_model`), re-select Architect via `resolveArchitectRouteForRpc`.
 *
 * @param {object} bridge
 * @param {string} cwd
 * @param {object} [options]
 * @param {boolean} [options.reapplyArchitect]
 * @param {(args: { cwd: string }) => Promise<object[]>} [options.loadKairoProviderModels]
 * @param {number} [options.connectTimeoutMs]
 */
export async function refreshHostEngine(
  bridge,
  cwd,
  {
    reapplyArchitect = false,
    loadKairoProviderModels: loadModels = loadKairoProviderModels,
    connectTimeoutMs
  } = {}
) {
  const state = await bridge.request({ type: "get_state" });
  const engine = reapplyArchitect
    ? await resolveArchitectRouteForRpc(bridge, {
        cwd,
        loadKairoProviderModels: loadModels,
        connectTimeoutMs,
        initialState: state
      })
    : classifyPiEngineFromState(state);
  bridge.engine = engine;
  return engine;
}

/**
 * @param {object} bridge
 * @param {string} cwd
 * @param {(record: object) => void} writeOut
 */
export async function emitTranscriptFromPi(bridge, cwd, writeOut) {
  const rows = await fetchTranscriptRows(bridge);
  writeOut({ type: "transcript", messages: rows });
}

/**
 * @param {object} [options]
 * @param {NodeJS.ReadableStream} [options.stdin]
 * @param {NodeJS.WritableStream} [options.stdout]
 * @param {string} [options.cwd]
 * @param {typeof openPiRpcBridge} [options.openBridge]
 * @param {(args: { cwd: string }) => Promise<object[]>} [options.loadKairoProviderModels]
 */
export async function runKairoUiRpcStdio({
  stdin = process.stdin,
  stdout = process.stdout,
  cwd = process.cwd(),
  openBridge = openPiRpcBridge,
  loadKairoProviderModels: loadModels = loadKairoProviderModels
} = {}) {
  const bridge = await openBridge({ cwd });
  let kairoModels = [];
  try {
    kairoModels = await loadModels({ cwd });
  } catch {
    kairoModels = [];
  }
  let sessionFiles = listPiSessionFilesForCwd({ cwd, env: process.env });

  const writeOut = (record) => {
    stdout.write(`${JSON.stringify(record)}\n`);
  };

  writeOut({
    type: "ready",
    engine: bridge.engine,
    snapshot: bridge.snapshot,
    kairoModels: serializeKairoModelsForHost(kairoModels),
    sessions: sessionFiles.map(({ path, sessionId, label }) => ({
      path,
      sessionId,
      label
    })),
    sessionsNote:
      sessionFiles.length === 0
        ? "No Pi session files on disk for this cwd (RPC has no list_sessions; use new_session or create via Pi)."
        : null
  });

  bridge.onEvent((ev) => writeOut(ev));

  let buffer = "";
  let stopped = false;

  const applyEngineAndMaybeTranscript = async ({
    reloadTranscript = false,
    reapplyArchitect = false
  } = {}) => {
    const engine = await refreshHostEngine(bridge, cwd, {
      reapplyArchitect,
      loadKairoProviderModels: loadModels
    });
    writeOut({
      type: "engine",
      engine,
      modelLabel: formatEngineModelLabel(engine.model)
    });
    if (reloadTranscript) {
      await emitTranscriptFromPi(bridge, cwd, writeOut);
    }
    return engine;
  };

  const handleLine = async (line) => {
    if (!line.trim() || stopped) return;
    let cmd;
    try {
      cmd = JSON.parse(line);
    } catch (err) {
      writeOut({
        type: "error",
        message: `Invalid JSON command: ${err?.message ?? err}`
      });
      return;
    }
    const op = cmd?.op;
    try {
      if (op === "prompt") {
        const message = typeof cmd.message === "string" ? cmd.message : "";
        await bridge.request({ type: "prompt", message });
      } else if (op === "abort") {
        await bridge.request({ type: "abort" });
      } else if (op === "compact") {
        await bridge.request({ type: "compact" });
        writeOut({ type: "notice", message: "Compaction requested" });
        await applyEngineAndMaybeTranscript({ reloadTranscript: true });
      } else if (op === "cycle_model") {
        if (kairoModels.length === 0) {
          writeOut({
            type: "error",
            message: "No launchable Kairo projectTeam models to cycle"
          });
          return;
        }
        const currentId = bridge.engine?.model?.id ?? null;
        const next = pickNextKairoModel(kairoModels, currentId);
        if (!next) {
          writeOut({ type: "error", message: "Model cycle failed: no candidate" });
          return;
        }
        try {
          await bridge.request(kairoSetModelCommand(next));
          await applyEngineAndMaybeTranscript({ reloadTranscript: false });
        } catch (err) {
          writeOut({
            type: "error",
            message: `set_model failed: ${err?.message ?? err}`
          });
        }
      } else if (op === "new_session") {
        const result = await bridge.request({ type: "new_session" });
        if (result?.cancelled) {
          writeOut({ type: "notice", message: "New session cancelled by extension" });
          return;
        }
        sessionFiles = listPiSessionFilesForCwd({ cwd, env: process.env });
        writeOut({
          type: "sessions",
          sessions: sessionFiles.map(({ path, sessionId, label }) => ({
            path,
            sessionId,
            label
          }))
        });
        await applyEngineAndMaybeTranscript({
          reloadTranscript: true,
          reapplyArchitect: true
        });
      } else if (op === "switch_session") {
        const sessionPath = typeof cmd.sessionPath === "string" ? cmd.sessionPath : "";
        if (!sessionPath) {
          writeOut({ type: "error", message: "switch_session requires sessionPath" });
          return;
        }
        const result = await bridge.request({
          type: "switch_session",
          sessionPath
        });
        if (result?.cancelled) {
          writeOut({ type: "notice", message: "Session switch cancelled by extension" });
          return;
        }
        await applyEngineAndMaybeTranscript({
          reloadTranscript: true,
          reapplyArchitect: true
        });
      } else if (op === "switch_session_index") {
        sessionFiles = listPiSessionFilesForCwd({ cwd, env: process.env });
        const index = Number(cmd.index);
        if (!Number.isInteger(index) || index < 0 || index >= sessionFiles.length) {
          writeOut({
            type: "error",
            message:
              sessionFiles.length === 0
                ? "No Pi sessions on disk for this cwd"
                : `Session index out of range (0..${sessionFiles.length - 1})`
          });
          return;
        }
        const target = sessionFiles[index];
        const result = await bridge.request({
          type: "switch_session",
          sessionPath: target.path
        });
        if (result?.cancelled) {
          writeOut({ type: "notice", message: "Session switch cancelled by extension" });
          return;
        }
        await applyEngineAndMaybeTranscript({
          reloadTranscript: true,
          reapplyArchitect: true
        });
      } else if (op === "list_sessions") {
        sessionFiles = listPiSessionFilesForCwd({ cwd, env: process.env });
        writeOut({
          type: "sessions",
          sessions: sessionFiles.map(({ path, sessionId, label }) => ({
            path,
            sessionId,
            label
          })),
          sessionsNote:
            sessionFiles.length === 0
              ? "No Pi session files on disk for this cwd (RPC has no list_sessions)."
              : null
        });
      } else if (op === "stop") {
        stopped = true;
        await bridge.stop();
        process.exitCode = 0;
      } else if (op === "reload_snapshot") {
        const snapshot = await loadKairoWorkspaceSnapshot({ cwd });
        writeOut({ type: "snapshot", snapshot });
      } else {
        writeOut({ type: "error", message: `Unknown op: ${String(op)}` });
      }
    } catch (err) {
      writeOut({
        type: "error",
        message: err?.message ?? String(err)
      });
    }
  };

  stdin.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const idx = buffer.indexOf("\n");
      if (idx < 0) break;
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      void handleLine(line);
    }
  });

  await new Promise((resolve) => {
    if (stdin.readableEnded) {
      resolve();
      return;
    }
    stdin.on("end", resolve);
  });
}

function parseArgvCwd(argv) {
  const idx = argv.indexOf("--cwd");
  if (idx >= 0 && typeof argv[idx + 1] === "string") {
    return argv[idx + 1];
  }
  return process.cwd();
}

const isMain =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const cwd = parseArgvCwd(process.argv);
  runKairoUiRpcStdio({ cwd }).catch((err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exitCode = 1;
  });
}
