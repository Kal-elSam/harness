import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  BACKEND_IDS,
  TRANSPORT_KINDS,
  createDefaultBackends,
  createOpencodeRuntimeBackend,
  resolveRoutingDecision
} from "../src/global/intelligence/index.js";

const emptyCli = () => ({
  cliInstalled: false, authListOk: false, authProviders: [], error: null
});
const configuredCli = () => ({
  cliInstalled: true, authListOk: true, authProviders: ["Anthropic", "Google"], error: null
});

function child() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.kill = () => {};
  return c;
}

function fakeSpawn(lines, { onSpawn, exitCode = 0, stderrLines = [] } = {}) {
  return (command, args, options) => {
    onSpawn?.({ command, args, options });
    const c = child();
    c.kill = () => c.emit("close", null);
    setImmediate(() => {
      for (const line of lines) c.stdout.emit("data", `${line}\n`);
      for (const line of stderrLines) c.stderr.emit("data", `${line}\n`);
      c.emit("close", exitCode);
    });
    return c;
  };
}

test("runtime missing vs configured CLI", async () => {
  const missing = createOpencodeRuntimeBackend({ whichImpl: () => false, collectCliEvidence: emptyCli });
  assert.equal((await missing.detect()).available, false);
  assert.match((await missing.detect()).recommendation, /Install and authenticate/);
  assert.equal((await missing.invoke({}, { modelId: "opencode/claude-haiku-4-5", prompt: "x" })).ok, false);
  const found = await createOpencodeRuntimeBackend({
    whichImpl: () => true, collectCliEvidence: configuredCli
  }).detect();
  assert.equal(found.available, true);
  assert.equal(found.configured, true);
  assert.equal(found.authenticated, false);
  assert.match(found.recommendation, /unverified/i);
});

test("runtime catalog is Anthropic/Google runtime-only", async () => {
  const models = await createOpencodeRuntimeBackend({
    whichImpl: () => true, collectCliEvidence: configuredCli
  }).listModels();
  assert.ok(models.every((m) => m.transport === TRANSPORT_KINDS.RUNTIME));
  assert.ok(models.every((m) => m.provider === BACKEND_IDS.OPENCODE));
  assert.ok(models.some((m) => m.modelId === "opencode/claude-haiku-4-5"));
  assert.ok(models.some((m) => m.modelId === "opencode/gemini-3-flash"));
  assert.ok(!models.some((m) => /kimi-k2\.7-code|big-pickle/.test(m.modelId)));
});

test("runtime invoke keeps non-mutating preamble and never --auto", async () => {
  const calls = [];
  const result = await createOpencodeRuntimeBackend({
    whichImpl: () => true,
    collectCliEvidence: configuredCli,
    spawnImpl: fakeSpawn([
      JSON.stringify({ type: "text", part: { text: "cli answer" } }),
      JSON.stringify({ type: "step_finish", part: { tokens: { input: 2, output: 1 }, cost: 0.01 } })
    ], { onSpawn: (c) => calls.push(c) })
  }).invoke(
    { systemPrompt: "sys", workspaceRoot: process.cwd() },
    { modelId: "opencode/claude-haiku-4-5", prompt: "diagnose" }
  );
  assert.equal(result.ok, true);
  assert.equal(result.content, "cli answer");
  assert.equal(result.usage.inputTokens, 2);
  assert.deepEqual(calls[0].args.slice(0, 5), ["run", "--format", "json", "--model", "opencode/claude-haiku-4-5"]);
  assert.ok(!calls[0].args.includes("--auto"));
  assert.match(calls[0].args.at(-1), /analysis only/i);
});

