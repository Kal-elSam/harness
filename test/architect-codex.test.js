import test from "node:test";
import assert from "node:assert/strict";
import {
  ARCHITECT_CODEX_ERRORS,
  buildArchitectCodexArgs,
  buildArchitectCodexEnv,
  buildArchitectPrompt,
  parseArchitectCodexJsonl,
  runArchitectCodex,
  verifyCodexSubscriptionAuth
} from "../src/global/architect/architect-codex.js";

const jsonl = (events) => `${events.map(JSON.stringify).join("\n")}\n`;

test("architect Codex invocation is read-only, ephemeral, bounded, and subscription-authenticated", async () => {
  const args = buildArchitectCodexArgs({ cwd: "/repo", model: "gpt-x" });
  assert.deepEqual(args.slice(0, 3), ["--ask-for-approval", "never", "exec"]);
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(args.at(-1), "-");
  assert.match(buildArchitectPrompt("Add auth"), /Do not modify files/);
  const boundedPrompt = buildArchitectPrompt("Add auth", {
    contextPack: { systemPrompt: "## AGENTS.md\nUse TDD." }
  });
  assert.match(boundedPrompt, /context pack below as primary evidence/);
  assert.match(boundedPrompt, /Do not broadly scan the repository/);
  assert.match(boundedPrompt, /Use TDD/);
  assert.equal(buildArchitectCodexEnv({
    HOME: "/home", PATH: "/bin", CODEX_HOME: "/codex",
    OPENAI_API_KEY: "paid", OPENAI_BASE_URL: "https://paid.example"
  }).OPENAI_API_KEY, undefined);

  let captured;
  const result = await runArchitectCodex({
    task: "Add auth", cwd: "/repo", model: "gpt-x",
    contextPack: { systemPrompt: "bounded evidence" },
    env: { PATH: "/bin", HOME: "/home", OPENAI_API_KEY: "subscription-cli-does-not-need-this" },
    verifyAuth: async () => ({ mode: "chatgpt" }),
    runProcess: async (input) => {
      captured = input;
      return {
        status: 0, signal: null, timedOut: false, terminationFailed: false,
        stdoutOverflow: false, stderrOverflow: false, stderr: "",
        stdout: jsonl([
          { type: "item.completed", item: { type: "agent_message", text: "## Plan\nShip it" } },
          { type: "turn.completed", usage: { input_tokens: 4, output_tokens: 6 } }
        ])
      };
    }
  });
  assert.equal(captured.command, "codex");
  assert.equal(captured.env.OPENAI_API_KEY, undefined);
  assert.equal(captured.cwd, "/repo");
  assert.match(captured.stdin, /Add auth/);
  assert.match(captured.stdin, /bounded evidence/);
  assert.equal(result.plan, "## Plan\nShip it");
  assert.equal(result.usage.totalTokens, 10);
});

test("architect auth preflight accepts only explicit ChatGPT login evidence", async () => {
  const result = await verifyCodexSubscriptionAuth({
    env: { PATH: "/bin", HOME: "/home", OPENAI_API_KEY: "must-be-removed" },
    runProcess: async (input) => {
      assert.deepEqual(input.args, ["login", "status"]);
      assert.equal(input.env.OPENAI_API_KEY, undefined);
      assert.equal(input.timeoutMs, 10_000);
      return {
        status: 0, signal: null, timedOut: false, terminationFailed: false,
        stdoutOverflow: false, stderrOverflow: false,
        stdout: "", stderr: "Logged in using ChatGPT\n"
      };
    }
  });
  assert.equal(result.mode, "chatgpt");

  for (const evidence of ["Logged in using an API key", "Logged in", "", "Logged in using ChatGPT API key"]) {
    await assert.rejects(() => verifyCodexSubscriptionAuth({
      runProcess: async () => ({
        status: 0, signal: null, timedOut: false, terminationFailed: false,
        stdoutOverflow: false, stderrOverflow: false, stdout: evidence, stderr: ""
      })
    }), (error) => error.code === ARCHITECT_CODEX_ERRORS.SUBSCRIPTION_AUTH_REQUIRED);
  }
});

test("architect Codex parser fails closed on malformed, missing, and stream errors", () => {
  assert.throws(() => parseArchitectCodexJsonl("{bad}\n"), (e) => e.code === ARCHITECT_CODEX_ERRORS.INVALID_JSONL);
  assert.throws(() => parseArchitectCodexJsonl(jsonl([{ type: "turn.started" }])), (e) => e.code === ARCHITECT_CODEX_ERRORS.MISSING_PLAN);
  assert.throws(() => parseArchitectCodexJsonl(jsonl([
    { type: "item.completed", item: { type: "agent_message", text: "plan" } },
    { type: "error", message: "late error" }
  ])), (e) => e.code === ARCHITECT_CODEX_ERRORS.STREAM_ERROR);
});
