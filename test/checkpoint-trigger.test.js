import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { projectKeyForPath } from "../src/global/next/project-key.js";
import { runCheckpointTrigger } from "../src/global/session/checkpoint-trigger.js";

const bin = new URL("../bin/kairo.js", import.meta.url).pathname;
const scratch = [];
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), "kairo-ckpt-")); scratch.push(dir); return dir; };
after(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

const DOC = "# F\nBranch: feat/a. Runner: x\n\n## Tasks\n- [x] T1 first\n- [ ] T2 second\n\n## Log\n- L1";

function project({ doc = DOC, engram } = {}) {
  const root = tmp();
  mkdirSync(join(root, "odd", "tasks"), { recursive: true });
  if (doc !== null) writeFileSync(join(root, "odd", "tasks", "f.md"), doc);
  const homeDir = tmp();
  const state = { engram: [], err: "", out: "", at: new Date("2026-10-28T12:00:00Z"), head: "abc1234", headAgeS: 30 };
  const deps = {
    homeDir, env: {}, now: () => state.at,
    stdout: t => { state.out += t; }, stderr: t => { state.err += t; },
    git: args => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return root;
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "feat/a";
      if (args[0] === "rev-parse") throw new Error("no common dir");
      if (args[0] === "log" && args.includes("--format=%ct")) return String(Math.floor(state.at.getTime() / 1000) - state.headAgeS);
      if (args[0] === "log" && args.includes("--format=%h")) return state.head;
      if (args[0] === "log") return `${state.head} feat: thing`;
      if (args[0] === "status") return "";
      throw new Error("unexpected git");
    },
    engram: engram ?? (args => { state.engram.push(args); return { status: 0 }; })
  };
  const ckpt = () => {
    const found = [];
    const walk = dir => { try { for (const name of require_fs.readdirSync(dir, { withFileTypes: true })) { const p = join(dir, name.name); if (name.isDirectory()) walk(p); else if (p.endsWith("/f.md")) found.push(p); } } catch { /* absent */ } };
    walk(homeDir);
    return found;
  };
  return { root, deps, state, ckpt };
}
import * as require_fs from "node:fs";

test("a successful commit writes the checkpoint and the engram save", () => {
  const p = project();
  assert.equal(runCheckpointTrigger({ trigger: "commit", cwd: p.root, command: "git commit -m x", exitCode: 0 }, p.deps), 0);
  assert.equal(p.ckpt().length, 1);
  assert.match(readFileSync(p.ckpt()[0], "utf8"), /Next task: - \[ \] T2 second/);
  assert.equal(p.state.engram.length, 1);
  assert.equal(p.state.out, "");
});

const commitAt = (p, command) => runCheckpointTrigger({ trigger: "commit", cwd: p.root, command }, p.deps);
const later = (p, ms) => { p.state.at = new Date(p.state.at.getTime() + ms); };

test("a dry-run commit leaves HEAD unchanged and writes nothing new", () => {
  const p = project();
  p.state.headAgeS = 600;
  runCheckpointTrigger({ trigger: "delegate", cwd: p.root }, p.deps);
  later(p, 61000);
  p.state.headAgeS = 30;
  commitAt(p, "git commit --dry-run -m x");
  assert.equal(p.state.engram.length, 1);
});

test("a chained add-and-commit writes the checkpoint because HEAD moved", () => {
  const p = project();
  assert.equal(commitAt(p, "git add . && git commit -m x"), 0);
  assert.equal(p.ckpt().length, 1);
  assert.equal(p.state.engram.length, 1);
});

test("a failed commit followed by '; true' writes nothing because HEAD did not move", () => {
  const p = project();
  runCheckpointTrigger({ trigger: "delegate", cwd: p.root }, p.deps);
  later(p, 61000);
  commitAt(p, "git commit -m x; true");
  assert.equal(p.state.engram.length, 1);
});

test("the same HEAD twice gives one checkpoint", () => {
  const p = project();
  commitAt(p, "git commit -m x");
  later(p, 61000);
  commitAt(p, "git commit -m x");
  assert.equal(p.state.engram.length, 1);
});

test("a HEAD older than two minutes is not a fresh commit", () => {
  const p = project();
  p.state.headAgeS = 121;
  commitAt(p, "git commit -m x");
  assert.equal(p.ckpt().length, 0);
});

test("a new HEAD after the throttle window writes again", () => {
  const p = project();
  commitAt(p, "git commit -m x");
  later(p, 61000);
  p.state.head = "def5678";
  commitAt(p, "git commit -m y");
  assert.equal(p.state.engram.length, 2);
});

test("a commit right after a delegate checkpoint still writes (closed task beats the window)", () => {
  const p = project();
  runCheckpointTrigger({ trigger: "delegate", cwd: p.root }, p.deps);
  later(p, 5000);
  p.state.head = "def5678";
  commitAt(p, "git commit -m y");
  commitAt(p, "git commit -m y");
  assert.equal(p.state.engram.length, 2);
});

test("a non-commit command text is skipped before any git work", () => {
  const p = project();
  commitAt(p, "git status");
  assert.equal(p.ckpt().length, 0);
});

