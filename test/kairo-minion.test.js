import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installComponentAssets, repairComponentAssets } from "../src/global/component-installer.js";
import { resolveComponent } from "../src/global/component-registry.js";
import { harnessHomePaths } from "../src/global/paths.js";
import {
  KAIRO_MINION_RELATIVE_ASSET,
  resolveKairoMinionExtensionPath
} from "../src/global/runtime/orchestration/index.js";
import registerKairoMinion, {
  GENERIC_MINION_TASK, MINION_TOOLS, PATH_DENIED, buildMinionArgs, createConcurrencyGate,
  evaluateToolPathAccess, isChildMinionMode, parseMinionNdjson, parseMinionResultJson,
  registerPathGuard, resolveSelfExtensionPath, spawnMinionProcess
} from "../global-template/components/orchestrator/extensions/pi/kairo-minion.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const brief = {
  taskId: "task_1", parentTaskId: "task_root", objective: "secret objective text",
  constraints: ["read-only"], admittedPaths: ["a.js"], exitCriteria: ["summary"]
};

function handoffLine(payload, stopReason) {
  const message = {
    role: "assistant",
    content: [{ type: "text", text: JSON.stringify(payload) }]
  };
  if (stopReason) message.stopReason = stopReason;
  return JSON.stringify({ type: "message_end", message });
}

function fakePi({ stdoutLines, exitCode = 0, hangMs = 0, failSpawn = false } = {}) {
  return (command, args, opts) => {
    assert.equal(command, "pi");
    if (failSpawn) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      child.args = args;
      child.env = opts.env;
      return child;
    }
    const child = new EventEmitter();
    child.killed = false;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => {
      child.killed = true;
      child.emit("close", null, signal);
    };
    queueMicrotask(async () => {
      if (hangMs > 0) await new Promise((r) => setTimeout(r, hangMs));
      if (child.killed) return;
      for (const line of stdoutLines ?? []) child.stdout.emit("data", `${line}\n`);
      child.emit("close", exitCode, null);
    });
    child.args = args;
    child.env = opts.env;
    return child;
  };
}

