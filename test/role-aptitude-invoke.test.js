import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir, devNull } from "node:os";
import { dirname, join } from "node:path";
import { runPaths } from "../src/global/paths.js";
import { listRoleAptitudeProbes, materializeProbeWorkspace, listRelativeFiles } from "../src/global/intelligence/role-aptitude-probes.js";
import { createRunInvokeAdapter } from "../src/global/intelligence/role-aptitude-invoke.js";

const structured = { definitionPath: "src/compute-total.js", emptyArrayBehavior: "throws TypeError", citations: [{ path: "src/compute-total.js", line: 1 }] };
for (const probe of listRoleAptitudeProbes()) {
  for (const provider of ["claude", "codex"]) test(`${provider} ${probe.role}: bounded runtime arguments and final metrics`, async t => {
    const homeDir = mkdtempSync(join(tmpdir(), "invoke-test-"));
    t.after(() => rmSync(homeDir, { recursive: true, force: true }));
    const spawn = t.mock.method(childProcess, "spawn", () => assert.fail("no real CLI may spawn"));
    let calls = 0;
    let workspace;
    const adapter = createRunInvokeAdapter({ homeDir, materializeWorkspace: id => {
      workspace = materializeProbeWorkspace(id);
      t.after(workspace.dispose);
      return workspace;
    }, startRun: async args => {
      calls++;
      assert.equal(args.agentId, provider);
      assert.equal(args.model, "offline");
      assert.equal(args.cwd, workspace.workspaceRoot);
      assert.equal(args.role, probe.role);
      assert.deepEqual(args.permissions, probe.editablePaths.length ? [] : ["read-only"]);
      assert.equal(args.requireVerifiedWriteContainment, probe.editablePaths.length > 0);
      assert.equal(args.allowUnsafePermissions, false);
      assert.equal(args.permissionSource, "aptitude");
      assert.equal(args.timeoutMs, 1000);
      assert.equal(args.wait, true);
      assert.equal(args.captureTranscript, !["Builder", "Tester"].includes(probe.role));
      assert.ok(args.task.includes(probe.prompt));
      const { transcriptPath } = runPaths(homeDir, "offline-run");
      mkdirSync(dirname(transcriptPath), { recursive: true });
      writeFileSync(transcriptPath, JSON.stringify({ type: "run.transcript", data: { result: '```json\n' + JSON.stringify({ structured }) + '\n```' } }) + '\n');
      return { runId: "offline-run", completion: Promise.resolve({ state: "completed", tokenUsage: { total: 23 }, cost: 0.01, startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:02Z" }) };
    } });
    const result = await adapter({ probe, identity: { adapterId: provider, modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 2000 } });
    assert.equal(calls, 1);
    assert.equal(spawn.mock.callCount(), 0);
    assert.equal(result.tokens, 23);
    assert.equal(result.durationMs, 2000);
    assert.equal(result.workspaceRoot, workspace.workspaceRoot);
    assert.deepEqual(result.snapshotPaths, { changed: [] });
    assert.deepEqual(result.structured, ["Builder", "Tester"].includes(probe.role) ? {} : structured);
  });
}
for (const [state, error, kind] of [["failed", "idle timeout", "timeout"], ["failed", "exit 1", "run_failed"], ["completed", null, "unparsable_output"]]) {
  test(`maps ${kind} without retry or spawn`, async t => {
    const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
    t.after(workspace.dispose);
    const spawn = t.mock.method(childProcess, "spawn", () => assert.fail("no real CLI"));
    let calls = 0;
    const adapter = createRunInvokeAdapter({ homeDir: workspace.workspaceRoot, startRun: async () => {
      calls++;
      return { runId: "absent", completion: Promise.resolve({ state, error, tokenUsage: { total: 7 }, startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:01Z" }) };
    } });
    const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 2000 } });
    assert.equal(result.errorKind, kind);
    assert.equal(result.tokens, 7);
    assert.equal(result.durationMs, 1000);
    assert.equal(calls, 1);
    assert.equal(spawn.mock.callCount(), 0);
  });
}

test("absolute deadline kills the runtime child without launching any real CLI", async t => {
  const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
  t.after(workspace.dispose);
  const signals = [];
  let finish;
  const completion = new Promise(resolve => { finish = resolve; });
  const kill = t.mock.method(process, "kill", (pid, signal) => {
    assert.equal(pid, -12345, "kill the dedicated process group, not only the CLI");
    signals.push(signal);
    finish({ state: "failed", error: "killed", tokenUsage: { total: 11 }, startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:01Z" });
  });
  const spawn = t.mock.method(childProcess, "spawn", (_command, _argv, options) => {
    assert.equal(options.detached, true);
    return { pid: 12345, kill: () => assert.fail("must terminate process group") };
  });
  let calls = 0;
  const adapter = createRunInvokeAdapter({ startRun: async args => {
    calls++;
    args.spawnImpl("offline-test-double", []);
    return { runId: "offline", completion };
  } });
  const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 20, maxOutputBytes: 1000 } });
  assert.equal(calls, 1);
  assert.equal(spawn.mock.callCount(), 1, "only the fake spawn is called");
  assert.deepEqual(signals, ["SIGKILL"]);
  assert.equal(kill.mock.callCount(), 1);
  assert.equal(result.tokens, 11);
  assert.equal(result.durationMs, 1000);
  assert.equal(result.errorKind, "timeout");
});

test("borrowed runner workspace and changed paths are returned unchanged", async t => {
  const workspace = materializeProbeWorkspace("builder.apply-fix-v1");
  t.after(workspace.dispose);
  const spawn = t.mock.method(childProcess, "spawn", () => assert.fail("no real CLI"));
  const adapter = createRunInvokeAdapter({ materializeWorkspace: () => assert.fail("runner already materialized"), startRun: async args => {
    writeFileSync(join(args.cwd, "src/compute-total.js"), "export function computeTotal(items) { return items.reduce((sum, item) => sum + item.value, 0); }\n");
    return { runId: "offline", completion: Promise.resolve({ state: "completed" }) };
  } });
  const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "claude", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 1000 } });
  assert.equal(result.workspaceRoot, workspace.workspaceRoot);
  assert.deepEqual(result.snapshotPaths.changed, ["src/compute-total.js"]);
  assert.equal(result.errorKind, null);
  assert.equal(spawn.mock.callCount(), 0);
});

