import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm, symlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import claude from "../src/global/runtime/execution-adapters/claude.js";
import codex from "../src/global/runtime/execution-adapters/codex.js";
import cursor from "../src/global/runtime/execution-adapters/cursor.js";
import {
  ReadOnlyIsolationError, SANDBOX_EXEC_PATH, buildReadOnlyWriteProfile,
  verifyClaudeReadOnlySandbox, verifyCodexReadOnlySandbox
} from "../src/global/runtime/readonly-containment.js";
import {
  ADAPTER_PERMISSION_MODES, authorizeRunPermissions
} from "../src/global/runtime/run-permissions.js";
import { startRun } from "../src/global/runtime/run-manager.js";
import { createConversationService } from "../src/global/conversation/service.js";

const TASK = "Analyze the repo";
const WRITE_FLAGS = [
  "--approve-for-me", "--dangerously-bypass-approvals-and-sandbox", "--dangerously-skip-permissions",
  "--force", "workspace-write", "danger-full-access", "acceptEdits", "bypassPermissions", "auto"
];

async function tempRoot() {
  const dir = await mkdtemp(join(await realpath(tmpdir()), "kairo-ro-"));
  return realpath(dir);
}

// ---- argv builders -------------------------------------------------------

test("standard argv is byte-identical to before for claude and codex", () => {
  const c = claude.buildLaunch({ task: TASK, cwd: "/repo", model: "m", permissions: [] });
  assert.equal(c.command, "claude");
  assert.deepEqual(c.args, ["--model", "m", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "auto", "--permission-prompts", "none", TASK]);
  const x = codex.buildLaunch({ task: TASK, cwd: "/repo", permissions: [] });
  assert.equal(x.command, "codex");
  assert.deepEqual(x.args, ["exec", "--json", "--approve-for-me", TASK]);
  const y = codex.buildLaunch({ task: TASK, cwd: "/repo", permissions: ["yolo"] });
  assert.deepEqual(y.args, ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", TASK]);
});

test("codex read-only argv: --sandbox read-only, no approve-for-me, no dangerous flag, ignores user config", () => {
  const launch = codex.buildLaunch({ task: TASK, cwd: "/repo", model: "gpt-x", permissions: ["read-only"] });
  assert.equal(launch.command, "codex");
  assert.deepEqual(launch.args, ["--model", "gpt-x", "exec", "--json", "--sandbox", "read-only", "--ignore-user-config", TASK]);
  for (const flag of WRITE_FLAGS) assert.equal(launch.args.includes(flag), false, flag);
});

test("claude read-only argv: restricted, read-only allow-list, write tools denied, dontAsk, wrapped in sandbox-exec", async () => {
  const root = await tempRoot();
  const launch = claude.buildLaunch({ task: TASK, cwd: root, model: "haiku", permissions: ["read-only"], env: { PATH: "/usr/bin", SECRET: "x" } });
  assert.equal(launch.command, SANDBOX_EXEC_PATH);
  assert.equal(launch.cwd, root);
  assert.equal(launch.args[0], "-p");
  assert.equal(launch.args[1], buildReadOnlyWriteProfile(root));
  assert.deepEqual(launch.args.slice(2), [
    "claude", "--model", "haiku", "-p", "--output-format", "stream-json", "--verbose",
    "--restricted", "--tools", "Read,Grep,Glob",
    "--disallowedTools", "Edit,Write,NotebookEdit,Bash",
    "--permission-mode", "dontAsk", "--permission-prompts", "none", TASK
  ]);
  const inner = launch.args.slice(3);
  for (const flag of WRITE_FLAGS) assert.equal(inner.includes(flag), false, flag);
  assert.equal(launch.env.SECRET, undefined, "env scrubbing is preserved");
  assert.equal(launch.env.PATH, "/usr/bin");
  await rm(root, { recursive: true, force: true });
});

test("read-only cannot be combined with unsafe permissions in either builder", () => {
  for (const perms of [["read-only", "yolo"], ["read-only", "force"]]) {
    assert.throws(() => claude.buildLaunch({ task: TASK, cwd: "/repo", permissions: perms }), { code: "read_only_incompatible" });
    assert.throws(() => codex.buildLaunch({ task: TASK, cwd: "/repo", permissions: perms }), { code: "read_only_incompatible" });
  }
});

test("claude read-only launch fails closed when the root cannot be resolved", () => {
  assert.throws(
    () => claude.buildLaunch({ task: TASK, cwd: "/definitely/not/here", permissions: ["read-only"] }),
    { code: "isolation_unavailable" }
  );
});

// ---- sandbox profile -----------------------------------------------------

test("profile denies writes under the real root only and rejects unsafe path characters", async () => {
  const root = await tempRoot();
  assert.equal(
    buildReadOnlyWriteProfile(root),
    `(version 1)(allow default)(deny file-write* (subpath "${root}"))`
  );
  for (const bad of ['/tmp/a"b', "/tmp/a\nb", "/tmp/a\\b", "/tmp/a\rb", "/tmp/a\0b", "relative/path", ""]) {
    assert.throws(() => buildReadOnlyWriteProfile(bad), ReadOnlyIsolationError, JSON.stringify(bad));
  }
  await rm(root, { recursive: true, force: true });
});

test("a symlinked root is resolved to its real path in the profile", async () => {
  const root = await tempRoot();
  const link = `${root}-link`;
  await symlink(root, link);
  const launch = claude.buildLaunch({ task: TASK, cwd: link, permissions: ["read-only"] });
  assert.equal(launch.args[1], buildReadOnlyWriteProfile(root));
  await rm(link, { force: true });
  await rm(root, { recursive: true, force: true });
});

// ---- permissions authority ----------------------------------------------

test("read-only is supported for claude and codex only (plus pi); cursor/opencode stay unsupported", () => {
  assert.equal(ADAPTER_PERMISSION_MODES.claude.includes("read-only"), true);
  assert.equal(ADAPTER_PERMISSION_MODES.codex.includes("read-only"), true);
  assert.equal(ADAPTER_PERMISSION_MODES.pi.includes("read-only"), true);
  assert.equal(ADAPTER_PERMISSION_MODES.cursor.includes("read-only"), false);
  assert.equal(ADAPTER_PERMISSION_MODES.opencode.includes("read-only"), false);
  for (const agentId of ["cursor", "opencode"]) {
    assert.throws(() => authorizeRunPermissions({ permissions: ["read-only"], agentId }), { code: "unsupported_permission" });
  }
  assert.doesNotThrow(() => authorizeRunPermissions({ permissions: ["read-only"], agentId: "claude" }));
  assert.doesNotThrow(() => authorizeRunPermissions({ permissions: ["read-only"], agentId: "codex" }));
});

test("read-only is refused together with force/yolo and with allowUnsafePermissions", () => {
  for (const agentId of ["claude", "codex"]) {
    for (const permissions of [["read-only", "force"], ["read-only", "yolo"], ["read-only", "all"]]) {
      assert.throws(
        () => authorizeRunPermissions({ permissions, agentId, allowUnsafePermissions: true }),
        { code: "read_only_incompatible" }, `${agentId} ${permissions}`
      );
    }
    assert.throws(
      () => authorizeRunPermissions({ permissions: ["read-only"], agentId, allowUnsafePermissions: true }),
      { code: "read_only_incompatible" }
    );
  }
});

// ---- canary logic (fake process runner) ----------------------------------

function fakeRunner({ denyInside = true, allowOutside = true, createInside = false, platform = "darwin" } = {}) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    const target = args[args.length - 1];
    if (command === SANDBOX_EXEC_PATH) {
      const inside = target.includes(".kairo-readonly-canary");
      if (inside) return { status: denyInside ? 1 : 0, error: null, createdPath: createInside ? target : null };
      return { status: allowOutside ? 0 : 1, error: null, createdPath: allowOutside ? target : null };
    }
    return { status: 0, error: null };
  };
  return { run, calls, platform };
}

