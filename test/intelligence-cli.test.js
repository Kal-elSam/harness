import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

async function temporaryHome(t) {
  const homeDir = await mkdtemp(join(tmpdir(), "aptitude-cli-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  return homeDir;
}
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const kairoBin = join(packageRoot, "bin/kairo.js");

function runKairo(args, { env = process.env } = {}) {
  return spawnSync(process.execPath, [kairoBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...env,
      HARNESS_INK: "0",
      OPENROUTER_API_KEY: "",
      OLLAMA_HOST: "http://127.0.0.1:9"
    }
  });
}

test("intelligence command parses subactions and flags", () => {
  const { command, options } = parseArgs([
    "intelligence",
    "ask",
    "--prompt",
    "hello",
    "--cloud-consent",
    "--paths",
    "src/cli.js,.env",
    "--include-private"
  ]);

  assert.equal(command, "intelligence");
  assert.equal(options.intelligenceAction, "ask");
  assert.equal(options.intelligencePrompt, "hello");
  assert.equal(options.cloudConsent, true);
  assert.equal(options.includePrivate, true);
  assert.deepEqual(options.intelligencePaths, ["src/cli.js", ".env"]);
});

test("intelligence status works in diagnostics mode without backends", () => {
  const result = runKairo(["intelligence", "status", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.readOnly, true);
  assert.ok(Array.isArray(payload.backends));
  assert.equal(payload.routing.canInvoke, false);
});

test("intelligence route is read-only and explains privacy", () => {
  const result = runKairo(["intelligence", "route", "--task", "explain architecture", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.readOnly, true);
  assert.ok(payload.routing.reason);
  assert.ok(payload.estimatedTokens >= 0);
});

test("intelligence ask without backend stays diagnostics-safe", () => {
  const result = runKairo(["intelligence", "ask", "--prompt", "ping", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.diagnosticsOnly, true);
});

test("help documents intelligence command", () => {
  const result = runKairo(["help", "--all"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /intelligence/);
  assert.match(result.stdout, /OPENROUTER_API_KEY/);
});

test("aptitude actions parse and help documents authorization", () => {
  for (const action of ["aptitude-plan", "aptitude-run"]) {
    assert.equal(parseArgs(["intelligence", action, "--json"]).options.intelligenceAction, action);
  }
  const parsed = parseArgs(["intelligence", "aptitude-run", "--authorization", "{}"]);
  assert.equal(parsed.options.aptitudeAuthorization, "{}");
  const help = runKairo(["help", "--all"]);
  assert.match(help.stdout, /aptitude-plan/);
  assert.match(help.stdout, /aptitude-run/);
  assert.match(help.stdout, /--authorization/);
});

test("aptitude-run refuses without authorization and never invokes a runner", async () => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  let invokes = 0;
  await assert.rejects(runIntelligenceCli({ intelligenceAction: "aptitude-run", cwd: packageRoot }, {}, {
    runOperationalProbe: () => { invokes++; }
  }), /explicit operational authorization/);
  assert.equal(invokes, 0);
  const result = runKairo(["intelligence", "aptitude-run", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicit operational authorization/);
});

test("aptitude plan uses service preflight test double without running models", async (t) => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  let preflights = 0;
  let invokes = 0;
  t.mock.method(console, "log", () => {});
  const plan = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", cwd: packageRoot, json: true }, {}, {
    readAgentSessionTelemetry: async () => ({ records: [] }),
    listRunRecords: async () => [],
    preflightProject: async ({ cwd, mode }) => {
      preflights++;
      assert.equal(cwd, packageRoot);
      assert.equal(mode, "catalog");
      return { candidates: { scoredAll: [{ adapterId: "codex", modelId: "offline", costPerTask: 1, priceInputPerMTok: 1, priceOutputPerMTok: 2 }], providerCapacity: { codex: { quotaRemainingPercent: 80, quotaPaceFactor: 1 } } } };
    },
    runOperationalProbe: () => { invokes++; }
  });
  assert.equal(preflights, 1);
  assert.equal(invokes, 0);
  assert.equal(plan.roles.length, 6);
  assert.equal(plan.headroomProvider, "codex");
});

test("aptitude plan combines injected session and Kairo telemetry for measured median tokens", async (t) => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const homeDir = join(packageRoot, "offline-home");
  const logs = [];
  t.mock.method(console, "log", line => logs.push(line));
  let reads = 0;
  const plan = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", cwd: packageRoot }, {}, {
    homeDir,
    preflightProject: async () => ({ candidates: { scoredAll: [
      { adapterId: "codex", modelId: "offline", costPerTask: 1, priceInputPerMTok: 1, priceOutputPerMTok: 2 }
    ] } }),
    readAgentSessionTelemetry: async options => {
      reads++;
      assert.equal(options.projectsDir, join(homeDir, ".claude", "projects"));
      assert.equal(options.sessionsDir, join(process.env.CODEX_HOME ?? join(homeDir, ".codex"), "sessions"));
      return { records: [100, 300, 500].map(total => ({
        provider: "codex", model: "offline", role: "Builder", outcome: "completed",
        completedAt: "2026-10-19T00:00:00Z", tokens: { input: total, output: 0, total }
      })) };
    },
    listRunRecords: async home => {
      reads++;
      assert.equal(home, homeDir);
      return [700, 900].map(total => ({
        agentId: "codex", model: "offline", role: "Builder", state: "completed",
        completedAt: "2026-10-19T00:00:00Z", tokenUsage: { input: total, output: 0, total }
      }));
    }
  });
  assert.equal(reads, 2);
  const builder = plan.roles.find(entry => entry.role === "Builder");
  const estimate = builder.estimate["codex::offline"];
  assert.equal(estimate.tokenSource, "measured");
  assert.equal(estimate.tokens, builder.probes.length * 500);
  assert.ok(logs.some(line => line.includes(`tokens=${estimate.tokens} (measured)`)));
});