test("absolute deadline cancels active runtime and awaits cancellation plus completion despite activity", async t => {
  const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
  t.after(workspace.dispose);
  let finish;
  let cancelFinished = false;
  let activity = 0;
  const completion = new Promise(resolve => { finish = resolve; });
  const interval = setInterval(() => { activity++; }, 2);
  t.after(() => clearInterval(interval));
  const adapter = createRunInvokeAdapter({
    startRun: async () => ({ runId: "active-double", completion }),
    cancelRun: async (_home, id, options) => {
      assert.equal(id, "active-double");
      assert.equal(options.signal, "SIGKILL");
      await new Promise(resolve => setTimeout(resolve, 10));
      cancelFinished = true;
      setTimeout(() => finish({ state: "cancelled", tokenUsage: { total: 19 } }), 10);
    }
  });
  // Bound the old implementation so RED never hangs on its unbounded cleanup.
  t.after(() => finish({ state: "cancelled" }));
  const result = await Promise.race([
    adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 20, maxOutputBytes: 1000, cleanupGraceMs: 80 } }),
    new Promise(resolve => setTimeout(() => resolve({ errorKind: "test-watchdog" }), 200))
  ]);
  assert.equal(result.errorKind, "timeout");
  assert.equal(cancelFinished, true);
  assert.ok(activity > 2);
  assert.equal(result.tokens, 19);
  assert.equal(result.cleanupFailed, false);
});

