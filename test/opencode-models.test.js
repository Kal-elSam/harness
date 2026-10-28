import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as catalog from "../src/global/observability/opencode-models.js";

const SAMPLE_OUTPUT = "opencode/big-pickle\n opencode-go/glm-5.3 \r\nopencode-go/uncached\nopencode-go/glm-5.3\n";

function fakeSpawn({ stdout = "", closeCode = 0, errorEvent = null, hang = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  setTimeout(() => {
    if (stdout) child.stdout.emit("data", stdout);
    if (errorEvent) child.emit("error", errorEvent);
    else if (!hang) child.emit("close", closeCode);
  }, 0);
  child.kill = () => {};
  return child;
}

function fallback(id) {
  return {
    id, providerID: "opencode-go", displayName: id, status: "active",
    costInputPerMTok: null, costOutputPerMTok: null, contextWindow: null, maxOutput: null,
    supportsReasoning: false, supportsToolCall: false
  };
}

test("parser keeps requested provider ids in output order, trimmed and unique", () => {
  assert.equal(typeof catalog.parseOpenCodeModelList, "function");
  assert.deepEqual(catalog.parseOpenCodeModelList(SAMPLE_OUTPUT, "opencode-go"), ["glm-5.3", "uncached"]);
  assert.deepEqual(catalog.parseOpenCodeModelList(SAMPLE_OUTPUT, "opencode"), ["big-pickle"]);
  assert.deepEqual(catalog.parseOpenCodeModelList("opencode-go-extra/no\nopencode-go/\n", "opencode-go"), []);
});

test("reader invokes models only and enriches listed ids from XDG host cache", async () => {
  const home = await mkdtemp(join(tmpdir(), "opencode-models-"));
  try {
    await mkdir(join(home, "opencode"));
    await writeFile(join(home, "opencode", "models.json"), JSON.stringify({
      "opencode-go": { models: {
        "glm-5.3": { name: "GLM 5.3", status: "preview", reasoning: true, tool_call: true,
          cost: { input: 0.4, output: 1.6 }, limit: { context: 200000, output: 64000 } },
        "cache-only": { name: "Not listed" }
      } }
    }));
    const env = { XDG_CACHE_HOME: home, HOME: join(home, "unused") };
    const seen = [];
    const result = await catalog.readOpenCodeModels({
      provider: "opencode-go", env, cwd: home,
      spawn: (cmd, args, options) => { seen.push({ cmd, args, options }); return fakeSpawn({ stdout: SAMPLE_OUTPUT }); }
    });
    assert.deepEqual(seen, [{ cmd: "opencode", args: ["models"], options: { cwd: home, env, stdio: ["ignore", "pipe", "pipe"] } }]);
    assert.equal(result.status, "measured");
    assert.equal(result.source, "opencode models");
    assert.equal(result.provider, "opencode-go");
    assert.equal(result.error, null);
    assert.deepEqual(result.models, [{
      id: "glm-5.3", providerID: "opencode-go", displayName: "GLM 5.3", status: "preview",
      costInputPerMTok: 0.4, costOutputPerMTok: 1.6, contextWindow: 200000, maxOutput: 64000,
      supportsReasoning: true, supportsToolCall: true
    }, fallback("uncached")]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("HOME cache fallback is optional and flags require literal true", async () => {
  const home = await mkdtemp(join(tmpdir(), "opencode-models-"));
  const read = () => catalog.readOpenCodeModels({ provider: "opencode-go", env: { HOME: home },
    spawn: () => fakeSpawn({ stdout: "opencode-go/model" }) });
  try {
    assert.deepEqual((await read()).models, [fallback("model")]);
    await mkdir(join(home, ".cache", "opencode"), { recursive: true });
    const path = join(home, ".cache", "opencode", "models.json");
    await writeFile(path, "invalid json");
    assert.deepEqual((await read()).models, [fallback("model")]);
    await writeFile(path, JSON.stringify({ "opencode-go": { models: { model: { reasoning: "true", tool_call: 1 } } } }));
    assert.deepEqual((await read()).models, [fallback("model")]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("fails closed on exit 1 without output, other providers, spawn errors, or timeout", async () => {
  for (const spawn of [
    () => fakeSpawn({ closeCode: 1 }),
    () => fakeSpawn({ stdout: "opencode/big-pickle" }),
    () => { throw new Error("opencode: command not found"); },
    () => fakeSpawn({ errorEvent: new Error("spawn failed") }),
    () => fakeSpawn({ hang: true })
  ]) {
    const result = await catalog.readOpenCodeModels({ provider: "opencode-go", env: {}, spawn, timeoutMs: 25 });
    assert.equal(result.status, "unknown");
    assert.equal(result.source, "opencode models");
    assert.deepEqual(result.models, []);
    assert.ok(result.error);
  }
});

test("requires an explicit provider without spawning", async () => {
  const result = await catalog.readOpenCodeModels({ spawn: () => assert.fail("must not spawn") });
  assert.equal(result.status, "unknown");
  assert.deepEqual(result.models, []);
  assert.match(result.error, /provider is required/);
});
