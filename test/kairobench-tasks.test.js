import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { KAIROBENCH_TASKS } from "../src/global/intelligence/kairobench-tasks.js";

function realRun(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("close", (exitCode) => resolve({ stdout, exitCode }));
  });
}

function ioFor(dir) {
  return {
    readFile: (path, encoding) => readFile(join(dir, path), encoding),
    writeFile: (path, content) => writeFile(join(dir, path), content),
    run: () => { throw new Error("run() not needed for this test"); }
  };
}

test("KAIROBENCH_TASKS starts small and staged, not a large paid batch", () => {
  assert.ok(KAIROBENCH_TASKS.length <= 5, "should stay a small, reviewable first batch");
  for (const task of KAIROBENCH_TASKS) {
    assert.ok(task.id);
    assert.ok(task.category);
    assert.ok(task.prompt);
    assert.equal(typeof task.verify, "function");
  }
});

test("implementation-01 verify passes when the real file exists with the exact expected content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kairobench-test-"));
  try {
    await writeFile(join(dir, "answer.txt"), "42");
    const task = KAIROBENCH_TASKS.find((t) => t.id === "implementation-01");
    assert.equal(await task.verify(ioFor(dir)), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("implementation-01 verify fails, never throws, when the file was never created", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kairobench-test-"));
  try {
    const task = KAIROBENCH_TASKS.find((t) => t.id === "implementation-01");
    assert.equal(await task.verify(ioFor(dir)), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("implementation-01 verify fails on real wrong content, trims trailing whitespace only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kairobench-test-"));
  try {
    await writeFile(join(dir, "answer.txt"), "43");
    const task = KAIROBENCH_TASKS.find((t) => t.id === "implementation-01");
    assert.equal(await task.verify(ioFor(dir)), false);

    await writeFile(join(dir, "answer.txt"), "42\n");
    assert.equal(await task.verify(ioFor(dir)), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("debugging-01 setup writes the real broken file, verify runs it for real and checks the actual output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kairobench-test-"));
  try {
    const task = KAIROBENCH_TASKS.find((t) => t.id === "debugging-01");
    const io = ioFor(dir);
    await task.setup(io);
    const brokenContent = await readFile(join(dir, "broken.js"), "utf8");
    assert.match(brokenContent, /function add/);

    // Unfixed: verify must fail against the real broken file, never fabricate a pass.
    const fullIo = { ...io, run: (command, args) => realRun(command, args, dir) };
    assert.equal(await task.verify(fullIo), false);

    // Fixed: verify passes against the real corrected file.
    await writeFile(join(dir, "broken.js"), "function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n");
    assert.equal(await task.verify(fullIo), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
