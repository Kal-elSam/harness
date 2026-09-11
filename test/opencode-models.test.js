import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { parseOpenCodeModelsVerbose, readOpenCodeModels } from "../src/global/observability/opencode-models.js";

const SAMPLE_OUTPUT = [
  "opencode-go/deepseek-v4-flash",
  JSON.stringify({
    id: "deepseek-v4-flash", providerID: "opencode-go", name: "DeepSeek V4 Flash", status: "active",
    cost: { input: 0.15, output: 0.6 }, limit: { context: 1000000, output: 384000 },
    capabilities: { reasoning: true, toolcall: true }
  }, null, 2),
  "opencode-go/glm-5.3",
  JSON.stringify({
    id: "glm-5.3", providerID: "opencode-go", name: "GLM 5.3", status: "active",
    cost: { input: 0.4, output: 1.6 }, limit: { context: 200000, output: 64000 },
    capabilities: { reasoning: false, toolcall: true }
  }, null, 2)
].join("\n");

function fakeSpawn({ stdout = "", closeCode = 0, errorEvent = null }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  setTimeout(() => {
    if (stdout) child.stdout.emit("data", stdout);
    if (errorEvent) child.emit("error", errorEvent);
    else child.emit("close", closeCode);
  }, 0);
  child.kill = () => {};
  return child;
}

test("parseOpenCodeModelsVerbose splits header lines from pretty-printed JSON blocks", () => {
  const models = parseOpenCodeModelsVerbose(SAMPLE_OUTPUT);
  assert.equal(models.length, 2);
  assert.equal(models[0].id, "deepseek-v4-flash");
  assert.equal(models[1].id, "glm-5.3");
});

test("reads and normalizes the real model catalog for a given OpenCode provider", async () => {
  const seenArgs = [];
  const result = await readOpenCodeModels({
    provider: "opencode-go",
    spawn: (cmd, args) => { seenArgs.push([cmd, args]); return fakeSpawn({ stdout: SAMPLE_OUTPUT }); }
  });
  assert.equal(result.status, "measured");
  assert.equal(result.provider, "opencode-go");
  assert.deepEqual(seenArgs[0], ["opencode", ["models", "opencode-go", "--verbose"]]);
  assert.deepEqual(result.models[0], {
    id: "deepseek-v4-flash", providerID: "opencode-go", displayName: "DeepSeek V4 Flash", status: "active",
    costInputPerMTok: 0.15, costOutputPerMTok: 0.6, contextWindow: 1000000, maxOutput: 384000,
    supportsReasoning: true, supportsToolCall: true
  });
});

test("fails closed to unknown on a non-zero exit with no output, empty catalog, or a spawn error", async () => {
  const noOutput = await readOpenCodeModels({ provider: "opencode-go", spawn: () => fakeSpawn({ closeCode: 1 }) });
  assert.equal(noOutput.status, "unknown");

  const emptyCatalog = await readOpenCodeModels({ provider: "opencode-go", spawn: () => fakeSpawn({ stdout: "not model output" }) });
  assert.equal(emptyCatalog.status, "unknown");

  const spawnError = await readOpenCodeModels({
    provider: "opencode-go",
    spawn: () => { throw new Error("opencode: command not found"); }
  });
  assert.equal(spawnError.status, "unknown");
  assert.match(spawnError.error, /command not found/);
});

test("requires an explicit provider — never guesses between Go and Zen", async () => {
  const result = await readOpenCodeModels({});
  assert.equal(result.status, "unknown");
});
