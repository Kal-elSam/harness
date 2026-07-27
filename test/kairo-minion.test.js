import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installComponentAssets, repairComponentAssets } from "../src/global/component-installer.js";
import { resolveComponent } from "../src/global/component-registry.js";
import { harnessHomePaths } from "../src/global/paths.js";
import {
  KAIRO_MINION_RELATIVE_ASSET,
  resolveKairoMinionExtensionPath
} from "../src/global/runtime/orchestration/index.js";
import {
  GENERIC_MINION_TASK, MINION_TOOLS, buildMinionArgs, createConcurrencyGate,
  parseMinionNdjson, parseMinionResultJson, spawnMinionProcess
} from "../global-template/components/orchestrator/extensions/pi/kairo-minion.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const brief = {
  taskId: "task_1", parentTaskId: "task_root", objective: "secret objective text",
  constraints: ["read-only"], admittedPaths: ["a.js"], exitCriteria: ["summary"]
};

function handoffLine(payload) {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(payload) }] }
  });
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

test("argv is secret-free with read-only tools and no-session", () => {
  const args = buildMinionArgs();
  assert.deepEqual(args.slice(0, 6), ["--mode", "json", "-p", "--no-session", "--tools", MINION_TOOLS]);
  assert.ok(args.includes("--no-extensions"));
  assert.ok(args.includes(GENERIC_MINION_TASK));
  assert.doesNotMatch(args.join(" "), /secret objective|password|api[_-]?key/i);
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

test("NDJSON/usage parse; invalid handoff rejects raw leaks", () => {
  const parsed = parseMinionNdjson([
    handoffLine({ taskId: "t1", summary: "ok" }),
    JSON.stringify({ type: "turn_end", usage: { input: 3, output: 2 } })
  ].join("\n"));
  assert.equal(parseMinionResultJson(parsed.text, { taskId: "t1" }).summary, "ok");
  assert.equal(parsed.usage.inputTokens, 3);
  assert.throws(() => parseMinionResultJson("{", { taskId: "t1" }), (e) => e.code === "invalid_handoff");
  assert.throws(
    () => parseMinionResultJson(JSON.stringify({ taskId: "t1", summary: "x", stdout: "leak" }), { taskId: "t1" }),
    (e) => e.code === "invalid_handoff"
  );
});

test("stubbed spawn: success, exit, spawn error, abort cleanup", async () => {
  const ok = await spawnMinionProcess({
    brief,
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
});