test("claude canary: refuses on non-darwin, missing sandbox-exec, runner failure, applied-nothing and block-everything", async () => {
  const root = await tempRoot();
  const base = { cwd: root, platform: "darwin", accessExecutable: async () => {} };
  await assert.rejects(() => verifyClaudeReadOnlySandbox({ ...base, platform: "linux", run: () => ({ status: 0 }) }), { code: "isolation_unavailable" });
  await assert.rejects(() => verifyClaudeReadOnlySandbox({ ...base, accessExecutable: async () => { throw new Error("ENOENT"); }, run: () => ({ status: 0 }) }), { code: "isolation_unavailable" });
  await assert.rejects(() => verifyClaudeReadOnlySandbox({ ...base, run: () => ({ status: null, error: new Error("spawn") }) }), { code: "isolation_unavailable" });
  // writes inside the root are NOT denied (profile not applied)
  await assert.rejects(() => verifyClaudeReadOnlySandbox({ ...base, run: fakeRunner({ denyInside: false }).run }), { code: "isolation_unavailable" });
  // writes outside the root are denied too (profile blocks everything)
  await assert.rejects(() => verifyClaudeReadOnlySandbox({ ...base, run: fakeRunner({ allowOutside: false }).run }), { code: "isolation_unavailable" });
  const ok = fakeRunner();
  const result = await verifyClaudeReadOnlySandbox({ ...base, run: ok.run });
  assert.equal(result.verified, true);
  assert.equal(ok.calls.length, 2);
  assert.equal(ok.calls[0].args[1], buildReadOnlyWriteProfile(root), "canary uses the exact same profile as the launch");
  await rm(root, { recursive: true, force: true });
});