test("runtime invoke: invalid model, timeout, empty, ENOENT", async () => {
  const base = { whichImpl: () => true, collectCliEvidence: configuredCli };
  assert.match((await createOpencodeRuntimeBackend(base).invoke({}, { modelId: "unknown", prompt: "x" })).error, /requires --model/);
  assert.match((await createOpencodeRuntimeBackend({
    ...base,
    spawnImpl: () => {
      const c = child();
      c.kill = (signal) => {
        if (signal === "SIGTERM") setImmediate(() => c.emit("close", null, "SIGTERM"));
        return true;
      };
      return c;
    }
  }).invoke(
    {}, {
      modelId: "opencode/claude-haiku-4-5", prompt: "hang", timeoutMs: 15,
      terminationGraceMs: 30, killGraceMs: 30
    }
  )).error, /timed out/i);
  assert.match((await createOpencodeRuntimeBackend({ ...base, spawnImpl: fakeSpawn([]) }).invoke(
    {}, { modelId: "opencode/claude-haiku-4-5", prompt: "x" }
  )).error, /no text output/i);
  assert.match((await createOpencodeRuntimeBackend({
    ...base,
    spawnImpl: () => {
      const c = child();
      setImmediate(() => { const e = new Error("ENOENT"); e.code = "ENOENT"; c.emit("error", e); });
      return c;
    }
  }).invoke({}, { modelId: "opencode/claude-haiku-4-5", prompt: "x" })).error, /not installed/i);
});

test("runtime exit status dominates partial output; stderr sanitized", async () => {
  const base = { whichImpl: () => true, collectCliEvidence: configuredCli };
  const text = JSON.stringify({ type: "text", part: { text: "partial" } });

  const exit1 = await createOpencodeRuntimeBackend({
    ...base,
    spawnImpl: fakeSpawn([text], {
      exitCode: 1,
      stderrLines: ["OPENCODE_API_KEY=sk-leak boom"]
    })
  }).invoke({}, { modelId: "opencode/claude-haiku-4-5", prompt: "x" });
  assert.equal(exit1.ok, false);
  assert.equal(exit1.content, null);
  assert.match(exit1.error, /exit 1/);
  assert.match(exit1.error, /OPENCODE_API_KEY=\[REDACTED\]/);
  assert.ok(!exit1.error.includes("sk-leak"));

  const signaled = await createOpencodeRuntimeBackend({
    ...base,
    spawnImpl: () => {
      const c = child();
      setImmediate(() => {
        c.stdout.emit("data", `${text}\n`);
        c.emit("close", null, "SIGKILL");
      });
      return c;
    }
  }).invoke({}, { modelId: "opencode/claude-haiku-4-5", prompt: "x" });
  assert.equal(signaled.ok, false);
  assert.match(signaled.error, /signal SIGKILL|exit null/);

  const okWarn = await createOpencodeRuntimeBackend({
    ...base,
    spawnImpl: fakeSpawn([text], { stderrLines: ["warn: slow"], exitCode: 0 })
  }).invoke({}, { modelId: "opencode/claude-haiku-4-5", prompt: "x" });
  assert.equal(okWarn.ok, true);
  assert.equal(okWarn.content, "partial");

  const structured = await createOpencodeRuntimeBackend({
    ...base,
    spawnImpl: fakeSpawn([
      JSON.stringify({ type: "error", error: { message: "provider rejected" } })
    ])
  }).invoke({}, { modelId: "opencode/claude-haiku-4-5", prompt: "x" });
  assert.equal(structured.ok, false);
  assert.match(structured.error, /provider rejected/);
});

test("registry: OpenRouter then runtime, evidence once, no auto-route", async () => {
  let calls = 0;
  const backends = createDefaultBackends({
    env: {},
    whichImpl: () => false,
    collectCliEvidence: () => { calls += 1; return emptyCli(); },
    fetchImpl: async () => ({ ok: false, status: 401, async text() { return "{}"; } })
  });
  assert.deepEqual(backends.map((b) => b.id), [
    BACKEND_IDS.OLLAMA, BACKEND_IDS.OPENCODE_GO, BACKEND_IDS.OPENCODE_ZEN,
    BACKEND_IDS.OPENROUTER, BACKEND_IDS.OPENCODE
  ]);
  await Promise.all(backends.map((b) => b.detect()));
  assert.equal(calls, 1);
  assert.equal(resolveRoutingDecision({
    backends: [{
      id: BACKEND_IDS.OPENCODE, available: true,
      models: [{ provider: BACKEND_IDS.OPENCODE, modelId: "opencode/claude-haiku-4-5", local: false, privacyClass: "cloud" }]
    }],
    cloudConsent: true
  }).backendId, null);
});
