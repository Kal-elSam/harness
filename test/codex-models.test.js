import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readCodexModels } from "../src/global/observability/codex-models.js";

function fakeSpawn({ response, malformed = false, errorResult = null, close = false, seenMethods = [] } = {}) {
  const stdout = new EventEmitter();
  const child = new EventEmitter();
  child.stdout = stdout;
  child.stdin = {
    write(raw) {
      const request = JSON.parse(raw);
      seenMethods.push(request.method);
      if (malformed) return stdout.emit("data", "not-json\n");
      if (request.method === "initialize") {
        setTimeout(() => stdout.emit("data", `${JSON.stringify({ id: request.id, result: {} })}\n`), 0);
      } else if (request.method === "model/list") {
        assert.deepEqual(request.params, { includeHidden: false });
        if (errorResult) {
          setTimeout(() => stdout.emit("data", `${JSON.stringify({ id: request.id, error: errorResult })}\n`), 0);
        } else {
          setTimeout(() => stdout.emit("data", `${JSON.stringify({ id: request.id, result: response })}\n`), 0);
        }
      }
    }
  };
  child.kill = () => { if (close) child.emit("close"); };
  return child;
}

test("reads the real, currently-available model catalog without exposing hidden entries by default", async () => {
  const seenMethods = [];
  const result = await readCodexModels({
    spawn: () => fakeSpawn({
      seenMethods,
      response: {
        data: [
          { id: "gpt-6-astra", model: "gpt-6-astra", displayName: "GPT-6-Astra", isDefault: true, hidden: false },
          { id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6-Sol", isDefault: false, hidden: false }
        ]
      }
    })
  });
  assert.equal(result.status, "measured");
  assert.deepEqual(result.models, [
    { id: "gpt-6-astra", displayName: "GPT-6-Astra", isDefault: true, hidden: false },
    { id: "gpt-5.6-sol", displayName: "GPT-5.6-Sol", isDefault: false, hidden: false }
  ]);
  assert.deepEqual(seenMethods, ["initialize", "model/list"]);
});

test("fails closed to unknown on a JSON-RPC error, malformed output, or an empty/missing data array", async () => {
  const rpcError = await readCodexModels({
    spawn: () => fakeSpawn({ errorResult: { message: "not authenticated" } })
  });
  assert.equal(rpcError.status, "unknown");
  assert.match(rpcError.error, /not authenticated/);

  const malformed = await readCodexModels({ spawn: () => fakeSpawn({ malformed: true }) });
  assert.equal(malformed.status, "unknown");

  const missingData = await readCodexModels({ spawn: () => fakeSpawn({ response: {} }) });
  assert.equal(missingData.status, "unknown");
});

test("fails closed to unknown when the app-server process closes before responding", async () => {
  const result = await readCodexModels({
    spawn: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdin = { write() { setTimeout(() => child.emit("close"), 0); } };
      child.kill = () => {};
      return child;
    }
  });
  assert.equal(result.status, "unknown");
  assert.match(result.error, /closed/);
});

test("fails closed to unknown when spawning the codex binary itself throws", async () => {
  const result = await readCodexModels({
    spawn: () => { throw new Error("codex: command not found"); }
  });
  assert.equal(result.status, "unknown");
  assert.match(result.error, /command not found/);
});
