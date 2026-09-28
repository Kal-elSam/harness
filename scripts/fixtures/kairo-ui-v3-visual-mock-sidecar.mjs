#!/usr/bin/env node
/**
 * V3 visual fixture mock sidecar — FIXTURE mock — not live provider.
 *
 * Ready with populated agents (idle+blocked), USAGE segments, project
 * label `V3-FIXTURE`. Emits conversation (user/assistant/thinking),
 * tool_execution_* success, notice/error, plans timeline, and an
 * extension_ui select dialog. Answers plans.list / set_mode enough for
 * capture. Logs with FIXTURE prefix. Never contacts Pi.
 *
 * Args: --cwd <path> (label only)
 * Env: KAIRO_V3_MOCK_LOG, KAIRO_V3_MOCK_AUTO=1 (default) auto-inject after ready.
 */
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
let cwd = process.cwd();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--cwd" && args[i + 1]) cwd = args[++i];
}

const logPath = process.env.KAIRO_V3_MOCK_LOG || "";
const log = (line) => {
  if (!logPath) return;
  try {
    appendFileSync(logPath, `FIXTURE ${line}\n`);
  } catch {
    // best-effort evidence only
  }
};

const write = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
  if (record?.type) log(`out ${record.type}`);
};

const projectLabel = "V3-FIXTURE";

write({
  type: "ready",
  engine: {
    status: "connected",
    reason: null,
    sessionId: "v3-fixture-session-1",
    model: {
      id: "mock-model",
      provider: "kairo",
      displayName: "FIXTURE mock — not live provider"
    }
  },
  snapshot: {
    project: { label: projectLabel, root: cwd },
    agents: [
      {
        id: "architect",
        label: "Architect",
        state: "idle",
        detail: "idle",
        stateReason: null
      },
      {
        id: "builder",
        label: "Builder",
        state: "blocked",
        detail: "rate limited",
        stateReason: "rate limited by provider (FIXTURE)"
      }
    ],
    team: { state: "active", rows: [] },
    subscriptions: {
      state: "ready",
      segments: ["Codex mock 96%", "Claude mock 80%"]
    }
  },
  sessions: [
    {
      path: "/tmp/v3-fixture-session-1.jsonl",
      sessionId: "v3-fixture-session-1",
      label: "v3-fixture-1",
      kairoSessionId: "kairo-v3-fixture-1"
    }
  ],
  draft: null,
  kairoModels: [],
  mode: "plan"
});

write({ type: "mode", mode: "plan" });

let injected = false;
function injectVisualFixtureEvents() {
  if (injected) return;
  injected = true;
  log("inject_visual_fixture_events");

  write({
    type: "message",
    role: "user",
    content: "FIXTURE: outline the auth plan"
  });
  write({
    type: "assistantMessageEvent",
    event: { type: "thinking_start" }
  });
  write({
    type: "assistantMessageEvent",
    event: {
      type: "thinking_delta",
      delta: "FIXTURE thinking — weighing OAuth vs session cookies"
    }
  });
  write({
    type: "assistantMessageEvent",
    event: { type: "thinking_end" }
  });
  write({
    type: "assistantMessageEvent",
    event: { type: "text_start" }
  });
  write({
    type: "assistantMessageEvent",
    event: {
      type: "text_delta",
      delta: "FIXTURE assistant — propose OAuth login with refresh tokens."
    }
  });
  write({
    type: "assistantMessageEvent",
    event: { type: "text_end" }
  });

  write({
    type: "tool_execution_start",
    toolCallId: "call_v3_1",
    toolName: "Read"
  });
  write({
    type: "tool_execution_end",
    toolCallId: "call_v3_1",
    toolName: "Read",
    isError: false,
    result: {
      content: [{ type: "text", text: "FIXTURE tool ok — src/auth/oauth.ts" }]
    }
  });
  write({
    type: "tool_execution_start",
    toolCallId: "call_v3_2",
    toolName: "Grep"
  });
  write({
    type: "tool_execution_end",
    toolCallId: "call_v3_2",
    toolName: "Grep",
    isError: false,
    result: { content: [{ type: "text", text: "FIXTURE tool ok — 3 matches" }] }
  });

  write({
    type: "plans",
    timeline: [
      {
        taskId: "v3-plan-aaaaaaaa-1111",
        taskText: "FIXTURE plan — OAuth login flow",
        state: "awaiting_approval",
        approval: "not_decided",
        planReady: true,
        execution: { state: "not_started", active: false }
      },
      {
        taskId: "v3-plan-bbbbbbbb-2222",
        taskText: "FIXTURE plan — approved earlier",
        state: "approved",
        approval: "approved",
        planReady: true,
        execution: { state: "not_started", active: false }
      }
    ],
    projectTeamRoles: ["Architect", "Builder"]
  });

  write({
    type: "extension_ui_request",
    id: "v3-dialog-1",
    method: "select",
    title: "FIXTURE extension_ui select",
    options: ["Allow", "Block", "Ask later"]
  });

  write({
    type: "notice",
    message: "FIXTURE mock — not live provider · notice chrome"
  });
  write({
    type: "error",
    message: "FIXTURE error — provider timeout (mock)"
  });
}

