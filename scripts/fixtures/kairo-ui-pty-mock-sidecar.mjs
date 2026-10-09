#!/usr/bin/env node
/**
 * Mock JSONL sidecar for Phase-3 PTY end-to-end.
 * Emits ready + sessions, then an extension_ui select dialog and tool events
 * after the first host op (or immediately after ready). Never talks to Pi.
 *
 * Args: --cwd <path> (ignored except for labeling)
 * Env: KAIRO_PTY_MOCK_AUTO=1 (default) auto-injects dialog+tools after ready.
 */
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
let cwd = process.cwd();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--cwd" && args[i + 1]) cwd = args[++i];
}

const logPath = process.env.KAIRO_PTY_MOCK_LOG || "";
const log = (line) => {
  if (!logPath) return;
  try {
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // best-effort evidence only
  }
};

const write = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
  if (record?.type) log(`out ${record.type}`);
};

const projectLabel =
  typeof cwd === "string" && cwd.length > 0
    ? cwd.split(/[/\\]/).filter(Boolean).at(-1) ?? "pty-e2e"
    : "pty-e2e";

write({
  type: "ready",
  engine: {
    status: "connected",
    reason: null,
    sessionId: "pty-mock-session-1",
    model: { id: "mock-model", provider: "kairo", displayName: "Mock" }
  },
  snapshot: {
    project: { label: projectLabel, root: cwd },
    agents: [],
    team: { state: "not_analyzed", rows: [] },
    subscriptions: { state: "ready", segments: ["Codex mock 100%"] }
  },
  sessions: [
    {
      path: "/tmp/pty-mock-session-1.jsonl",
      sessionId: "pty-mock-session-1",
      label: "pty-mock-1",
      kairoSessionId: null
    },
    {
      path: "/tmp/pty-mock-session-2.jsonl",
      sessionId: "pty-mock-session-2",
      label: "pty-mock-2",
      kairoSessionId: null
    }
  ],
  draft: null,
  kairoModels: []
});

let injected = false;
function injectDialogAndTools() {
  if (injected) return;
  injected = true;
  log("inject_dialog_and_tools");
  write({
    type: "extension_ui_request",
    id: "pty-dialog-1",
    method: "select",
    title: "PTY e2e dialog",
    options: ["Allow", "Block"]
  });
  write({
    type: "tool_execution_start",
    toolCallId: "call_pty_1",
    toolName: "Read"
  });
  write({
    type: "tool_execution_update",
    toolCallId: "call_pty_1",
    toolName: "Read",
    partialResult: { content: [{ type: "text", text: "reading…" }] }
  });
  write({
    type: "tool_execution_end",
    toolCallId: "call_pty_1",
    toolName: "Read",
    isError: false,
    result: { content: [{ type: "text", text: "pty-tool-ok" }] }
  });
}

if (process.env.KAIRO_PTY_MOCK_AUTO !== "0") {
  setTimeout(injectDialogAndTools, 200);
}

log("mock_start");
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    log(`in_unparsed ${line.slice(0, 80)}`);
    return;
  }
  const op = cmd?.op;
  log(`in ${op ?? "?"}`);
  if (op === "extension_ui_response") {
    log(`dialog_response id=${cmd.id ?? "?"} cancelled=${Boolean(cmd.cancelled)} value=${cmd.value ?? ""}`);
    write({
      type: "notice",
      message: `PTY mock got extension_ui_response id=${cmd.id ?? "?"} cancelled=${Boolean(cmd.cancelled)}`
    });
    return;
  }
  if (op === "list_sessions" || op === "switch_session_index" || op === "switch_session") {
    log(`session_op ${op}`);
    write({
      type: "sessions",
      sessions: [
        {
          path: "/tmp/pty-mock-session-1.jsonl",
          sessionId: "pty-mock-session-1",
          label: "pty-mock-1",
          kairoSessionId: null
        },
        {
          path: "/tmp/pty-mock-session-2.jsonl",
          sessionId: "pty-mock-session-2",
          label: "pty-mock-2",
          kairoSessionId: null
        }
      ]
    });
    write({ type: "draft", text: "", kairoSessionId: null });
    return;
  }
  if (op === "stop") {
    log("stop");
    process.exit(0);
  }
  injectDialogAndTools();
});

rl.on("close", () => {
  process.exit(0);
});