test("aptitude plan prints defaults when injected telemetry readers throw", async (t) => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const logs = [];
  t.mock.method(console, "log", line => logs.push(line));
  let reads = 0;
  const fail = async () => { reads++; throw new Error("telemetry unavailable"); };
  const plan = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", cwd: packageRoot }, {}, {
    preflightProject: async () => ({ candidates: { scoredAll: [
      { adapterId: "codex", modelId: "offline", costPerTask: 1, priceInputPerMTok: 1, priceOutputPerMTok: 2 }
    ] } }),
    readAgentSessionTelemetry: fail,
    listRunRecords: fail
  });
  assert.equal(reads, 2);
  for (const role of plan.roles) {
    const estimate = role.estimate["codex::offline"];
    assert.equal(estimate.tokenSource, "default");
    assert.equal(estimate.tokens, role.probes.length * plan.defaults.tokensPerCall);
  }
  assert.ok(logs.some(line => /tokens=\d+ \(default\)/.test(line)));
  assert.ok(logs.some(line => line.trimStart().startsWith("Totals:")));
});

test("aptitude-run rejects an unbound authorization before discovery", async () => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  let invokes = 0;
  await assert.rejects(runIntelligenceCli({ intelligenceAction: "aptitude-run", aptitudeAuthorization: {} }, {}, {
    preflightProject: () => { invokes++; throw new Error("must not discover"); }
  }), /authorization/);
  assert.equal(invokes, 0);
});

test("authorization request equals the exact binding checked at run time", async t => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const { buildAptitudeAuthorizationRequest } = await import("../src/global/intelligence/role-aptitude-run.js");
  t.mock.method(console, "log", () => {});
  const deps = {
    readAgentSessionTelemetry: async () => ({ records: [] }), listRunRecords: async () => [],
    preflightProject: async () => ({ candidates: { scoredAll: [
      { adapterId: "codex", modelId: "offline", costPerTask: 1 }
    ] } }),
    createRealBridgeInvokeAdapter: () => assert.fail("tests must never construct a real bridge adapter")
  };
  const plan = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", json: true }, {}, deps);
  const request = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", aptitudeAuthorization: "request", json: true }, {}, deps);
  assert.deepEqual(request, buildAptitudeAuthorizationRequest({ plan }));
  assert.equal(parseArgs(["intelligence", "aptitude-plan", "--authorization", "request"]).options.aptitudeAuthorization, "request");
});

