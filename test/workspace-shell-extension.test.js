import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createKairoWorkspaceExtension,
  formatKairoWorkspaceLines
} from "../src/global/host/extension/index.js";

const snapshot = {
  project: { label: "agentic-harness" },
  session: { state: "bound", id: "11111111", title: "Ship workspace", mode: "agent" },
  team: {
    state: "active",
    assignments: [
      { role: "Builder", model: "GPT-6 Terra", via: "codex" },
      { role: "Reviewer", model: "MiniMax-M3", via: "opencode-go" }
    ]
  },
  usage: [{ provider: "codex", totalTokens: 2400 }],
  memory: { status: "configured" }
};

function fakePi() {
  const commands = new Map();
  const events = new Map();
  return {
    commands,
    events,
    pi: {
      registerCommand(name, definition) { commands.set(name, definition); },
      on(name, handler) { events.set(name, handler); }
    }
  };
}

test("workspace lines are compact Kairo facts, not host resource inventory", () => {
  assert.deepEqual(formatKairoWorkspaceLines(snapshot), [
    "KAIRO · agentic-harness · session 11111111 · agent",
    "TEAM · Builder: GPT-6 Terra via codex · Reviewer: MiniMax-M3 via opencode-go",
    "USAGE · codex 2400 tokens · MEMORY · configured",
    "Commands: /kairo /kairo-team /kairo-sessions /kairo-usage /kairo-route /kairo-memory"
  ]);
});

test("extension renders a Kairo status/widget on session start using the explicit host session", async () => {
  const { pi, events } = fakePi();
  const calls = [];
  createKairoWorkspaceExtension(pi, {
    env: { KAIRO_SESSION_ID: "11111111-1111-4111-8111-111111111111" },
    loadSnapshot: async (input) => {
      assert.equal(input.cwd, "/repo");
      assert.equal(input.sessionId, "11111111-1111-4111-8111-111111111111");
      return snapshot;
    }
  });

  await events.get("session_start")({}, {
    cwd: "/repo",
    ui: {
      setStatus: (...args) => calls.push(["status", ...args]),
      setWidget: (...args) => calls.push(["widget", ...args])
    }
  });

  assert.deepEqual(calls[0], ["status", "kairo", "Kairo · agentic-harness · agent"]);
  assert.deepEqual(calls[1], ["widget", "kairo-workspace", formatKairoWorkspaceLines(snapshot)]);
});

test("extension registers only Kairo workspace commands and refreshes their matching compact view", async () => {
  const { pi, commands } = fakePi();
  createKairoWorkspaceExtension(pi, { loadSnapshot: async () => snapshot });

  assert.deepEqual([...commands.keys()], [
    "kairo", "kairo-team", "kairo-sessions", "kairo-usage", "kairo-route", "kairo-memory"
  ]);

  const calls = [];
  await commands.get("kairo-team").handler("", {
    cwd: "/repo",
    ui: { setWidget: (...args) => calls.push(args) }
  });
  assert.deepEqual(calls, [["kairo-workspace", [
    "KAIRO TEAM · active",
    "Builder · GPT-6 Terra · codex",
    "Reviewer · MiniMax-M3 · opencode-go"
  ]]]);
});