test("claude canary removes a leaked canary file and fails closed", async () => {
  const root = await tempRoot();
  let leaked = null;
  const run = (command, args) => {
    const target = args[args.length - 1];
    if (target.includes(".kairo-readonly-canary")) {
      leaked = target;
      // simulate a profile that was NOT enforced although the exit status says failure
      writeFileSync(target, "x");
      return { status: 1, error: null };
    }
    return { status: 0, error: null };
  };
  await assert.rejects(
    () => verifyClaudeReadOnlySandbox({ cwd: root, platform: "darwin", accessExecutable: async () => {}, run }),
    { code: "isolation_unavailable" }
  );
  assert.ok(leaked);
  await assert.rejects(() => access(leaked), "leaked canary must be removed");
  await rm(root, { recursive: true, force: true });
});

test("codex canary: read-only profile must deny writes and still run a harmless command", async () => {
  const root = await tempRoot();
  const calls = [];
  const good = (command, args) => {
    calls.push({ command, args });
    return args.includes("/usr/bin/touch") ? { status: 1 } : { status: 0 };
  };
  const result = await verifyCodexReadOnlySandbox({ cwd: root, run: good });
  assert.equal(result.verified, true);
  assert.equal(calls[0].command, "codex");
  assert.deepEqual(calls[0].args.slice(0, 5), ["sandbox", "-P", ":read-only", "-C", root]);
  await assert.rejects(() => verifyCodexReadOnlySandbox({ cwd: root, run: () => ({ status: 0 }) }), { code: "isolation_unavailable" });
  await assert.rejects(() => verifyCodexReadOnlySandbox({ cwd: root, run: () => ({ status: 1 }) }), { code: "isolation_unavailable" });
  await assert.rejects(() => verifyCodexReadOnlySandbox({ cwd: root, run: () => ({ status: null, error: new Error("ENOENT") }) }), { code: "isolation_unavailable" });
  await rm(root, { recursive: true, force: true });
});

