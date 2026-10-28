import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectKeyForPath } from "../src/global/next/project-key.js";
import { after, test } from "node:test";
import { engramProject, parseBranch, parseTasks, runContinue } from "../src/global/session/continue.js";

const bin = new URL("../bin/kairo.js", import.meta.url).pathname;
const scratch = [];
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), "kairo-continue-")); scratch.push(dir); return dir; };
after(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

const BOX_DOC = "# F\nBranch: feat/a. Runner: x\n\n## Tasks\n- [x] T1 first\n- [ ] T2 second\n- [ ] T3 third\n\n## Log\n- L1";
const T_DOC = "# G\nBranch: `feat/b`.\n\n## Tasks\n- T1 [S1] inline, complete — commit abc\n- T2 [S1] closed\n- T3 [S2] pending work\n- T4 later\n\n## Log\n";

function project(docs = {}, { branch = "feat/a", dirty = 0 } = {}) {
  const root = tmp();
  mkdirSync(join(root, "odd", "tasks"), { recursive: true });
  for (const [name, text] of Object.entries(docs)) writeFileSync(join(root, "odd", "tasks", `${name}.md`), text);
  const calls = { spawn: [], engram: [], out: "", err: "" };
  const deps = {
    homeDir: tmp(), env: {}, now: () => new Date("2026-10-28T12:00:00Z"), isTTY: true,
    stdout: t => { calls.out += t; }, stderr: t => { calls.err += t; },
    git: args => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return root;
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return branch;
      if (args[0] === "rev-parse") throw new Error("no common dir");
      if (args[0] === "log") return "abc1234 feat: thing";
      if (args[0] === "status") return Array.from({ length: dirty }, (_, i) => ` M f${i}`).join("\n");
      throw new Error("unexpected git");
    },
    spawn: (command, args, opts) => { calls.spawn.push({ command, args, opts }); return { status: 3 }; },
    engram: args => { calls.engram.push(args); return { status: 0 }; }
  };
  return { root, deps, calls };
}

test("parseTasks handles checkbox and T-line shapes", () => {
  assert.equal(parseTasks(BOX_DOC).next, "- [ ] T2 second");
  assert.equal(parseTasks(T_DOC).next, "- T3 [S2] pending work");
  assert.equal(parseTasks("## Tasks\n- [x] a\n").next, null);
  assert.equal(parseBranch(BOX_DOC), "feat/a");
  assert.equal(parseBranch(T_DOC), "feat/b");
});

test("selects the document whose Branch matches the current branch", () => {
  const { root, deps, calls } = project({ one: BOX_DOC, two: T_DOC }, { branch: "feat/b" });
  assert.equal(runContinue({ cwd: root, print: true }, deps), 0);
  assert.match(calls.out, /odd\/tasks\/two\.md/);
  assert.match(calls.out, /- T3 \[S2\] pending work/);
});

test("falls back to the most recent document with an unfinished task", () => {
  const { root, deps, calls } = project({ old: BOX_DOC, fin: "## Tasks\n- [x] T1 a\n", fresh: T_DOC }, { branch: "main" });
  utimesSync(join(root, "odd/tasks/old.md"), 1000, 1000);
  utimesSync(join(root, "odd/tasks/fin.md"), 5000, 5000);
  utimesSync(join(root, "odd/tasks/fresh.md"), 3000, 3000);
  runContinue({ cwd: root, print: true }, deps);
  assert.match(calls.out, /fresh\.md/);
});

test("--feature overrides branch matching", () => {
  const { root, deps, calls } = project({ one: BOX_DOC, two: T_DOC }, { branch: "feat/b" });
  runContinue({ cwd: root, print: true, feature: "one" }, deps);
  assert.match(calls.out, /one\.md/);
  assert.equal(runContinue({ cwd: root, print: true, feature: "nope" }, deps), 1);
});

test("no document: exit 1 with one line", () => {
  const { root, deps, calls } = project({});
  assert.equal(runContinue({ cwd: root }, deps), 1);
  assert.equal(calls.err.trim().split("\n").length, 1);
  assert.equal(calls.spawn.length, 0);
});