test("CLI executes request-bound authorization through only an injected test double", async t => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const { asTestDoubleInvokeAdapter } = await import("../src/global/intelligence/role-aptitude-runner.js");
  const { buildSingleCallAuthorization } = await import("../src/global/intelligence/role-aptitude-authorization.js");
  const { createScriptedOperationalBridge, scriptedReceiptsForClaim } = await import("../src/global/intelligence/role-aptitude-bridge.js");
  t.mock.method(console, "log", () => {});
  let invokes = 0;
  const deps = {
    homeDir: await temporaryHome(t),
    readAgentSessionTelemetry: async () => ({ records: [] }), listRunRecords: async () => [],
    preflightProject: async () => ({ candidates: { scoredAll: [{ adapterId: "codex", modelId: "offline", costPerTask: 1 }] } }),
    invokeAdapter: asTestDoubleInvokeAdapter(() => { invokes++; return { structured: {} }; }),
    createRealBridgeInvokeAdapter: () => assert.fail("no real adapter construction in tests")
  };
  assert.equal(deps.invokeAdapter.executionKind, "test-double");
  const request = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", aptitudeAuthorization: "request" }, {}, deps);
  const grant = buildSingleCallAuthorization({
    provider: "codex", modelId: "offline", accountKey: "test",
    roles: [...new Set(request.calls.map(call => call.role))], maxCalls: request.maxCalls,
    absoluteTimeoutMs: 1000, maxOutputBytes: 1000
  });
  deps.authorizationContext = { bridge: createScriptedOperationalBridge(scriptedReceiptsForClaim(grant)) };
  const report = await runIntelligenceCli({
    intelligenceAction: "aptitude-run", aptitudeAuthorization: JSON.stringify({ ...request, grants: [grant] })
  }, {}, deps);
  assert.equal(report.planFingerprint, request.planFingerprint);
  assert.equal(invokes, request.maxCalls);
  assert.equal(report.calls, request.maxCalls);
});

