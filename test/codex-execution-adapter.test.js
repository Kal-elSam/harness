import test from "node:test";
import assert from "node:assert/strict";
import codex from "../src/global/runtime/execution-adapters/codex.js";

test("safe headless launch sandboxes to the workspace and auto-reviews approvals instead of hanging on a human that can't respond", () => {
  const launch = codex.buildLaunch({ task: "Implement plan", cwd: "/repo", permissions: [] });
  assert.deepEqual(launch.args, ["exec", "--json", "--sandbox", "workspace-write", "--approve-for-me", "Implement plan"]);
  assert.equal(launch.args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
});

test("explicit yolo permission still uses the full dangerous bypass, not the safe default", () => {
  const launch = codex.buildLaunch({ task: "Implement plan", cwd: "/repo", permissions: ["yolo"] });
  assert.deepEqual(launch.args, ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "Implement plan"]);
});

// Preflight wiring to the real `codex login status` check (verifyCodexSubscriptionAuth,
// imported from architect-codex.js and passed as this adapter's `preflight`)
// is verified by direct manual smoke test rather than here: calling it for
// real inside the automated suite would spawn an external process and make
// the result depend on this machine's auth state. verifyCodexSubscriptionAuth's
// own behavior is already covered with injected fakes in architect-codex.test.js.
