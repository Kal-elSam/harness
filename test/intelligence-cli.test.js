import test from "node:test";
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
  assert.equal(spawn.mock.callCount(), 0);
});