test("adapter preflight runs the containment canary only for read-only runs", async () => {
  const seen = [];
  const hooks = {
    verifyAuth: async () => ({ mode: "subscription" }),
    verifyReadOnlySandbox: async (ctx) => { seen.push(ctx.cwd); return { verified: true }; }
  };
  await claude.preflight({ cwd: "/r", permissions: [], ...hooks });
  assert.deepEqual(seen, []);
  await claude.preflight({ cwd: "/r", permissions: ["read-only"], ...hooks });
  await codex.preflight({ cwd: "/r2", permissions: ["read-only"], ...hooks });
  assert.deepEqual(seen, ["/r", "/r2"]);
  await assert.rejects(
    () => claude.preflight({ cwd: "/r", permissions: ["read-only"], verifyAuth: async () => ({}), verifyReadOnlySandbox: async () => { throw new ReadOnlyIsolationError("no"); } }),
    { code: "isolation_unavailable" }
  );
});

test("cursor read-only stays unsupported at the adapter level too", () => {
  assert.equal(cursor.capabilities.permissionModes?.includes("read-only") ?? false, false);
});

// ---- end to end: real service + real run-manager + fake spawn -------------

const MODEL = (adapterId) => ({ candidateKey: `${adapterId}::m-1`, adapterId, modelId: "m-1", displayName: "M1", accessMode: "automatic" });
const strategyFor = (model) => ({
  schema: "kairo.project-strategy/v1", status: "active", profileFingerprint: "fp-1", activeRoles: ["Builder"],
  projectTeam: [{
    role: "Builder", model, fallback: null, decisionEvidence: null, assignmentSource: "recommended",
    recommendedAssignment: { model, fallback: null, decisionEvidence: null }, overrideEvidence: null
  }]
});
const RECORD = { status: {}, taskMarkdown: "text", planMarkdown: "# Approved plan" };

async function e2e(adapterId, { preflightHooks = null } = {}) {
  const root = await tempRoot();
  const homeDir = await tempRoot();
  const model = MODEL(adapterId);
  const spawns = [];
  let link = null;
  const realAdapters = { claude, codex, cursor };
  const resolveAdapterImpl = (id) => {
    const real = realAdapters[id];
    return {
      ...real,
      availability: () => ({ available: true, compatible: true, launchable: true, reason: null }),
      buildLaunch: (o) => real.buildLaunch(o),
      preflight: (ctx) => real.preflight({
        ...ctx,
        verifyAuth: async () => ({ mode: "subscription" }),
        verifyReadOnlySandbox: async () => ({ verified: true }),
        ...(preflightHooks ?? {})
      })
    };
  };
  const spawnImpl = (command, args, options) => {
    spawns.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242;
    child.kill = () => true;
    setImmediate(() => child.emit("close", 0));
    return child;
  };
  const service = createConversationService({
    resolveRoot: async () => root, homeDir,
    selectExecutionProvider: () => { throw new Error("legacy router must not be used"); },
    readPlan: async () => RECORD, verifyExecution: async () => RECORD,
    createRunId: () => `run_${adapterId}_${spawns.length}`,
    readExecution: async () => link,
    writeExecution: async (_r, _i, value) => { link = value; },
    updateExecution: async (_r, _i, value) => { link = value; },
    readProjectStrategy: async () => strategyFor(model),
    startRun: async (input) => {
      const started = await startRun({ ...input, wait: true, spawnImpl, resolveAdapterImpl });
      await started.completion;
      return started;
    }
  });
  const realSnapshot = service.snapshot.bind(service);
  service.snapshot = async (args) => {
    const snap = await realSnapshot(args);
    return { ...snap, modelIntelligence: { ...snap.modelIntelligence, eligibility: { [adapterId]: { ok: true } } } };
  };
  const target = { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: model.candidateKey };
  const cleanup = async () => { await rm(root, { recursive: true, force: true }); await rm(homeDir, { recursive: true, force: true }); };
  return { service, spawns, getLink: () => link, root, target, cleanup };
}