test("uncancellable preflight deadline reports cleanup failure and prevents late task spawn", async t => {
  const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
  t.after(workspace.dispose);
  let release;
  let lateSpawnError;
  let cancellations = 0;
  const spawn = t.mock.method(childProcess, "spawn", () => assert.fail("late task must not spawn"));
  const adapter = createRunInvokeAdapter({
    startRun: async args => {
      await new Promise(resolve => { release = resolve; });
      try { args.spawnImpl("offline", []); } catch (error) { lateSpawnError = error; throw error; }
    },
    cancelRun: async () => { cancellations++; }
  });
  t.after(() => release());
  const result = await Promise.race([
    adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "claude", modelId: "offline" }, limits: { absoluteTimeoutMs: 15, cleanupGraceMs: 20, maxOutputBytes: 1000 } }),
    new Promise(resolve => setTimeout(() => resolve({ errorKind: "test-watchdog" }), 200))
  ]);
  assert.equal(result.errorKind, "timeout");
  assert.equal(result.cleanupFailed, true);
  assert.match(result.preflightCancellationLimitation, /preflight/i);
  assert.equal(cancellations, 0, "no registered run exists during initial preflight");
  release();
  await result.cleanupCompletion;
  assert.match(lateSpawnError.message, /timeout/);
  assert.equal(spawn.mock.callCount(), 0);
});

function seedRun(homeDir, runId, withTranscript = true) {
  const { runDir, statePath, eventsPath, transcriptPath } = runPaths(homeDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify({ runId, role: "Explorer", tokenUsage: { total: 5 } }));
  writeFileSync(eventsPath, "RAW-EVENT\n");
  if (withTranscript) writeFileSync(transcriptPath, JSON.stringify({ type: "run.transcript", data: { result: JSON.stringify({ structured }) } }) + "\n");
}
const doneRecord = { state: "completed", tokenUsage: { total: 5 }, startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:01Z" };

for (const [label, record] of [["success", doneRecord], ["failure", { ...doneRecord, state: "failed", error: "exit 1" }]]) {
  test(`raw transcript and events are removed after ${label}; state and other runs stay`, async t => {
    const homeDir = mkdtempSync(join(tmpdir(), "invoke-scrub-"));
    t.after(() => rmSync(homeDir, { recursive: true, force: true }));
    const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
    t.after(workspace.dispose);
    seedRun(homeDir, "other-run");
    const adapter = createRunInvokeAdapter({ homeDir, startRun: async () => {
      seedRun(homeDir, "scrub-run");
      return { runId: "scrub-run", completion: Promise.resolve(record) };
    } });
    const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 2000 } });
    if (label === "success") assert.deepEqual(result.structured, structured);
    assert.equal(result.transcriptRetained, false);
    const mine = runPaths(homeDir, "scrub-run");
    assert.equal(existsSync(mine.transcriptPath), false);
    assert.equal(existsSync(mine.eventsPath), false);
    assert.ok(existsSync(mine.statePath), "state record kept for telemetry");
    const other = runPaths(homeDir, "other-run");
    assert.ok(existsSync(other.transcriptPath) && existsSync(other.eventsPath) && existsSync(other.statePath));
    assert.equal(readFileSync(other.eventsPath, "utf8"), "RAW-EVENT\n");
  });
}

test("removal failure is reported as transcriptRetained true", async t => {
  const homeDir = mkdtempSync(join(tmpdir(), "invoke-scrub-"));
  t.after(() => rmSync(homeDir, { recursive: true, force: true }));
  const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
  t.after(workspace.dispose);
  const adapter = createRunInvokeAdapter({ homeDir, startRun: async () => {
    seedRun(homeDir, "stuck-run", false);
    // A non-empty directory at the events path makes removal fail.
    const { eventsPath, transcriptPath } = runPaths(homeDir, "stuck-run");
    rmSync(eventsPath);
    mkdirSync(join(eventsPath, "x"), { recursive: true });
    writeFileSync(transcriptPath, JSON.stringify({ type: "run.transcript", data: { result: JSON.stringify({ structured }) } }) + "\n");
    return { runId: "stuck-run", completion: Promise.resolve(doneRecord) };
  } });
  const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 2000 } });
  assert.equal(result.transcriptRetained, true);
});