test("CLI lazily constructs runtime adapter only after exact authorization checks", async t => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const { createRunInvokeAdapter } = await import("../src/global/intelligence/role-aptitude-invoke.js");
  const { buildSingleCallAuthorization } = await import("../src/global/intelligence/role-aptitude-authorization.js");
  const { createScriptedOperationalBridge, scriptedReceiptsForClaim } = await import("../src/global/intelligence/role-aptitude-bridge.js");
  const childProcess = (await import("node:child_process")).default;
  const spawn = t.mock.method(childProcess, "spawn", () => assert.fail("no real CLI may spawn"));
  t.mock.method(console, "log", () => {});
  let constructed = 0;
  const calls = [];
  const deps = {
    homeDir: await temporaryHome(t),
    readAgentSessionTelemetry: async () => ({ records: [] }), listRunRecords: async () => [],
    preflightProject: async () => ({ candidates: { scoredAll: [{ adapterId: "codex", modelId: "offline", costPerTask: 1 }] } }),
    createRunInvokeAdapter: args => { constructed++; return createRunInvokeAdapter(args); },
    startRun: async args => {
      calls.push(args);
      return { runId: "offline", completion: Promise.resolve({ state: "completed", tokenUsage: { total: 29 }, startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:03Z" }) };
    }
  };
  await assert.rejects(runIntelligenceCli({ intelligenceAction: "aptitude-run" }, {}, deps), /authorization/);
  assert.equal(constructed, 0);
  const request = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", aptitudeAuthorization: "request" }, {}, deps);
  const grant = buildSingleCallAuthorization({ provider: "codex", modelId: "offline", accountKey: "test", roles: [...new Set(request.calls.map(call => call.role))], maxCalls: request.maxCalls, absoluteTimeoutMs: 1000, maxOutputBytes: 1000 });
  deps.authorizationContext = { bridge: createScriptedOperationalBridge(scriptedReceiptsForClaim(grant)) };
  const authorization = { ...request, grants: [grant] };
  await assert.rejects(runIntelligenceCli({ intelligenceAction: "aptitude-run", aptitudeAuthorization: { ...authorization, planFingerprint: "wrong" } }, {}, deps), /binding/);
  assert.equal(constructed, 0);
  assert.equal(calls.length, 0);
  const report = await runIntelligenceCli({ intelligenceAction: "aptitude-run", aptitudeAuthorization: authorization }, {}, deps);
  assert.equal(constructed, 1);
  assert.equal(calls.length, request.maxCalls);
  assert.deepEqual(calls.map(call => [call.role, call.agentId, call.model]), request.calls.map(call => [call.role, call.provider, call.modelId]));
  assert.ok(report.results.every(row => row.tokens === 29 && row.durationMs === 3000));
  const { createPersistentRoleAptitudeEvidenceStore } = await import("../src/global/intelligence/role-aptitude-evidence.js");
  const persisted = await createPersistentRoleAptitudeEvidenceStore({ homeDir: deps.homeDir });
  const { getRoleAptitudeProbe } = await import("../src/global/intelligence/role-aptitude-probes.js");
  for (const call of request.calls) {
    const stored = persisted.getLastAttempt({ adapterId: call.provider, modelId: call.modelId,
      accountKey: "test", role: call.role, probeId: call.probeId, probeVersion: getRoleAptitudeProbe(call.probeId).probeVersion });
    assert.equal(stored.tokens, 29);
    assert.equal(stored.durationMs, 3000);
  }
  assert.equal(spawn.mock.callCount(), 0);
});

test("stage 2 authorization request is resolved from stored stage 1 results", async t => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const { buildAptitudeAuthorizationRequest } = await import("../src/global/intelligence/role-aptitude-run.js");
  const { createRoleAptitudeEvidenceStore } = await import("../src/global/intelligence/role-aptitude-evidence.js");
  t.mock.method(console, "log", () => {});
  const stage1 = { adapterId: "codex", modelId: "offline" };
  const near = { adapterId: "codex", modelId: "offline-near" };
  const strong = { adapterId: "codex", modelId: "offline-strong" };
  const probeId = "explorer.find-symbol-v1";
  const mixedPlan = { roles: [{ role: "Explorer", probes: [probeId], stage1: [stage1], stage2: [
    { model: near, reason: "within-near-equivalence-band" }, { model: strong, reason: "fallback-if-stage1-fails" }] }] };
  const record = (store, verdict) => store.recordAttempt({ ...stage1, role: "Explorer", probeId, probeVersion: "1", verdict });
  const base = {
    readAgentSessionTelemetry: async () => ({ records: [] }), listRunRecords: async () => [],
    preflightProject: async () => ({ candidates: { scoredAll: [] } }),
    buildAptitudePlan: () => mixedPlan
  };
  const options = { intelligenceAction: "aptitude-plan", aptitudeAuthorization: "request-stage-2" };
  await assert.rejects(runIntelligenceCli(options, {}, { ...base, evidenceStore: createRoleAptitudeEvidenceStore() }), /no stage 1 results/);
  const passed = createRoleAptitudeEvidenceStore();
  record(passed, "pass");
  const requestPass = await runIntelligenceCli(options, {}, { ...base, evidenceStore: passed });
  assert.deepEqual(requestPass.calls.map(call => call.modelId), ["offline-near"]);
  const failed = createRoleAptitudeEvidenceStore();
  record(failed, "fail");
  const requestFail = await runIntelligenceCli(options, {}, { ...base, evidenceStore: failed });
  assert.deepEqual(requestFail.calls.map(call => call.modelId), ["offline-near", "offline-strong"]);
  const rows = [{ role: "Explorer", provider: "codex", modelId: "offline", probeId, verdict: "fail" }];
  assert.deepEqual(requestFail, buildAptitudeAuthorizationRequest({ plan: mixedPlan, stage: 2, stageOneResults: rows }));
  const stage1Request = await runIntelligenceCli({ ...options, aptitudeAuthorization: "request" }, {}, { ...base, evidenceStore: failed });
  assert.equal(stage1Request.stage, 1);
});


test("CLI stage 2 request reads stage 1 evidence from an earlier persistent instance", async t => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const evidence = await import("../src/global/intelligence/role-aptitude-evidence.js");
  t.mock.method(console, "log", () => {});
  const homeDir = await temporaryHome(t);
  const first = await evidence.createPersistentRoleAptitudeEvidenceStore({ homeDir });
  const stage1 = { adapterId: "codex", modelId: "offline" };
  const probeId = "explorer.find-symbol-v1";
  first.recordAttempt({ ...stage1, role: "Explorer", probeId, probeVersion: "1", verdict: "pass" });
  await first.flush();
  const request = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", aptitudeAuthorization: "request-stage-2" }, {}, {
    homeDir, readAgentSessionTelemetry: async () => ({ records: [] }), listRunRecords: async () => [],
    preflightProject: async () => ({ candidates: { scoredAll: [] } }),
    buildAptitudePlan: () => ({ roles: [{ role: "Explorer", probes: [probeId], stage1: [stage1], stage2: [
      { model: { adapterId: "codex", modelId: "near" }, reason: "within-near-equivalence-band" },
      { model: { adapterId: "codex", modelId: "strong" }, reason: "fallback-if-stage1-fails" }
    ] }] })
  });
  assert.equal(request.stage, 2);
  assert.deepEqual(request.calls.map(call => call.modelId), ["near"]);
});

