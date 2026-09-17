import test from "node:test";
import assert from "node:assert/strict";
import { runConversationCli } from "../src/global/conversation/cli.js";

function silenceConsole(fn) {
  const original = console.log;
  const writes = [];
  console.log = (value) => writes.push(value);
  return fn(writes).finally(() => { console.log = original; });
}

test("conversation execute without --role fails fast with a clear message, before ever calling the service — PROJECT TEAM is the sole authority, role is never optional", async () => {
  const service = {
    planExecution: async () => { throw new Error("must never be called without --role"); },
    executePlan: async () => { throw new Error("must never be called without --role"); }
  };
  await assert.rejects(
    () => silenceConsole(() => runConversationCli({ conversationAction: "execute", cwd: "/repo", taskId: "task-id", json: true }, { service })),
    /Missing --role/
  );
});

test("conversation execute --role <role> without --confirm only previews — never reserves quota or launches a run", async () => {
  const calls = [];
  const service = {
    planExecution: async (args) => { calls.push(["preview", args]); return { decision: "ROUTED", role: "Builder", provider: "codex", model: "gpt-6-astra", why: "reasoning task", confirmationTarget: { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex::gpt-6-astra" } }; },
    executePlan: async () => { throw new Error("must never be called without --confirm"); }
  };
  await silenceConsole(async () => {
    const result = await runConversationCli({ conversationAction: "execute", cwd: "/repo", taskId: "task-id", role: "Builder", json: true }, { service });
    assert.equal(result.decision, "ROUTED");
    assert.deepEqual(calls, [["preview", { cwd: "/repo", taskId: "task-id", role: "Builder" }]]);
  });
});

test("conversation execute --role <role> --confirm revalidates and executes with the confirmationTarget, never a free-form model override", async () => {
  const calls = [];
  const confirmationTarget = { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex::gpt-6-astra" };
  const service = {
    planExecution: async (args) => { calls.push(["preview", args]); return { decision: "ROUTED", role: "Builder", provider: "codex", model: "gpt-6-astra", why: "reasoning task", confirmationTarget }; },
    executePlan: async (args) => { calls.push(["execute", args]); return { taskId: "task-id", execution: { state: "starting" } }; }
  };
  await silenceConsole(async () => {
    await runConversationCli({ conversationAction: "execute", cwd: "/repo", taskId: "task-id", role: "Builder", confirm: true, model: "should-be-ignored", json: true }, { service });
  });
  assert.deepEqual(calls, [
    ["preview", { cwd: "/repo", taskId: "task-id", role: "Builder" }],
    ["execute", { cwd: "/repo", taskId: "task-id", confirmationTarget }]
  ]);
});

test("conversation execute --role <role> --confirm rejects when the fresh preview has no confirmationTarget (blocked or manual) — never silently substitutes", async () => {
  const service = {
    planExecution: async () => ({ decision: "MANUAL_HANDOFF", role: "Builder", provider: "cursor", model: "cursor-model", why: "cursor isn't executable by Kairo automatically", confirmationTarget: null }),
    executePlan: async () => { throw new Error("must never be called"); }
  };
  await assert.rejects(
    () => silenceConsole(() => runConversationCli({ conversationAction: "execute", cwd: "/repo", taskId: "task-id", role: "Builder", confirm: true, json: true }, { service })),
    /cursor isn't executable by Kairo automatically/
  );
});

test("conversation execute --role <role> --confirm rejects a WAIT_FOR_PROJECT_TEAM preview with no eligible alternative", async () => {
  const service = {
    planExecution: async () => ({ decision: "WAIT_FOR_PROJECT_TEAM", role: "Builder", provider: null, model: null, why: "no automatic alternative is available for Builder right now", confirmationTarget: null }),
    executePlan: async () => { throw new Error("must never be called"); }
  };
  await assert.rejects(
    () => silenceConsole(() => runConversationCli({ conversationAction: "execute", cwd: "/repo", taskId: "task-id", role: "Builder", confirm: true, json: true }, { service })),
    /no automatic alternative/
  );
});