test("probes without structured output run with captureTranscript false and retain nothing", async t => {
  const homeDir = mkdtempSync(join(tmpdir(), "invoke-scrub-"));
  t.after(() => rmSync(homeDir, { recursive: true, force: true }));
  const probe = listRoleAptitudeProbes().find(p => p.role === "Builder");
  const workspace = materializeProbeWorkspace(probe.probeId);
  t.after(workspace.dispose);
  let captured;
  const adapter = createRunInvokeAdapter({ homeDir, startRun: async args => {
    captured = args.captureTranscript;
    seedRun(homeDir, "builder-run", false);
    return { runId: "builder-run", completion: Promise.resolve(doneRecord) };
  } });
  const result = await adapter({ probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 2000 } });
  assert.equal(captured, false);
  assert.equal(result.transcriptRetained, false);
  assert.equal(existsSync(runPaths(homeDir, "builder-run").eventsPath), false);
});

const PROVIDER_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"];
for (const provider of ["claude", "codex"]) test(`${provider}: spawned child environment carries no provider billing key`, async t => {
  const homeDir = mkdtempSync(join(tmpdir(), "invoke-env-"));
  t.after(() => rmSync(homeDir, { recursive: true, force: true }));
  const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
  t.after(workspace.dispose);
  const adapter = createRunInvokeAdapter({ homeDir, startRun: async args => {
    // Model the runtime: adapters hand spawnImpl the live process environment.
    const env = { ...process.env, PATH: process.env.PATH, ...Object.fromEntries(PROVIDER_KEYS.map(key => [key, "sk-leak"])), keep_me: "1" };
    const child = args.spawnImpl(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], { cwd: args.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", chunk => { out += chunk; });
    await new Promise(resolve => child.on("close", resolve));
    const seen = JSON.parse(out);
    for (const key of PROVIDER_KEYS) assert.equal(seen[key], undefined, `${key} leaked into child`);
    assert.equal(seen.keep_me, "1");
    seedRun(homeDir, "env-run");
    return { runId: "env-run", completion: Promise.resolve(doneRecord) };
  } });
  const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: provider, modelId: "offline" }, limits: { absoluteTimeoutMs: 5000, maxOutputBytes: 2000 } });
  assert.equal(result.errorKind, null, result.error);
});

test("failed run keeps a sanitized launch diagnostic while events are still scrubbed", async t => {
  const homeDir = mkdtempSync(join(tmpdir(), "invoke-diag-"));
  t.after(() => rmSync(homeDir, { recursive: true, force: true }));
  const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
  t.after(workspace.dispose);
  const fakeToken = "sk-FAKEFAKEFAKEFAKE12345678";
  const stderrLine = `error: auth failed token=${fakeToken} for sam@example.com in /Users/someone/.codex/config.toml ${"x".repeat(400)}`;
  const adapter = createRunInvokeAdapter({ homeDir, startRun: async () => {
    seedRun(homeDir, "diag-run");
    const { eventsPath } = runPaths(homeDir, "diag-run");
    writeFileSync(eventsPath, [
      { type: "run.started", data: {} },
      { type: "process.stdout", data: { line: "\n" } },
      { type: "process.stdout", data: { line: stderrLine } },
      { type: "process.stdout", data: { line: "second line is ignored" } },
      { type: "run.failed", data: { exitCode: 1 } }
    ].map(event => JSON.stringify(event)).join("\n") + "\n");
    return { runId: "diag-run", completion: Promise.resolve({ ...doneRecord, state: "failed", error: "Process exited with code 1" }) };
  } });
  const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 2000 } });
  assert.equal(result.errorKind, "run_failed");
  assert.equal(result.launchDiagnostic.exitCode, 1);
  const line = result.launchDiagnostic.stderrFirstLine;
  assert.ok(line.startsWith("error: auth failed"));
  assert.ok(!line.includes(fakeToken) && !line.includes("sam@example.com") && !line.includes("/Users/someone"), line);
  assert.ok(line.length <= 303);
  assert.ok(!line.includes("second line"));
  assert.equal(existsSync(runPaths(homeDir, "diag-run").eventsPath), false);
  assert.equal(result.transcriptRetained, false);
});