async function cliRunFixture(t, evidenceStoreFor) {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const { asTestDoubleInvokeAdapter } = await import("../src/global/intelligence/role-aptitude-runner.js");
  const { buildSingleCallAuthorization } = await import("../src/global/intelligence/role-aptitude-authorization.js");
  const { createScriptedOperationalBridge, scriptedReceiptsForClaim } = await import("../src/global/intelligence/role-aptitude-bridge.js");
  t.mock.method(console, "log", () => {});
  const deps = {
    homeDir: await temporaryHome(t),
    readAgentSessionTelemetry: async () => ({ records: [] }), listRunRecords: async () => [],
    preflightProject: async () => ({ candidates: { scoredAll: [{ adapterId: "codex", modelId: "offline", costPerTask: 1 }] } }),
    invokeAdapter: asTestDoubleInvokeAdapter(() => ({ structured: {} })),
    createRealBridgeInvokeAdapter: () => assert.fail("no real adapter construction in tests")
  };
  const request = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", aptitudeAuthorization: "request" }, {}, deps);
  const grant = buildSingleCallAuthorization({
    provider: "codex", modelId: "offline", accountKey: "test",
    roles: [...new Set(request.calls.map(call => call.role))], maxCalls: request.maxCalls,
    absoluteTimeoutMs: 1000, maxOutputBytes: 1000
  });
  deps.authorizationContext = { bridge: createScriptedOperationalBridge(scriptedReceiptsForClaim(grant)) };
  if (evidenceStoreFor) deps.evidenceStore = await evidenceStoreFor(deps);
  const run = () => runIntelligenceCli({
    intelligenceAction: "aptitude-run", aptitudeAuthorization: JSON.stringify({ ...request, grants: [grant] })
  }, {}, deps);
  return { run, deps };
}

test("aptitude-run persists evidence to disk before returning", async t => {
  const { createPersistentRoleAptitudeEvidenceStore } = await import("../src/global/intelligence/role-aptitude-evidence.js");
  const { run, deps } = await cliRunFixture(t);
  const report = await run();
  assert.equal(report.evidencePersisted, true);
  const reopened = await createPersistentRoleAptitudeEvidenceStore({ homeDir: deps.homeDir });
  assert.equal(reopened.getLastAttempt({ adapterId: "codex", modelId: "offline", accountKey: "test", role: "Explorer", probeId: "explorer.find-symbol-v1", probeVersion: "1" })?.executionKind, "test-double");
  const { readFile } = await import("node:fs/promises");
  const { harnessHomePaths } = await import("../src/global/paths.js");
  const text = await readFile(harnessHomePaths(deps.homeDir).roleAptitudeEvidencePath, "utf8");
  assert.ok(JSON.parse(text).attempts.length > 0);
});

