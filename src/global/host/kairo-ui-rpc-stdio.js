/**
 * Thin JSONL sidecar: Rust kairo-ui ↔ openPiRpcBridge ↔ Pi RPC.
 *
 * stdin commands (one JSON object per LF-terminated line):
 *   { "op": "prompt", "message": "..." }
 *   { "op": "abort" }
 *   { "op": "stop" }
 *   { "op": "reload_snapshot" }
 *
 * stdout records (JSONL): { type: "ready", engine, snapshot? }, { type:
 * "snapshot", snapshot }, forwarded Pi
 * session events, { type: "error", message }, and bridge engine_unavailable.
 */

import { openPiRpcBridge } from "./pi-rpc-bridge.js";
import { loadKairoWorkspaceSnapshot } from "./workspace-snapshot.js";

/**
 * @param {object} [options]
 * @param {NodeJS.ReadableStream} [options.stdin]
 * @param {NodeJS.WritableStream} [options.stdout]
 * @param {string} [options.cwd]
 * @param {typeof openPiRpcBridge} [options.openBridge]
 */
export async function runKairoUiRpcStdio({
  stdin = process.stdin,
  stdout = process.stdout,
  cwd = process.cwd(),
  openBridge = openPiRpcBridge
} = {}) {
  const bridge = await openBridge({ cwd });

  const writeOut = (record) => {
    stdout.write(`${JSON.stringify(record)}\n`);
  };

  writeOut({
    type: "ready",
    engine: bridge.engine,
    snapshot: bridge.snapshot
  });

  bridge.onEvent((ev) => writeOut(ev));

  let buffer = "";
  let stopped = false;

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

import { fileURLToPath } from "node:url";

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