if (process.env.KAIRO_V3_MOCK_AUTO !== "0") {
  setTimeout(injectVisualFixtureEvents, 150);
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

  if (op === "set_mode") {
    const mode = typeof cmd.mode === "string" ? cmd.mode : "plan";
    write({ type: "mode", mode });
    write({
      type: "notice",
      message: `FIXTURE set_mode → ${mode}`
    });
    return;
  }

  if (op === "plans.list") {
    write({
      type: "plans",
      timeline: [
        {
          taskId: "v3-plan-aaaaaaaa-1111",
          taskText: "FIXTURE plan — OAuth login flow",
          state: "awaiting_approval",
          approval: "not_decided",
          planReady: true,
          execution: { state: "not_started", active: false }
        },
        {
          taskId: "v3-plan-bbbbbbbb-2222",
          taskText: "FIXTURE plan — approved earlier",
          state: "approved",
          approval: "approved",
          planReady: true,
          execution: { state: "not_started", active: false }
        }
      ],
      projectTeamRoles: ["Architect", "Builder"]
    });
    return;
  }

  if (op === "plans.show") {
    write({
      type: "plan_detail",
      taskId: cmd.taskId ?? "v3-plan-aaaaaaaa-1111",
      state: "awaiting_approval",
      markdown:
        "# FIXTURE plan\n\nOAuth login with refresh tokens.\n\n_(FIXTURE mock — not live provider)_"
    });
    return;
  }

  if (op === "plans.decide") {
    write({
      type: "plan_decision",
      taskId: cmd.taskId ?? "v3-plan-aaaaaaaa-1111",
      decision: cmd.decision ?? "approved",
      ok: true
    });
    return;
  }

  if (op === "extension_ui_response") {
    log(
      `dialog_response id=${cmd.id ?? "?"} cancelled=${Boolean(cmd.cancelled)} value=${cmd.value ?? ""}`
    );
    write({
      type: "notice",
      message: `FIXTURE got extension_ui_response id=${cmd.id ?? "?"}`
    });
    return;
  }

  if (op === "list_sessions" || op === "switch_session_index" || op === "switch_session") {
    write({
      type: "sessions",
      sessions: [
        {
          path: "/tmp/v3-fixture-session-1.jsonl",
          sessionId: "v3-fixture-session-1",
          label: "v3-fixture-1",
          kairoSessionId: "kairo-v3-fixture-1"
        }
      ]
    });
    write({ type: "draft", text: "", kairoSessionId: "kairo-v3-fixture-1" });
    return;
  }

  if (op === "stop") {
    log("stop");
    process.exit(0);
  }

  injectVisualFixtureEvents();
});

rl.on("close", () => {
  process.exit(0);
});