test("aptitude-run exits non-zero when evidence cannot be flushed", async t => {
  const { createRoleAptitudeEvidenceStore } = await import("../src/global/intelligence/role-aptitude-evidence.js");
  const { run } = await cliRunFixture(t, async () => ({
    ...createRoleAptitudeEvidenceStore(), flush: async () => { throw new Error("disk full"); }
  }));
  await assert.rejects(run(), /evidence was not persisted.*disk full/i);
});

test("CLI default path uses the subscription bridge with injected readers", async t => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const { asTestDoubleInvokeAdapter } = await import("../src/global/intelligence/role-aptitude-runner.js");
  const { buildSingleCallAuthorization } = await import("../src/global/intelligence/role-aptitude-authorization.js");
  t.mock.method(console, "log", () => {});
  let invokes = 0;
  const readers = {
    readClaudeAuthStatus: async () => ({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" }),
    readCodexLoginStatus: async () => "Logged in using ChatGPT"
  };
  const deps = {
    homeDir: await temporaryHome(t),
    readAgentSessionTelemetry: async () => ({ records: [] }), listRunRecords: async () => [],
    preflightProject: async () => ({ candidates: { scoredAll: [{ adapterId: "codex", modelId: "offline", costPerTask: 1 }] } }),
    invokeAdapter: asTestDoubleInvokeAdapter(() => { invokes++; return { structured: {} }; }),
    subscriptionBridgeOptions: { ...readers, env: {} }
  };
  const request = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", aptitudeAuthorization: "request" }, {}, deps);
  const grant = buildSingleCallAuthorization({
    provider: "codex", modelId: "offline", accountKey: "test",
    roles: [...new Set(request.calls.map(call => call.role))], maxCalls: request.maxCalls,
    absoluteTimeoutMs: 1000, maxOutputBytes: 1000
  });
  const report = await runIntelligenceCli({
    intelligenceAction: "aptitude-run", aptitudeAuthorization: JSON.stringify({ ...request, grants: [grant] })
  }, {}, deps);
  assert.equal(report.calls, request.maxCalls);
  assert.equal(invokes, request.maxCalls);
});

test("CLI default subscription bridge refuses when an API key is in the environment", async t => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const { buildSingleCallAuthorization } = await import("../src/global/intelligence/role-aptitude-authorization.js");
  t.mock.method(console, "log", () => {});
  const deps = {
    homeDir: await temporaryHome(t),
    subscriptionBridgeOptions: {
      readClaudeAuthStatus: async () => null,
      readCodexLoginStatus: async () => "Logged in using ChatGPT",
      env: { OPENAI_API_KEY: "x" }
    }
  };
  const grant = buildSingleCallAuthorization({
    provider: "codex", modelId: "offline", accountKey: "test", roles: ["Explorer"], maxCalls: 1,
    absoluteTimeoutMs: 1000, maxOutputBytes: 1000
  });
  await assert.rejects(
    runIntelligenceCli({
      intelligenceAction: "aptitude-run",
      aptitudeAuthorization: JSON.stringify({ planFingerprint: "x", grants: [grant] })
    }, {}, deps),
    /api_key_present/
  );
});

