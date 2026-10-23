// No model call. Run from an unsandboxed parent shell: a nested Codex seatbelt
// may reject sandbox_apply or creating the home-outside probe directory.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { verifyCodexWriteSandbox, buildCodexWriteProfile } from "../src/global/runtime/codex-write-containment.js";
import codex from "../src/global/runtime/execution-adapters/codex.js";

const probeVersion = spawnSync("codex", ["sandbox", "--help"], { encoding: "utf8" });
const skip = process.platform !== "darwin" || probeVersion.status !== 0
  ? "macOS and a codex CLI with the `sandbox` subcommand are required" : false;

test("live cwd-only Codex write canary denies home-outside, TMPDIR and /tmp without leaks", { skip }, async () => {
  const root = realpathSync(await mkdtemp(join(homedir(), ".kairo-write-live-")));
  try {
    assert.equal((await verifyCodexWriteSandbox({ cwd: root })).verified, true);
    assert.deepEqual(await readdir(root), []);
    const profile = buildCodexWriteProfile(root);
    const launch = codex.buildLaunch({ task: "t", cwd: root, requireVerifiedWriteContainment: true });
    assert.ok(launch.args.includes(profile.configArgs[1]));
    assert.equal(launch.args.includes("--approve-for-me"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