test("model output in a failed run never enters the launch diagnostic", async t => {
  const homeDir = mkdtempSync(join(tmpdir(), "invoke-diag-"));
  t.after(() => rmSync(homeDir, { recursive: true, force: true }));
  const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
  t.after(workspace.dispose);
  const adapter = createRunInvokeAdapter({ homeDir, startRun: async () => {
    seedRun(homeDir, "model-run");
    writeFileSync(runPaths(homeDir, "model-run").eventsPath, [
      { type: "agent.assistant", data: { text: "MODEL-ANSWER" } },
      { type: "process.stdout", data: { line: "MODEL-PROSE" } },
      { type: "run.failed", data: { exitCode: 2 } }
    ].map(event => JSON.stringify(event)).join("\n") + "\n");
    return { runId: "model-run", completion: Promise.resolve({ ...doneRecord, state: "failed", error: "Process exited with code 2" }) };
  } });
  const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "claude", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 2000 } });
  assert.deepEqual(result.launchDiagnostic, { exitCode: 2, stderrFirstLine: null });
});

test("token usage with a null total maps to input, output and total = input + output", async t => {
  const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
  t.after(workspace.dispose);
  const adapter = createRunInvokeAdapter({ homeDir: workspace.workspaceRoot, startRun: async () => ({ runId: "absent", completion: Promise.resolve({
    state: "failed", error: "exit 1", tokenUsage: { input: 120, output: 30, total: null }, startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:01Z" }) }) });
  const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "claude", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 2000 } });
  assert.deepEqual(result.tokenUsage, { input: 120, output: 30, total: 150 });
  assert.equal(result.tokens, 150);
});

for (const borrowed of [false, true]) test(`probe git preparation precedes startRun (${borrowed ? "borrowed" : "owned"}) and isolates user configuration`, async t => {
  const workspace = materializeProbeWorkspace("builder.apply-fix-v1");
  t.after(workspace.dispose);
  const fakeHome = mkdtempSync(join(tmpdir(), "aptitude-git-config-"));
  t.after(() => rmSync(fakeHome, { recursive: true, force: true }));
  const hooks = join(fakeHome, "hooks");
  const template = join(fakeHome, "template");
  const marker = join(fakeHome, "hook-ran");
  mkdirSync(hooks);
  mkdirSync(template);
  writeFileSync(join(hooks, "pre-commit"), `#!/bin/sh\necho unsafe > "${marker}"\nexit 1\n`, { mode: 0o755 });
  writeFileSync(join(template, "unsafe-template"), "must not be copied");
  const config = join(fakeHome, "gitconfig");
  writeFileSync(config, `[core]\n hooksPath = "${hooks}"\n[commit]\n gpgSign = true\n[gpg]\n program = must-not-run-signing\n[init]\n templateDir = "${template}"\n`);
  const injected = {
    GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: config,
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: hooks,
    GIT_DIR: join(fakeHome, "wrong-repo"), GIT_WORK_TREE: fakeHome,
    GIT_TEMPLATE_DIR: template, GIT_AUTHOR_NAME: "Ambient User", GIT_AUTHOR_EMAIL: "ambient@example.com"
  };
  const saved = Object.fromEntries(Object.keys(injected).map(key => [key, process.env[key]]));
  Object.assign(process.env, injected);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const realSpawnSync = childProcess.spawnSync;
  const gitCalls = [];
  t.mock.method(childProcess, "spawnSync", (command, args, options) => {
    assert.equal(command, "git");
    assert.equal(options.cwd, workspace.workspaceRoot);
    assert.equal(options.env.GIT_CONFIG_GLOBAL, devNull);
    assert.equal(options.env.GIT_CONFIG_SYSTEM, devNull);
    assert.equal(options.env.GIT_CONFIG_COUNT, undefined);
    assert.equal(options.env.GIT_DIR, undefined);
    assert.equal(options.env.GIT_WORK_TREE, undefined);
    assert.equal(options.env.GIT_TEMPLATE_DIR, undefined);
    assert.equal(options.env.GIT_AUTHOR_NAME, undefined);
    gitCalls.push(args);
    return realSpawnSync(command, args, options);
  });
  const git = args => {
    const result = realSpawnSync("git", args, { cwd: workspace.workspaceRoot, encoding: "utf8", env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: config + ".missing", GIT_CONFIG_SYSTEM: config + ".missing" } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  writeFileSync(join(workspace.workspaceRoot, ".gitignore"), "ignored-probe.txt\n");
  writeFileSync(join(workspace.workspaceRoot, "ignored-probe.txt"), "probe data must be committed");
  const files = listRelativeFiles(workspace.workspaceRoot);
  let starts = 0;
  const adapter = createRunInvokeAdapter({
    materializeWorkspace: () => workspace,
    startRun: async args => {
      starts++;
      assert.equal(git(["rev-parse", "--show-toplevel"]), realpathSync(workspace.workspaceRoot));
      assert.equal(git(["rev-list", "--count", "HEAD"]), "1");
      assert.deepEqual(git(["ls-tree", "-r", "--name-only", "HEAD"]).split("\n").sort(), files);
      assert.equal(git(["status", "--porcelain"]), "");
      assert.equal(git(["log", "-1", "--format=%an <%ae>"]), "Aptitude Probe <aptitude-probe@example.invalid>");
      assert.equal(git(["config", "--local", "user.name"]), "Aptitude Probe");
      assert.equal(git(["config", "--local", "user.email"]), "aptitude-probe@example.invalid");
      assert.equal(existsSync(join(args.cwd, ".git", "unsafe-template")), false);
      assert.equal(existsSync(marker), false);
      return { runId: "offline", completion: Promise.resolve({ state: "completed" }) };
    }
  });
  const result = await adapter({ probe: workspace.probe, ...(borrowed ? { workspaceRoot: workspace.workspaceRoot } : {}), identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 1000 } });
  assert.equal(starts, 1);
  assert.ok(gitCalls.length >= 5);
  assert.equal(result.errorKind, null, result.error);
  assert.deepEqual(result.snapshotPaths.changed, []);
  assert.equal(readFileSync(config, "utf8").includes("gpgSign = true"), true);
});

test("every git preparation failure returns a launch diagnostic before any model call", async t => {
  const realSpawnSync = childProcess.spawnSync;
  for (const failCommand of ["init", "config", "add", "commit"]) {
    const workspace = materializeProbeWorkspace("builder.apply-fix-v1");
    t.after(workspace.dispose);
    const mock = t.mock.method(childProcess, "spawnSync", (command, args, options) => {
      if (args.includes(failCommand)) return { status: 128, stderr: "fatal: offline git failure\nprivate second line", stdout: "" };
      return realSpawnSync(command, args, options);
    });
    let starts = 0;
    const adapter = createRunInvokeAdapter({ startRun: async () => { starts++; return { completion: Promise.resolve({ state: "completed" }) }; } });
    const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 1000 } });
    assert.equal(starts, 0, failCommand);
    assert.equal(result.errorKind, "run_failed");
    assert.deepEqual(result.launchDiagnostic, { exitCode: 128, stderrFirstLine: "fatal: offline git failure" });
    assert.equal(result.transcriptRetained, false);
    mock.mock.restore();
  }
});