test("aptitude-run warns about retained transcripts and never prints model-controlled text", async t => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const { buildSingleCallAuthorization } = await import("../src/global/intelligence/role-aptitude-authorization.js");
  const { createScriptedOperationalBridge, scriptedReceiptsForClaim } = await import("../src/global/intelligence/role-aptitude-bridge.js");
  const { runPaths } = await import("../src/global/paths.js");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const lines = [];
  t.mock.method(console, "log", (...args) => lines.push(args.join(" ")));
  const secret = "MODEL-CONTROLLED-9f3a/../etc/passwd";
  const homeDir = await temporaryHome(t);
  const deps = {
    homeDir,
    readAgentSessionTelemetry: async () => ({ records: [] }), listRunRecords: async () => [],
    preflightProject: async () => ({ candidates: { scoredAll: [{ adapterId: "codex", modelId: "offline", costPerTask: 1 }] } }),
    startRun: async () => {
      const { runDir, eventsPath, transcriptPath } = runPaths(homeDir, "stuck");
      mkdirSync(join(eventsPath, "x"), { recursive: true });
      mkdirSync(runDir, { recursive: true });
      const structured = { definitionPath: secret, emptyArrayBehavior: secret, citations: [{ path: secret, line: 1 }] };
      writeFileSync(transcriptPath, JSON.stringify({ type: "run.transcript", data: { result: JSON.stringify({ structured }) } }) + "\n");
      return { runId: "stuck", completion: Promise.resolve({ state: "completed", startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:01Z" }) };
    }
  };
  const request = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", aptitudeAuthorization: "request" }, {}, deps);
  const grant = buildSingleCallAuthorization({ provider: "codex", modelId: "offline", accountKey: "test", roles: [...new Set(request.calls.map(call => call.role))], maxCalls: request.maxCalls, absoluteTimeoutMs: 1000, maxOutputBytes: 1000 });
  deps.authorizationContext = { bridge: createScriptedOperationalBridge(scriptedReceiptsForClaim(grant)) };
  lines.length = 0;
  const report = await runIntelligenceCli({ intelligenceAction: "aptitude-run", aptitudeAuthorization: { ...request, grants: [grant] } }, {}, deps);
  const output = lines.join("\n");
  assert.ok(report.results.every(row => row.transcriptRetained === true));
  assert.match(output, /WARNING: .*transcript.*retained/i);
  assert.ok(!output.includes("MODEL-CONTROLLED"), "model-controlled text must not reach stdout");
  assert.ok(report.results.some(row => row.errorCode));
});

test("--roles and --read-only-roles parse and are documented", () => {
  assert.deepEqual(parseArgs(["intelligence", "aptitude-plan", "--roles", "Explorer,Architect"]).options.aptitudeRoles, ["Explorer", "Architect"]);
  assert.deepEqual(parseArgs(["intelligence", "aptitude-plan", "--roles=Reviewer"]).options.aptitudeRoles, ["Reviewer"]);
  assert.equal(parseArgs(["intelligence", "aptitude-plan", "--read-only-roles"]).options.aptitudeReadOnlyRoles, true);
  const help = runKairo(["help", "--all"]);
  assert.match(help.stdout, /--roles/);
  assert.match(help.stdout, /--read-only-roles/);
});

test("--read-only-roles plans only probes without editable paths", async t => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  t.mock.method(console, "log", () => {});
  const deps = {
    readAgentSessionTelemetry: async () => ({ records: [] }), listRunRecords: async () => [],
    preflightProject: async () => ({ candidates: { scoredAll: [{ adapterId: "codex", modelId: "offline", costPerTask: 1 }] } })
  };
  const { listRoleAptitudeProbes } = await import("../src/global/intelligence/role-aptitude-probes.js");
  const expected = listRoleAptitudeProbes().filter(p => p.editablePaths.length === 0).map(p => p.probeId).sort();
  const plan = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", aptitudeReadOnlyRoles: true, json: true }, {}, deps);
  assert.deepEqual(plan.roles.flatMap(r => r.probes).sort(), expected);
  assert.deepEqual(plan.roles.map(r => r.role).sort(), ["Architect", "Explorer", "Reviewer"]);
  await assert.rejects(runIntelligenceCli({ intelligenceAction: "aptitude-plan", aptitudeRoles: ["Bogus"], json: true }, {}, deps), /Bogus/);
});

test("authorization for filtered roles is refused by a run with a different role set", async t => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const { asTestDoubleInvokeAdapter } = await import("../src/global/intelligence/role-aptitude-runner.js");
  const { buildSingleCallAuthorization } = await import("../src/global/intelligence/role-aptitude-authorization.js");
  const { createScriptedOperationalBridge, scriptedReceiptsForClaim } = await import("../src/global/intelligence/role-aptitude-bridge.js");
  t.mock.method(console, "log", () => {});
  let invokes = 0;
  const deps = {
    homeDir: await temporaryHome(t),
    readAgentSessionTelemetry: async () => ({ records: [] }), listRunRecords: async () => [],
    preflightProject: async () => ({ candidates: { scoredAll: [{ adapterId: "codex", modelId: "offline", costPerTask: 1 }] } }),
    invokeAdapter: asTestDoubleInvokeAdapter(() => { invokes++; return { structured: {} }; }),
    createRealBridgeInvokeAdapter: () => assert.fail("no real adapter construction in tests")
  };
  const filtered = { aptitudeReadOnlyRoles: true };
  const request = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", aptitudeAuthorization: "request", ...filtered }, {}, deps);
  const grant = buildSingleCallAuthorization({
    provider: "codex", modelId: "offline", accountKey: "test",
    roles: [...new Set(request.calls.map(call => call.role))], maxCalls: request.maxCalls,
    absoluteTimeoutMs: 1000, maxOutputBytes: 1000
  });
  deps.authorizationContext = { bridge: createScriptedOperationalBridge(scriptedReceiptsForClaim(grant)) };
  const authorization = JSON.stringify({ ...request, grants: [grant] });
  await assert.rejects(runIntelligenceCli({ intelligenceAction: "aptitude-run", aptitudeAuthorization: authorization }, {}, deps));
  await assert.rejects(runIntelligenceCli({ intelligenceAction: "aptitude-run", aptitudeAuthorization: authorization, aptitudeRoles: ["Explorer"] }, {}, deps));
  assert.equal(invokes, 0);
  const report = await runIntelligenceCli({ intelligenceAction: "aptitude-run", aptitudeAuthorization: authorization, ...filtered }, {}, deps);
  assert.equal(report.planFingerprint, request.planFingerprint);
  assert.equal(invokes, request.maxCalls);
});

