import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureKairoAskAgent, KAIRO_ASK_AGENT_CONFIG, KAIRO_ASK_AGENT_NAME, resolveOpencodeConfigPath
} from "../src/global/intelligence/opencode-ask-agent.js";

test("resolveOpencodeConfigPath points at the real global opencode.json under the given home dir", () => {
  assert.equal(resolveOpencodeConfigPath("/home/kal-el"), "/home/kal-el/.config/opencode/opencode.json");
});

test("creates a fresh config (with $schema) when none exists yet — a missing file is a normal first-run state, never an error", async () => {
  const writes = [];
  const result = await ensureKairoAskAgent({
    homeDir: "/home/kal-el",
    readFileImpl: async () => { const error = new Error("ENOENT"); error.code = "ENOENT"; throw error; },
    writeAtomicJsonImpl: async (path, value) => { writes.push({ path, value }); }
  });
  assert.equal(result.changed, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value.$schema, "https://opencode.ai/config.json");
  assert.deepEqual(writes[0].value.agent[KAIRO_ASK_AGENT_NAME], KAIRO_ASK_AGENT_CONFIG);
});

test("a real read failure that isn't ENOENT is never swallowed — never silently overwrites a config that just failed to read for another reason", async () => {
  await assert.rejects(
    () => ensureKairoAskAgent({
      homeDir: "/home/kal-el",
      readFileImpl: async () => { throw new Error("EACCES: permission denied"); }
    }),
    /permission denied/
  );
});

test("merges non-destructively: every other real key (other agents, MCP config, etc.) survives byte-for-byte, only the kairo-ask agent is added", async () => {
  const existing = {
    $schema: "https://opencode.ai/config.json",
    mcp: { someServer: { command: "foo" } },
    agent: { explore: { mode: "subagent", model: "opencode/kimi-k3", permission: { bash: "deny" } } }
  };
  const writes = [];
  await ensureKairoAskAgent({
    homeDir: "/home/kal-el",
    readFileImpl: async () => JSON.stringify(existing),
    writeAtomicJsonImpl: async (path, value) => { writes.push(value); }
  });
  const written = writes[0];
  assert.deepEqual(written.mcp, existing.mcp, "unrelated top-level keys must survive untouched");
  assert.deepEqual(written.agent.explore, existing.agent.explore, "every other real agent must survive untouched");
  assert.deepEqual(written.agent[KAIRO_ASK_AGENT_NAME], KAIRO_ASK_AGENT_CONFIG);
});

test("idempotent: a config that already carries the exact current kairo-ask agent is never rewritten", async () => {
  const existing = {
    $schema: "https://opencode.ai/config.json",
    agent: { [KAIRO_ASK_AGENT_NAME]: KAIRO_ASK_AGENT_CONFIG }
  };
  const writes = [];
  const result = await ensureKairoAskAgent({
    homeDir: "/home/kal-el",
    readFileImpl: async () => JSON.stringify(existing),
    writeAtomicJsonImpl: async (path, value) => { writes.push(value); }
  });
  assert.equal(result.changed, false);
  assert.equal(writes.length, 0, "no real write when the agent already matches — never a needless file touch");
});

test("self-heals a drifted kairo-ask agent (e.g. an older shape) back to the current real config", async () => {
  const existing = {
    $schema: "https://opencode.ai/config.json",
    agent: { [KAIRO_ASK_AGENT_NAME]: { __managed_by: "kairo", mode: "primary", permission: { bash: "deny" } } }
  };
  const writes = [];
  const result = await ensureKairoAskAgent({
    homeDir: "/home/kal-el",
    readFileImpl: async () => JSON.stringify(existing),
    writeAtomicJsonImpl: async (path, value) => { writes.push(value); }
  });
  assert.equal(result.changed, true);
  assert.deepEqual(writes[0].agent[KAIRO_ASK_AGENT_NAME], KAIRO_ASK_AGENT_CONFIG);
});

test("REGRESSION: the real agent config never carries __managed_by — verified live that opencode's real upstream API rejects it as an unsupported parameter", () => {
  assert.equal(Object.hasOwn(KAIRO_ASK_AGENT_CONFIG, "__managed_by"), false);
});

test("the real agent config denies bash/edit/task/write and never sets a model (the real model always comes from askOpencode's own --model flag per call)", () => {
  assert.deepEqual(KAIRO_ASK_AGENT_CONFIG.permission, { bash: "deny", edit: "deny", task: "deny", write: "deny" });
  assert.equal(Object.hasOwn(KAIRO_ASK_AGENT_CONFIG, "model"), false);
});
