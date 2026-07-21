import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  buildPiLaunch,
  buildPiPermissionsArgs,
  checkPiAvailability,
  parsePiEventLine
} from "../src/global/runtime/execution-adapters/pi.js";
import { resolveExecutionAdapter } from "../src/global/runtime/execution-adapters/index.js";
import { normalizeAdapterEvent } from "../src/global/runtime/run-events.js";
import { startRun } from "../src/global/runtime/run-manager.js";
import { readRunEvents, readRunState } from "../src/global/runtime/run-store.js";
import { RUN_STATES } from "../src/global/runtime/run-types.js";

const OFFICIAL_EVENTS = [
  { type: "session", version: 3, id: "sess-1" },
  { type: "agent_start" },
  { type: "turn_start" },
  {
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "read",
    args: { path: "/secret/token" }
  },
  {
    type: "tool_execution_end",
    toolCallId: "t1",
    toolName: "read",
    result: { content: "SECRET_VALUE" },
    isError: false
  },
  {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "hello" }] }
  },
  {
    type: "turn_end",
    message: {
      role: "assistant",
      usage: { input: 11, output: 7, total: 18, cost: 0.02 }
    },
    toolResults: []
  },
  { type: "compaction_start", reason: "threshold" },
  { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 10, errorMessage: "tmp" },
  { type: "agent_end", messages: [] }
];

test("pi launch uses json mode, optional model, and read-only tools", () => {
  const launch = buildPiLaunch({
    task: "Review this repository",
    cwd: "/tmp",
    model: "anthropic/claude-sonnet-4",
    permissions: ["read-only"]
  });

  assert.equal(launch.command, "pi");
  assert.deepEqual(launch.args.slice(0, 4), ["--mode", "json", "--no-session", "--tools"]);
  assert.equal(launch.args[4], "read,grep,find,ls");
  assert.ok(launch.args.includes("--model"));
  assert.ok(launch.args.includes("anthropic/claude-sonnet-4"));
  assert.equal(launch.args.at(-1), "Review this repository");
  assert.ok(!launch.args.includes("--approve"));
});

test("pi permissions reject non read-only aliases", () => {
  assert.deepEqual(buildPiPermissionsArgs([]), []);
  assert.throws(() => buildPiPermissionsArgs(["force"]), /read-only|never translated to --approve/i);
  assert.throws(() => buildPiPermissionsArgs(["yolo"]), /read-only/);
  assert.throws(() => buildPiLaunch({ task: "x", permissions: ["all"] }), /read-only/);
});

test("pi compatibility probe requires --mode and --no-session", () => {
  const missing = checkPiAvailability({
    isAvailableImpl: () => false,
    probeImpl: () => ({ ok: true, stdout: "usage", stderr: "", status: 0 })
  });
  assert.equal(missing.available, false);
  assert.equal(missing.launchable, false);

  const incompatible = checkPiAvailability({
    isAvailableImpl: () => true,
    probeImpl: () => ({ ok: true, stdout: "pi --print only", stderr: "", status: 0 })
  });
  assert.equal(incompatible.available, true);
  assert.equal(incompatible.compatible, false);
  assert.equal(incompatible.launchable, false);
  assert.match(incompatible.reason ?? "", /--mode|--no-session/);

  const compatible = checkPiAvailability({
    isAvailableImpl: () => true,
    probeImpl: () => ({
      ok: true,
      stdout: "Options:\n  --mode json\n  --no-session\n",
      stderr: "",
      status: 0
    })
  });
  assert.equal(compatible.available, true);
  assert.equal(compatible.compatible, true);
  assert.equal(compatible.launchable, true);
});

test("pi NDJSON maps tools, usage, transcript opt-in, and redacts payloads", () => {
  const adapter = resolveExecutionAdapter("pi");
  const toolStart = parsePiEventLine(JSON.stringify(OFFICIAL_EVENTS[3]));
  assert.equal(toolStart.type, "tool_call");
  assert.equal(toolStart.tool_name, "read");
  assert.equal(toolStart.args, undefined);

  const toolEnd = parsePiEventLine(JSON.stringify(OFFICIAL_EVENTS[4]));
  assert.equal(toolEnd.type, "tool_result");
  assert.equal(toolEnd.result, undefined);

  const assistant = parsePiEventLine(JSON.stringify(OFFICIAL_EVENTS[5]));
  assert.equal(assistant.type, "assistant");

  const usage = parsePiEventLine(JSON.stringify(OFFICIAL_EVENTS[6]));
  assert.equal(usage.type, "usage");
  assert.equal(usage.inputTokens, 11);
  assert.equal(usage.cost, 0.02);

  const compaction = parsePiEventLine(JSON.stringify(OFFICIAL_EVENTS[7]));
  assert.equal(compaction.type, "system");
  assert.equal(compaction.kind, "compaction_start");

  const normalizedTool = normalizeAdapterEvent("pi", toolStart, { captureTranscript: false });
  assert.equal(normalizedTool.type, "agent.tool_call");
  assert.ok(!JSON.stringify(normalizedTool).includes("SECRET"));

  const withTranscript = normalizeAdapterEvent("pi", assistant, { captureTranscript: true });
  assert.equal(withTranscript.type, "agent.assistant");
  assert.equal(adapter.capabilities.transcript, true);
});

test("pi run supervises official events, cancel path, and non-zero exit", async () => {
  const binDir = await mkdtemp(join(tmpdir(), "kairo-pi-bin-"));
  await writeFile(
    join(binDir, "pi"),
    "#!/bin/sh\nif [ \"$1\" = \"--help\" ]; then echo '  --mode json'; echo '  --no-session'; exit 0; fi\nexit 0\n",
    "utf8"
  );
  await chmod(join(binDir, "pi"), 0o755);
  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${binDir}${delimiter}${previousPath}`;

  try {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-pi-run-"));
    const lines = OFFICIAL_EVENTS.map((event) => JSON.stringify(event));

    const createFakeSpawn = (exitCode = 0) => (_command, _args) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 9001;
      child.kill = () => child.emit("close", 130);
      setImmediate(() => {
        for (const line of lines) child.stdout.emit("data", `${line}\n`);
        child.emit("close", exitCode);
      });
      return child;
    };

    const { runId, completion } = await startRun({
      homeDir,
      agentId: "pi",
      task: "Review this repository",
      cwd: homeDir,
      cliVersion: "0.6.0",
      permissions: ["read-only"],
      model: "test-model",
      spawnImpl: createFakeSpawn(0)
    });

    const final = await completion;
    const events = await readRunEvents(homeDir, runId);
    assert.equal(final.state, RUN_STATES.COMPLETED);
    assert.ok(events.some((event) => event.type === "agent.tool_call"));
    assert.ok(events.some((event) => event.type === "agent.tool_result"));
    assert.ok(events.some((event) => event.type === "agent.token_usage"));
    assert.ok(events.some((event) => event.type === "agent.system"));
    assert.ok(!JSON.stringify(events).includes("SECRET_VALUE"));
    assert.ok(!JSON.stringify(events).includes("/secret/token"));

    const failedHome = await mkdtemp(join(tmpdir(), "kairo-pi-fail-"));
    const failed = await startRun({
      homeDir: failedHome,
      agentId: "pi",
      task: "boom",
      cwd: failedHome,
      cliVersion: "0.6.0",
      spawnImpl: createFakeSpawn(2)
    });
    const failedFinal = await failed.completion;
    assert.equal((await readRunState(failedHome, failedFinal.runId)).state, RUN_STATES.FAILED);
    assert.equal(failedFinal.exitCode, 2);
  } finally {
    process.env.PATH = previousPath;
  }
});