test("CLI report carries error verdict, tokens and launch diagnostic for a failed Codex run", async t => {
  const { runIntelligenceCli } = await import("../src/global/intelligence-cli.js");
  const { buildSingleCallAuthorization } = await import("../src/global/intelligence/role-aptitude-authorization.js");
  const { createScriptedOperationalBridge, scriptedReceiptsForClaim } = await import("../src/global/intelligence/role-aptitude-bridge.js");
  const { runPaths } = await import("../src/global/paths.js");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  t.mock.method(console, "log", () => {});
  const homeDir = await temporaryHome(t);
  const deps = {
    homeDir,
    readAgentSessionTelemetry: async () => ({ records: [] }), listRunRecords: async () => [],
    preflightProject: async () => ({ candidates: { scoredAll: [{ adapterId: "codex", modelId: "offline", costPerTask: 1 }] } }),
    startRun: async () => {
      const { runDir, eventsPath } = runPaths(homeDir, "cli-fail");
      mkdirSync(runDir, { recursive: true });
      writeFileSync(eventsPath, JSON.stringify({ type: "process.stdout", data: { line: "unexpected argument --nope" } }) + "\n");
      return { runId: "cli-fail", completion: Promise.resolve({ state: "failed", error: "Process exited with code 1", exitCode: 1, tokenUsage: { input: 7, output: 3, total: null }, startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:01Z" }) };
    }
  };
  const request = await runIntelligenceCli({ intelligenceAction: "aptitude-plan", aptitudeAuthorization: "request" }, {}, deps);
  const grant = buildSingleCallAuthorization({ provider: "codex", modelId: "offline", accountKey: "test", roles: [...new Set(request.calls.map(call => call.role))], maxCalls: request.maxCalls, absoluteTimeoutMs: 1000, maxOutputBytes: 1000 });
  deps.authorizationContext = { bridge: createScriptedOperationalBridge(scriptedReceiptsForClaim(grant)) };
  const report = await runIntelligenceCli({ intelligenceAction: "aptitude-run", aptitudeAuthorization: { ...request, grants: [grant] } }, {}, deps);
  const row = report.results[0];
  assert.equal(row.verdict, "error");
  assert.equal(row.errorKind, "run_failed");
  assert.equal(row.tokens, 10);
  assert.deepEqual(row.tokenUsage, { input: 7, output: 3, total: 10 });
  assert.deepEqual(row.launchDiagnostic, { exitCode: 1, stderrFirstLine: "unexpected argument --nope" });
});