test("an Agent launch writes the checkpoint", () => {
  const p = project();
  assert.equal(runCheckpointTrigger({ trigger: "delegate", cwd: p.root }, p.deps), 0);
  assert.equal(p.ckpt().length, 1);
});

test("a compaction trigger writes the checkpoint", () => {
  const p = project();
  assert.equal(runCheckpointTrigger({ trigger: "compact", cwd: p.root }, p.deps), 0);
  assert.equal(p.ckpt().length, 1);
});

test("two triggers within 60 seconds write once; after 60 seconds they write again", () => {
  const p = project();
  runCheckpointTrigger({ trigger: "delegate", cwd: p.root }, p.deps);
  p.state.at = new Date(p.state.at.getTime() + 59000);
  runCheckpointTrigger({ trigger: "compact", cwd: p.root }, p.deps);
  assert.equal(p.state.engram.length, 1);
  p.state.at = new Date(p.state.at.getTime() + 2000);
  runCheckpointTrigger({ trigger: "delegate", cwd: p.root }, p.deps);
  assert.equal(p.state.engram.length, 2);
});

test("no feature document is silent and writes nothing", () => {
  const p = project({ doc: null });
  assert.equal(runCheckpointTrigger({ trigger: "delegate", cwd: p.root }, p.deps), 0);
  assert.equal(p.state.err, "");
  assert.equal(p.ckpt().length, 0);
});

test("an engram failure never fails the trigger and costs at most one stderr line", () => {
  for (const engram of [() => ({ status: 1 }), () => { throw new Error("boom"); }, () => ({ error: new Error("ENOENT") })]) {
    const p = project({ engram });
    assert.equal(runCheckpointTrigger({ trigger: "delegate", cwd: p.root }, p.deps), 0);
    assert.equal(p.ckpt().length, 1);
    assert.ok(p.state.err.split("\n").filter(Boolean).length <= 1);
  }
});

test("a write failure and an unknown trigger are swallowed", () => {
  const p = project();
  const deps = { ...p.deps, fs: { ...require_fs, mkdirSync: () => { throw new Error("disk full"); } } };
  assert.equal(runCheckpointTrigger({ trigger: "delegate", cwd: p.root }, deps), 0);
  assert.ok(p.state.err.split("\n").filter(Boolean).length <= 1);
  assert.equal(runCheckpointTrigger({ trigger: "nonsense", cwd: p.root }, p.deps), 0);
});

function realRepo() {
  const root = tmp();
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q", "-b", "feat/a");
  mkdirSync(join(root, "odd", "tasks"), { recursive: true });
  writeFileSync(join(root, "odd", "tasks", "f.md"), DOC);
  git("add", ".");
  git("commit", "-q", "-m", "feat: first");
  return { root, git };
}
const files = (dir, suffix, out = []) => { for (const e of require_fs.readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) files(p, suffix, out); else if (p.endsWith(suffix)) out.push(p); } return out; };
const cliEnv = (home, path = "/usr/bin:/bin") => ({ ...process.env, HOME: home, KAIRO_HOME: join(home, ".kairo"), PATH: path });

test("kairo checkpoint --trigger commit through the public CLI writes the checkpoint file", () => {
  const { root } = realRepo();
  const home = tmp();
  const ran = spawnSync(process.execPath, [bin, "checkpoint", "--trigger", "commit", "--command", "git commit -m x", "--cwd", root], { env: cliEnv(home), encoding: "utf8" });
  assert.equal(ran.status, 0);
  assert.equal(ran.stdout, "");
  const written = files(home, "/f.md");
  assert.equal(written.length, 1);
  assert.match(readFileSync(written[0], "utf8"), /Last commit: [0-9a-f]+ feat: first/);
});

test("--command still reaches the other command that uses it", () => {
  const home = tmp();
  const ran = spawnSync(process.execPath, [bin, "history", "--command", "sync", "--json"], { env: cliEnv(home), encoding: "utf8" });
  assert.equal(ran.status, 0);
  assert.doesNotThrow(() => JSON.parse(ran.stdout));
});

test("failed or non-commit CLI runs keep stdout empty and exit 0", () => {
  const { root } = realRepo();
  const home = tmp();
  for (const args of [["--trigger", "commit", "--command", "git status"], ["--trigger", "delegate"], ["--trigger", "bogus"]]) {
    const ran = spawnSync(process.execPath, [bin, "checkpoint", ...args, "--cwd", root], { env: cliEnv(home), encoding: "utf8" });
    assert.equal(ran.status, 0);
    assert.equal(ran.stdout, "");
  }
});

test("two concurrent checkpoint processes make exactly one engram save", async () => {
  const { root } = realRepo();
  const home = tmp();
  const bins = tmp();
  const log = join(bins, "engram.log");
  writeFileSync(join(bins, "engram"), `#!/bin/sh\nsleep 0.4\necho save >> "${log}"\n`, { mode: 0o755 });
  const env = cliEnv(home, `${bins}:/usr/bin:/bin`);
  const run = () => new Promise(resolve => { const c = spawn(process.execPath, [bin, "checkpoint", "--trigger", "delegate", "--cwd", root], { env }); c.on("close", resolve); });
  const codes = await Promise.all([run(), run(), run()]);
  assert.deepEqual(codes, [0, 0, 0]);
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1);
});
