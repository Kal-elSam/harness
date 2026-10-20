import test from "node:test";
import assert from "node:assert/strict";
import codex from "../src/global/runtime/execution-adapters/codex.js";

test("safe headless launch uses --approve-for-me only (installed CLI rejects --sandbox + --approve-for-me)", () => {
  const launch = codex.buildLaunch({ task: "Implement plan", cwd: "/repo", permissions: [] });
  assert.deepEqual(launch.args, ["exec", "--json", "--approve-for-me", "Implement plan"]);
  assert.equal(launch.args.includes("--sandbox"), false);
  assert.equal(launch.args.includes("workspace-write"), false);
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

test("strict preflight runs a fresh write canary every time and ordinary preflight does not", async () => {
  let count = 0;
  const context = { cwd: process.cwd(), requireVerifiedWriteContainment: true,
    verifyAuth: async () => ({ ok: true }),
    verifyWriteSandbox: async ({ cwd }) => { count++; return { verified: true, root: cwd }; } };
  const first = await codex.preflight(context);
  assert.equal(first.writeContainment.verified, true);
  await codex.preflight(context);
  assert.equal(count, 2);
  await codex.preflight({ ...context, requireVerifiedWriteContainment: false });
  assert.equal(count, 2);
  await assert.rejects(() => codex.preflight({ ...context, verifyWriteSandbox: async () => { throw new Error("denied"); } }), /denied/);
});