test("writes the checkpoint file and saves to engram", () => {
  const { root, deps, calls } = project({ one: BOX_DOC }, { dirty: 2 });
  runContinue({ cwd: root, print: true }, deps);
  const match = calls.out.match(/Checkpoint: (\S+)\.\n/);
  const text = readFileSync(match[1], "utf8");
  assert.match(text, /Feature document: .*one\.md/);
  assert.match(text, /Next task: - \[ \] T2 second/);
  assert.match(text, /Branch: feat\/a/);
  assert.match(text, /Last commit: abc1234 feat: thing/);
  assert.match(text, /Uncommitted files: 2/);
  assert.match(text, /Saved at: 2026-10-28T12:00:00.000Z/);
  const save = calls.engram[0];
  assert.deepEqual([save[0], save[3], save[4]], ["save", "--type", "architecture"]);
  assert.ok(save.includes("--topic") && save.includes("odd/one/checkpoint"));
  assert.match(calls.out, /read it until ## Log|Read it until ## Log/);
  assert.match(calls.out, /mem_context and mem_search for odd\/one/);
});

test("engram failure is only a warning", () => {
  const { root, deps, calls } = project({ one: BOX_DOC });
  deps.engram = () => ({ error: new Error("spawn engram ENOENT") });
  assert.equal(runContinue({ cwd: root, print: true }, deps), 0);
  assert.match(calls.err, /warning: engram save skipped/);
});

test("--print and non-TTY never spawn", () => {
  const a = project({ one: BOX_DOC });
  runContinue({ cwd: a.root, print: true, host: "claude" }, a.deps);
  assert.equal(a.calls.spawn.length, 0);
  const b = project({ one: BOX_DOC });
  b.deps.isTTY = false;
  runContinue({ cwd: b.root, host: "claude" }, b.deps);
  assert.equal(b.calls.spawn.length, 0);
  assert.match(b.calls.out, /Next task/);
});

test("claude and codex spawn with exactly the prompt and return the child code", () => {
  for (const host of ["claude", "codex"]) {
    const { root, deps, calls } = project({ one: BOX_DOC });
    assert.equal(runContinue({ cwd: root, host }, deps), 3);
    const [call] = calls.spawn;
    assert.equal(call.command, host);
    assert.equal(call.args.length, 1);
    assert.match(call.args[0], /Next task: - \[ \] T2 second/);
    assert.equal(call.opts.stdio, "inherit");
    assert.equal(call.opts.cwd, root);
  }
});

test("default host follows the active host marker, else claude", () => {
  const a = project({ one: BOX_DOC });
  a.deps.env = { CODEX_THREAD_ID: "t" };
  runContinue({ cwd: a.root }, a.deps);
  assert.equal(a.calls.spawn[0].command, "codex");
  const b = project({ one: BOX_DOC });
  runContinue({ cwd: b.root }, b.deps);
  assert.equal(b.calls.spawn[0].command, "claude");
});

test("gentle-shell prints the prompt instead of launching", () => {
  const { root, deps, calls } = project({ one: BOX_DOC });
  assert.equal(runContinue({ cwd: root, host: "gentle-shell" }, deps), 0);
  assert.equal(calls.spawn.length, 0);
  assert.match(calls.out, /Next task/);
  assert.match(calls.out, /paste the prompt above/);
});

test("dirty tree warns once and still continues", () => {
  const { root, deps, calls } = project({ one: BOX_DOC }, { dirty: 3 });
  assert.equal(runContinue({ cwd: root, print: true }, deps), 0);
  assert.match(calls.err, /warning: 3 uncommitted file\(s\)/);
  assert.equal(calls.err.match(/uncommitted/g).length, 1);
});

test("CLI: kairo continue --print --feature runs through the public entry", () => {
  const root = tmp();
  mkdirSync(join(root, "odd", "tasks"), { recursive: true });
  writeFileSync(join(root, "odd/tasks/f.md"), BOX_DOC);
  const home = tmp();
  const result = spawnSync(process.execPath, [bin, "continue", "--print", "--feature", "f", "--cwd", root],
    { encoding: "utf8", timeout: 15000, env: { ...process.env, HARNESS_HOME: home, PATH: "/nonexistent" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Next task: - \[ \] T2 second/);
  assert.ok(existsSync(join(home, ".harness", "sessions")));
});

test("CLI: retired resume still prints its retired message", () => {
  const result = spawnSync(process.execPath, [bin, "resume"], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.stdout.trim(), "The terminal UI was retired. Use `kairo status` or `kairo setup`.");
  assert.equal(result.status, 1);
});

test("completion words inside unfinished descriptions do not finish a task", () => {
  const t = "## Tasks\n- T1 Write checkpoint before task is closed — pending\n- T2 Mark done items — open\n";
  assert.equal(parseTasks(t).next, "- T1 Write checkpoint before task is closed — pending");
  // An explicit trailing open status beats a completion token in the description.
  const listed = "## Tasks\n- T1 Document task states: pending, complete — pending\n";
  assert.equal(parseTasks(listed).next, "- T1 Document task states: pending, complete — pending");
  const box = "## Tasks\n- [ ] T1 Write checkpoint before task is closed\n- [x] T2 b\n";
  assert.equal(parseTasks(box).next, "- [ ] T1 Write checkpoint before task is closed");
  const fin = "## Tasks\n- T1 Write it — done (L2)\n- T2 [S1] inline, complete — commit abc\n- T3 next\n";
  assert.equal(parseTasks(fin).next, "- T3 next");
});

test("engram project comes from the origin remote name, then the main checkout directory", () => {
  const remote = url => ({ git: args => { if (args[0] === "remote") return url; throw new Error("x"); } });
  assert.equal(engramProject(remote("https://github.com/Kal-elSam/harness.git"), "/w/checkpoint"), "harness");
  assert.equal(engramProject(remote("git@github.com:Kal-elSam/harness.git"), "/w/checkpoint"), "harness");
  assert.equal(engramProject(remote("https://github.com/Kal-elSam/harness"), "/w/checkpoint"), "harness");
  const none = common => ({ git: args => { if (args[0] === "rev-parse") return common; throw new Error("no remote"); } });
  assert.equal(engramProject(none("/Users/x/agentic-harness/.git"), "/w/checkpoint"), "agentic-harness");
  assert.equal(engramProject(none(null) , "/w/checkpoint"), "checkpoint");
  const { root, deps, calls } = project({ one: BOX_DOC });
  deps.git = (args, cwd, orig = deps.git) => { throw new Error("no git"); };
  runContinue({ cwd: root, print: true }, deps);
  assert.equal(calls.engram[0][calls.engram[0].indexOf("--project") + 1], root.split("/").pop());
});

test("a linked worktree gets the same project name and checkpoint key as the main checkout", () => {
  const base = tmp();
  const main = join(base, "main");
  const wt = join(base, "wt");
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  git(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "i");
  git(main, "remote", "add", "origin", "https://example.com/Org/harness.git");
  git(main, "worktree", "add", "-q", wt, "-b", "side");
  const real = (args, cwd) => git(cwd, ...args);
  assert.equal(engramProject({ git: real }, main), "harness");
  assert.equal(engramProject({ git: real }, wt), "harness");
  assert.equal(projectKeyForPath(wt), projectKeyForPath(main));
  mkdirSync(join(wt, "odd/tasks"), { recursive: true });
  writeFileSync(join(wt, "odd/tasks/f.md"), BOX_DOC.replace("feat/a", "side"));
  const home = tmp();
  const calls = { out: "", err: "" };
  runContinue({ cwd: wt, print: true }, { homeDir: home, env: {}, isTTY: false, stdout: t => { calls.out += t; }, stderr: t => { calls.err += t; },
    engram: () => ({ status: 0 }) });
  assert.ok(existsSync(join(home, ".harness", "sessions", projectKeyForPath(main), "checkpoints", "f.md")));
});

test("shell metacharacters in feature and task text reach spawn argv unchanged", () => {
  const nasty = "T2 $(rm -rf /) `id` \"q\" 'a'; echo hi | cat";
  const { root, deps, calls } = project({ "we ird": `## Tasks\n- [ ] ${nasty}\n` });
  runContinue({ cwd: root, host: "claude", feature: "we ird" }, deps);
  assert.equal(calls.spawn[0].args.length, 1);
  assert.ok(calls.spawn[0].args[0].includes(`Next task: - [ ] ${nasty}`));
  assert.ok(calls.spawn[0].args[0].includes('"we ird"'));
});

test("an ambiguous active host falls back to claude", () => {
  const { root, deps, calls } = project({ one: BOX_DOC });
  deps.env = { CLAUDECODE: "1", CODEX_THREAD_ID: "t" };
  assert.equal(runContinue({ cwd: root }, deps), 3);
  assert.equal(calls.spawn[0].command, "claude");
});