test("e2e claude read-only: exact wrapped launch, containment args, no write flags; standard launch unchanged", async () => {
  const ro = await e2e("claude");
  await ro.service.executePlan({ cwd: ro.root, taskId: "t", confirmationTarget: { ...ro.target, mode: "read-only" } });
  assert.equal(ro.spawns.length, 1);
  const { command, args, options } = ro.spawns[0];
  assert.equal(command, SANDBOX_EXEC_PATH);
  assert.equal(args[1], buildReadOnlyWriteProfile(ro.root));
  assert.equal(args[2], "claude");
  for (const need of ["--restricted", "--tools", "Read,Grep,Glob", "--disallowedTools", "dontAsk"]) assert.ok(args.includes(need), need);
  for (const flag of WRITE_FLAGS) assert.equal(args.slice(2).includes(flag), false, flag);
  assert.equal(options.cwd, ro.root);
  assert.equal(ro.getLink().mode, "read-only");
  await ro.cleanup();

  const std = await e2e("claude");
  await std.service.executePlan({ cwd: std.root, taskId: "t", confirmationTarget: std.target });
  assert.equal(std.spawns[0].command, "claude");
  assert.deepEqual(std.spawns[0].args.slice(0, 7), ["--model", "m-1", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode"]);
  assert.equal(std.spawns[0].args.includes("--restricted"), false);
  await std.cleanup();
});

test("e2e codex read-only: exact launch with sandbox read-only; standard keeps --approve-for-me", async () => {
  const ro = await e2e("codex");
  await ro.service.executePlan({ cwd: ro.root, taskId: "t", confirmationTarget: { ...ro.target, mode: "read-only" } });
  assert.equal(ro.spawns.length, 1);
  assert.equal(ro.spawns[0].command, "codex");
  assert.deepEqual(ro.spawns[0].args.slice(0, 7), ["--model", "m-1", "exec", "--json", "--sandbox", "read-only", "--ignore-user-config"]);
  for (const flag of WRITE_FLAGS) assert.equal(ro.spawns[0].args.includes(flag), false, flag);
  await ro.cleanup();

  const std = await e2e("codex");
  await std.service.executePlan({ cwd: std.root, taskId: "t", confirmationTarget: std.target });
  assert.deepEqual(std.spawns[0].args.slice(0, 5), ["--model", "m-1", "exec", "--json", "--approve-for-me"]);
  await std.cleanup();
});

test("e2e: missing isolation fails closed with zero spawns and a failed link; no write launch", async () => {
  for (const adapterId of ["claude", "codex"]) {
    const h = await e2e(adapterId, { preflightHooks: { verifyReadOnlySandbox: async () => { throw new ReadOnlyIsolationError("no sandbox"); } } });
    await assert.rejects(
      () => h.service.executePlan({ cwd: h.root, taskId: "t", confirmationTarget: { ...h.target, mode: "read-only" } }),
      { code: "isolation_unavailable" }
    );
    assert.equal(h.spawns.length, 0, adapterId);
    assert.equal(h.getLink().state, "failed");
    assert.equal(h.getLink().mode, "read-only");
    await h.cleanup();
  }
});

test("e2e: read-only confirmation never launches workspace-write and vice versa", async () => {
  const h = await e2e("claude");
  await assert.rejects(
    () => h.service.executePlan({ cwd: h.root, taskId: "t", confirmationTarget: { ...h.target, mode: "read-only" }, mode: "standard" }),
    /state changed since this was confirmed/
  );
  await assert.rejects(
    () => h.service.executePlan({ cwd: h.root, taskId: "t", confirmationTarget: h.target, mode: "read-only" }),
    /state changed since this was confirmed/
  );
  assert.equal(h.spawns.length, 0);
  await h.cleanup();
});

test("e2e: cursor read-only is refused before any launch", async () => {
  const h = await e2e("cursor");
  await assert.rejects(
    () => h.service.executePlan({ cwd: h.root, taskId: "t", confirmationTarget: { ...h.target, mode: "read-only" } }),
    { code: "read_only_unsupported" }
  );
  assert.equal(h.spawns.length, 0);
  assert.equal(h.getLink(), null);
  await h.cleanup();
});
