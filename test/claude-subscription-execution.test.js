import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClaudeExecutionEnv, buildClaudeLaunch, verifyClaudeSubscriptionAuth
} from "../src/global/runtime/execution-adapters/claude.js";

const okResult = (status) => ({
  status: 0, signal: null, timedOut: false, terminationFailed: false,
  stdoutOverflow: false, stderrOverflow: false, stderr: "", stdout: JSON.stringify(status)
});

test("Claude execution strips API, cloud, and alternate-provider credentials", () => {
  const env = buildClaudeExecutionEnv({
    PATH: "/bin", HOME: "/home/me", ANTHROPIC_API_KEY: "secret",
    ANTHROPIC_BASE_URL: "https://payg", CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_USE_FOUNDRY: "1",
    AWS_ACCESS_KEY_ID: "secret", AWS_PROFILE: "paid", GOOGLE_APPLICATION_CREDENTIALS: "secret",
    AZURE_API_KEY: "secret"
  });
  assert.deepEqual({ ...env }, { PATH: "/bin", HOME: "/home/me" });
});

test("Claude subscription preflight accepts only first-party subscription auth", async () => {
  let captured;
  const accepted = await verifyClaudeSubscriptionAuth({
    env: { PATH: "/bin", HOME: "/home/me", ANTHROPIC_API_KEY: "secret" },
    runProcess: async (input) => {
      captured = input;
      return okResult({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "pro" });
    }
  });
  assert.equal(accepted.mode, "subscription");
  assert.deepEqual(captured.args, ["auth", "status"]);
  assert.equal(captured.env.ANTHROPIC_API_KEY, undefined);

  for (const status of [
    { loggedIn: false, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "pro" },
    { loggedIn: true, authMethod: "apiKey", apiProvider: "firstParty", subscriptionType: "pro" },
    { loggedIn: true, authMethod: "claude.ai", apiProvider: "bedrock", subscriptionType: "pro" },
    { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "free" }
  ]) {
    await assert.rejects(() => verifyClaudeSubscriptionAuth({ runProcess: async () => okResult(status) }), /requires a first-party/);
  }
  await assert.rejects(() => verifyClaudeSubscriptionAuth({
    runProcess: async () => ({ ...okResult({}), stdout: "not-json" })
  }), /valid JSON/);
});

test("Claude safe launch uses official auto permissions without bypass flags", () => {
  const launch = buildClaudeLaunch({ task: "Implement plan", cwd: "/repo", permissions: [] });
  assert.deepEqual(launch.args, [
    "-p", "--output-format", "stream-json", "--permission-mode", "auto",
    "--permission-prompts", "none", "Implement plan"
  ]);
  assert.equal(launch.args.includes("--force"), false);
  assert.equal(launch.args.includes("--dangerously-skip-permissions"), false);
});