test("minion asset materializes, drifts, and repairs under ~/.harness", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-minion-asset-"));
  try {
    const paths = harnessHomePaths(homeDir);
    const components = [resolveComponent("orchestrator")];
    const coreFiles = await installComponentAssets({ packageRoot, paths, components });
    assert.ok(coreFiles[KAIRO_MINION_RELATIVE_ASSET]);
    const dest = resolveKairoMinionExtensionPath(homeDir);
    assert.ok(existsSync(dest));
    assert.match(dest, /\.harness\/components\/orchestrator\/extensions\/pi\/kairo-minion\.js$/);
    assert.doesNotMatch(dest, /\.pi\/agent/);
    assert.match(await readFile(dest, "utf8"), /kairo_delegate/);
    await writeFile(dest, "// drifted\n", "utf8");
    const repaired = await repairComponentAssets({
      packageRoot, paths, components, state: { coreFiles }
    });
    assert.ok(repaired.repaired.includes(KAIRO_MINION_RELATIVE_ASSET));
    assert.match(await readFile(dest, "utf8"), /kairo_delegate/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("argv isolates child: explicit self extension and no ambient resources", () => {
  const selfPath = resolveSelfExtensionPath();
  const args = buildMinionArgs({ extensionPath: selfPath });
  assert.deepEqual(args.slice(0, 6), ["--mode", "json", "-p", "--no-session", "--tools", MINION_TOOLS]);
  assert.ok(args.includes("--no-extensions"));
  const extIdx = args.indexOf("--extension");
  assert.ok(extIdx >= 0);
  assert.equal(args[extIdx + 1], selfPath);
  for (const flag of ["--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve"]) {
    assert.ok(args.includes(flag), flag);
  }
  assert.ok(args.includes(GENERIC_MINION_TASK));
  assert.doesNotMatch(args.join(" "), /secret objective|password|api[_-]?key/i);
});

test("child mode registers path guard only; parent registers delegate", () => {
  assert.equal(isChildMinionMode({}), false);
  assert.equal(isChildMinionMode({ KAIRO_MINION_BRIEF: " /tmp/b.json " }), true);

  const parentPi = { tools: [], onCalls: [], registerTool(t) { this.tools.push(t); }, on(...a) { this.onCalls.push(a); } };
  assert.deepEqual(registerKairoMinion(parentPi, {}), { mode: "parent" });
  assert.equal(parentPi.tools[0]?.name, "kairo_delegate");
  assert.equal(parentPi.onCalls.length, 0);

  const childPi = { tools: [], onCalls: [], registerTool(t) { this.tools.push(t); }, on(...a) { this.onCalls.push(a); } };
  assert.deepEqual(registerKairoMinion(childPi, { KAIRO_MINION_BRIEF: "/brief.json" }), { mode: "child" });
  assert.equal(childPi.tools.length, 0);
  assert.equal(childPi.onCalls[0]?.[0], "tool_call");
});

test("allowlist: file, directory, omitted, empty, .., external abs, symlink escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-allow-"));
  try {
    const allowedFile = join(root, "ok.js");
    const allowedDir = join(root, "src");
    const nested = join(allowedDir, "nested.js");
    const outside = join(root, "outside.js");
    mkdirSync(allowedDir);
    writeFileSync(allowedFile, "1");
    writeFileSync(nested, "2");
    writeFileSync(outside, "3");
    const linkEscape = join(allowedDir, "escape-link");
    symlinkSync(outside, linkEscape);

    assert.equal((await evaluateToolPathAccess({
      toolName: "read", input: { path: allowedFile }, admittedPaths: [allowedFile], cwd: root
    })).allow, true);
    assert.equal((await evaluateToolPathAccess({
      toolName: "grep", input: { path: nested }, admittedPaths: [allowedDir], cwd: root
    })).allow, true);
    assert.equal((await evaluateToolPathAccess({
      toolName: "ls", input: {}, admittedPaths: [root], cwd: root
    })).allow, true);
    assert.equal((await evaluateToolPathAccess({
      toolName: "ls", input: {}, admittedPaths: [allowedFile], cwd: root
    })).allow, false);
    assert.equal((await evaluateToolPathAccess({
      toolName: "read", input: { path: "missing.js" }, admittedPaths: [], cwd: root
    })).reason, PATH_DENIED);
    assert.equal((await evaluateToolPathAccess({
      toolName: "read", input: { path: "../outside.js" }, admittedPaths: [allowedDir], cwd: allowedDir
    })).allow, false);
    assert.equal((await evaluateToolPathAccess({
      toolName: "read", input: { path: outside }, admittedPaths: [allowedDir], cwd: root
    })).allow, false);
    assert.equal((await evaluateToolPathAccess({
      toolName: "read", input: { path: linkEscape }, admittedPaths: [allowedDir], cwd: root
    })).allow, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool_call guard blocks before execute with KAIRO_PATH_DENIED", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-guard-"));
  try {
    const ok = join(root, "ok.js");
    writeFileSync(ok, "x");
    const briefPath = join(root, "brief.json");
    await writeFile(briefPath, JSON.stringify({ admittedPaths: [ok] }));
    let blocked = null;
    const pi = {
      on(event, handler) {
        assert.equal(event, "tool_call");
        this.handler = handler;
      }
    };
    registerPathGuard(pi, { briefPath, cwd: root });
    blocked = await pi.handler({ toolName: "read", input: { path: join(root, "nope.js") } });
    assert.deepEqual(blocked, { block: true, reason: PATH_DENIED });
    assert.equal(await pi.handler({ toolName: "read", input: { path: ok } }), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrency caps at two; await order is deterministic", async () => {
  const gate = createConcurrencyGate(2);
  let peak = 0;
  let current = 0;
  const started = [];
  const run = (id, ms) => gate.run(async () => {
    started.push(id);
    current += 1;
    peak = Math.max(peak, current);
    await new Promise((r) => setTimeout(r, ms));
    current -= 1;
    return id;
  });
  assert.deepEqual(await Promise.all([run("a", 40), run("b", 40), run("c", 10)]), ["a", "b", "c"]);
  assert.equal(peak, 2);
  assert.deepEqual(started.slice(0, 2).sort(), ["a", "b"]);
});

test("NDJSON fail-closed on late error/aborted; no raw payload leak", () => {
  const good = handoffLine({ taskId: "t1", summary: "ok" });
  const ok = parseMinionNdjson([
    good, JSON.stringify({ type: "turn_end", usage: { input: 3, output: 2 } })
  ].join("\n"));
  assert.equal(parseMinionResultJson(ok.text, { taskId: "t1" }).summary, "ok");
  assert.equal(ok.usage.inputTokens, 3);

  for (const late of [
    JSON.stringify({ type: "error", message: "RAW_SECRET_STDERR_BLOB" }),
    handoffLine({ taskId: "t1", summary: "still" }, "error"),
    handoffLine({ taskId: "t1", summary: "still" }, "aborted")
  ]) {
    assert.throws(
      () => parseMinionNdjson([good, late].join("\n")),
      (e) => e.code === "invalid_handoff" && !String(e.message).includes("RAW_SECRET")
    );
  }
  assert.throws(() => parseMinionResultJson("{", { taskId: "t1" }), (e) => e.code === "invalid_handoff");
  assert.throws(
    () => parseMinionResultJson(JSON.stringify({ taskId: "t1", summary: "x", stdout: "leak" }), { taskId: "t1" }),
    (e) => e.code === "invalid_handoff"
  );
});

test("stubbed spawn: success, exit, spawn error, abort cleanup", async () => {
  const selfPath = resolveSelfExtensionPath();
  const ok = await spawnMinionProcess({
    brief,
    extensionPath: selfPath,
    spawnImpl: fakePi({
      stdoutLines: [handoffLine({
        taskId: "task_1", summary: "done", decisions: [], files: ["a.js"], risks: [], evidence: []
      })]
    })
  });
  assert.equal(ok.summary, "done");
  assert.doesNotMatch(JSON.stringify(ok), /secret objective|stdout|stderr|transcript/i);
  const bad = (e) => e.code === "invalid_handoff";
  await assert.rejects(() => spawnMinionProcess({ brief, spawnImpl: fakePi({ exitCode: 2 }) }), bad);
  await assert.rejects(() => spawnMinionProcess({ brief, spawnImpl: fakePi({ failSpawn: true }) }), bad);
  const ac = new AbortController();
  const hanging = spawnMinionProcess({
    brief, signal: ac.signal, abortGraceMs: 20, spawnImpl: fakePi({ hangMs: 5_000 })
  });
  setTimeout(() => ac.abort(), 5);
  await assert.rejects(() => hanging, bad);

  let capturedArgs = null;
  await spawnMinionProcess({
    brief,
    extensionPath: selfPath,
    spawnImpl: (cmd, args) => {
      capturedArgs = args;
      return fakePi({
        stdoutLines: [handoffLine({
          taskId: "task_1", summary: "args", decisions: [], files: [], risks: [], evidence: []
        })]
      })(cmd, args, { env: {} });
    }
  });
  assert.ok(capturedArgs.includes("--extension"));
  assert.equal(capturedArgs[capturedArgs.indexOf("--extension") + 1], selfPath);
  assert.ok(capturedArgs.includes("--no-skills"));
});
