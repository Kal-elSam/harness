/**
 * Contract: OS wrap for delegated Codex writes reuses sandbox-exec around the
 * existing executor launch — adapted allowlist (workspace + provider home + temps),
 * not a Bootstrap snapshot copy, and never a second executor.
 */
import test from "node:test";
import assert from "node:assert/strict";
import codex from "../src/global/runtime/execution-adapters/codex.js";
import {
  buildDelegatedWriteSandboxProfile,
  isDelegatedWriteOsSandboxSupported,
  rewriteCodexArgsForOuterOsSandbox,
  wrapCodexLaunchWithOsSandbox
} from "../src/global/runtime/codex-delegated-sandbox.js";

test("isDelegatedWriteOsSandboxSupported is false on non-macOS without probing", async () => {
  const supported = await isDelegatedWriteOsSandboxSupported({
    platform: "linux",
    access: async () => {
      throw new Error("must not be called");
    }
  });
  assert.equal(supported, false);
});

test("delegated write SBPL allows workspace + CODEX_HOME + temps; excludes foreign paths", async () => {
  const workspaceRoot = "/tmp/kairo-wt-delegated-1/tree";
  const profile = await buildDelegatedWriteSandboxProfile(
    { workspaceRoot, codexHome: "/Users/kal-el/.codex" },
    { realpath: async (p) => p }
  );
  assert.match(profile, /\(deny default\)/);
  assert.match(profile, /\(subpath "\/tmp\/kairo-wt-delegated-1\/tree"\)/);
  assert.match(profile, /\(subpath "\/Users\/kal-el\/\.codex"\)/);
  assert.match(profile, /\(subpath "\/private\/tmp"\)/);
  assert.match(profile, /\(subpath "\/private\/var\/folders"\)/);
  assert.doesNotMatch(profile, /snapshotRoot/);
  const writeBlock = profile.split("(allow file-write*")[1];
  assert.doesNotMatch(writeBlock, /\/Users\/someone\/other-repo/);
  assert.doesNotMatch(writeBlock, /\(subpath "\/etc"\)/);
});

test("rewriteCodexArgsForOuterOsSandbox drops provider sandbox flags and forces bypass", () => {
  assert.deepEqual(
    rewriteCodexArgsForOuterOsSandbox([
      "exec", "--json", "--approve-for-me", "Implement plan"
    ]),
    ["exec", "--dangerously-bypass-approvals-and-sandbox", "--json", "Implement plan"]
  );
  assert.deepEqual(
    rewriteCodexArgsForOuterOsSandbox([
      "exec", "--json", "--sandbox", "workspace-write", "--approve-for-me", "t"
    ]),
    ["exec", "--dangerously-bypass-approvals-and-sandbox", "--json", "t"]
  );
});

test("wrapCodexLaunchWithOsSandbox wraps existing adapter launch — no second executor", () => {
  const launch = codex.buildLaunch({
    task: "Implement plan",
    cwd: "/tmp/kairo-wt-delegated-1/tree",
    permissions: []
  });
  const wrapped = wrapCodexLaunchWithOsSandbox(launch, {
    profilePath: "/tmp/kairo-wt-delegated-1/profile.sb"
  });
  assert.equal(wrapped.command, "sandbox-exec");
  assert.equal(wrapped.cwd, launch.cwd);
  assert.deepEqual(wrapped.args.slice(0, 3), [
    "-f", "/tmp/kairo-wt-delegated-1/profile.sb", "codex"
  ]);
  assert.ok(wrapped.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(wrapped.args.includes("--approve-for-me"), false);
  assert.equal(wrapped.args.includes("--sandbox"), false);
  assert.ok(wrapped.args.includes("Implement plan"));
});

test("wrap helper refuses non-Codex launches", () => {
  assert.throws(
    () => wrapCodexLaunchWithOsSandbox(
      { command: "claude", args: [], cwd: "/x" },
      { profilePath: "/tmp/p.sb" }
    ),
    /expects a Codex execution launch/
  );
});
