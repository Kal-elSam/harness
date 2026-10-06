/**
 * Continuity and identity across ALL MCP entries (Cursor, Claude Code, Codex)
 * over the REAL conversation service and the REAL on-disk stores.
 *
 * Offline by construction: fake `startRun`/`stopRun` (they write REAL run records, never
 * launch a provider), injected Gentle, temp git repo, temp HOME / HARNESS_HOME, scrubbed env
 * for every launched process. The real home and real client configs are never read or written.
 *
 * Entry model:
 *  - handlers level (all three): `createToolHandlers` configured from the entry the T4 installer
 *    wrote (parsed with the real argv parser), each over a FRESH service.
 *  - process level (Cursor, Claude Code, Codex): the written entries launched through
 *    `bin/kairo.js` with a scrubbed env, over stdio initialize + tools/call. No test-only hook
 *    exists to inject a fake Gentle/provider into a child, so the child runs with PATH limited to
 *    node + /usr/bin:/bin (no gentle-ai, no provider CLI): its Gentle side is a typed
 *    "unavailable", never real. Process-level assertions therefore compare the entries to each
 *    other and compare to the service on the provider-independent parts (see PROCESS_LIMIT).
 *  - The installer's Cursor entry is unbound by design (it refuses with workspace_unbound); the
 *    bound Cursor entry is modeled as the same entry plus the explicit binding args.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import { taskPaths, transitionTask } from "../src/global/architect/architect-store.js";
import { readProjectStrategy } from "../src/global/conversation/project-strategy-store.js";
import { createSession } from "../src/global/conversation/session-registry.js";
import { loadKairoWorkspaceSnapshot } from "../src/global/host/workspace-snapshot.js";
import { deriveTaskStatus, deriveTeamStatus, deriveWorkspaceStatus, rolesFromPublicTeam } from "../src/global/host/workspace-status.js";
import { readClientEntry } from "../src/global/mcp/client-config.js";
import { createToolHandlers } from "../src/global/mcp/kairo-mcp.js";
import { parseWorkspaceMcpArgv } from "../src/global/mcp/workspace-mcp-entry.js";
import { runMcpInstall } from "../src/global/mcp-install.js";
import { runPaths } from "../src/global/paths.js";
import { createRunEvent } from "../src/global/runtime/run-events.js";
import { createRunRecord, listRunRecords, readRunState, writeRunState, appendRunEvent } from "../src/global/runtime/run-store.js";
import { GENTLE_230_BOOTSTRAP } from "../src/global/control-plane/review-status.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";
import { harness } from "./helpers/setup-harness.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "kairo.js");
const SESSION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const SESSION_B = "aaaaaaaa-0000-4000-8000-000000000002";
const ROUTED = { decision: "ROUTED", role: "Builder", strategyFingerprint: "fp-1", model: { adapterId: "codex", modelId: "m1", candidateKey: "codex:m1" } };
// Cursor is the baseline entry (Pi tools are excluded from the integrated scope).
const ENTRY_NAMES = ["cursor", "claude-code", "codex"];
const PROCESS_NAMES = ["cursor", "claude-code", "codex"];
const STATUS = {
  schema: "gentle-ai.review-integration.status/v2", contract: "gentle-ai.review-integration/v2",
  action: "start", applicability: "required", next_transition: { kind: "execute", operation: "review.start" }
};
// Recorded (fake) Gentle: available, review status payload, RDD mode `on` from the default source.
const GENTLE = {
  probe: async () => ({
    state: "available", contractCompatible: true, version: "2.3.0",
    evidence: [{ kind: "binary", path: "/opt/fake/gentle-ai" }, { kind: "bootstrap", command: GENTLE_230_BOOTSTRAP }]
  }),
  runCommand: () => ({ ok: true, payload: STATUS, status: 0, error: null }),
  readRddMode: async () => ({ mode: "on", source: "default", global: null, cloneLocal: null, error: null })
};

const nowIso = () => new Date().toISOString();
const exists = (path) => stat(path).then(() => true, () => false);

// ---------------------------------------------------------------- world

async function world({ claude = ENTITLEMENT.ALLOWED } = {}) {
  const counters = { startRun: 0, stopRun: 0 };
  let runSeq = 0;
  let home = null;
  let childPid = null; // pid recorded on fake runs; defaults to this (alive) test process
  const h = await harness({
    git: true, diskStrategy: true, claude,
    serviceDeps: {
      createRunId: () => `run_ent_${++runSeq}`,
      gentle: GENTLE,
      // The fake launcher writes a REAL run record so recovery/liveness run against real evidence.
      startRun: async ({ runId }) => {
        counters.startRun += 1;
        const metadata = {
          runId, agentId: "codex", state: "running", pid: childPid ?? process.pid,
          startedAt: nowIso(), updatedAt: nowIso(), error: null
        };
        await createRunRecord(home, metadata);
        return { metadata };
      },
      stopRun: async (_home, runId) => {
        counters.stopRun += 1;
        await writeRunState(home, { ...(await readRunState(home, runId)), state: "cancelled", updatedAt: nowIso(), completedAt: nowIso() });
      }
    }
  });
  home = h.home;
  const root = h.root;
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  await writeFile(join(root, "README.md"), "hi\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  const installHome = await realpath(await mkdtemp(join(tmpdir(), "kairo-ent-install-")));
  const elsewhere = await realpath(await mkdtemp(join(tmpdir(), "kairo-ent-else-")));
  await createSession(home, root, {}, { randomUUID: () => SESSION_A });
  await createSession(home, root, {}, { randomUUID: () => SESSION_B });

  const newService = () => {
    const service = h.makeService();
    service.routeProjectExecution = async () => ROUTED;
    return service;
  };
  const w = {
    h, root, home, installHome, counters, newService,
    setPid: (pid) => { childPid = pid; },
    newTask: async (sessionId = null) => {
      const created = await createArchitecturePlan({
        task: "Do a thing", cwd: root, sessionId, runCodex: async () => ({ plan: "## Plan\nDo it.", usage: null })
      });
      await transitionTask(root, created.status.taskId, "approved");
      return created.status.taskId;
    },
    complete: async (runId, text = "Done.") => {
      await writeRunState(home, { ...(await readRunState(home, runId)), state: "completed", updatedAt: nowIso(), completedAt: nowIso() });
      await appendRunEvent(home, createRunEvent({ runId, type: "run.transcript", source: "codex", data: { text }, captureTranscript: true }), { captureTranscript: true });
    },
    runCount: async () => (await listRunRecords(home)).length,
    strategy: () => readProjectStrategy(home, root)
  };
  // team: draft -> active through the shared setup operations (the service writes the real store)
  w.draftTeam = async () => {
    const plan = await h.ops.planSetup({ action: "run_analysis", analyzerKey: "codex::codex-model" });
    await h.ops.runAnalysis({ confirmationTarget: plan.confirmationTarget });
  };
  w.approveTeam = async () => {
    const plan = await h.ops.planSetup({ action: "approve_team" });
    await h.ops.approveTeam({ confirmationTarget: plan.confirmationTarget });
  };
  return w;
}

// ---------------------------------------------------------------- installed entries

async function installEntries(w) {
  const install = (client, extra = {}) => runMcpInstall({ client, homeDir: w.installHome, yes: true, json: true, quiet: true, ...extra });
  await install("cursor");
  await install("claude-code", { bind: w.root });
  await install("codex", { bind: w.root });
  const read = async (client, rel) => readClientEntry(client, await readFile(join(w.installHome, rel), "utf8"))
    ?? JSON.parse(await readFile(join(w.installHome, rel), "utf8")).mcpServers.kairo;
  const cursorUnbound = JSON.parse(await readFile(join(w.installHome, ".cursor", "mcp.json"), "utf8")).mcpServers.kairo;
  return {
    cursorUnbound,
    // The installer never binds Cursor; a bound Cursor launch is the same entry plus the explicit binding.
    cursor: { ...cursorUnbound, args: [...cursorUnbound.args, "--workspace-bound", "--cwd", w.root] },
    "claude-code": await read("claude-code", ".claude.json"),
    codex: await read("codex", join(".codex", "config.toml"))
  };
}

// ---------------------------------------------------------------- handlers-level entries

/** Normalized outcome of an MCP structured result. */
const fromMcp = (res) => ({ ok: res.structuredContent.ok === true, code: res.structuredContent.code, data: res.structuredContent.data });

/** One FRESH service per entry: opening an entry is a reopen over the same on-disk state. */
function openEntries(w, installed) {
  const entries = {};
  for (const name of ENTRY_NAMES) {
    const service = w.newService();
    const parsed = parseWorkspaceMcpArgv(installed[name].args);
    assert.equal(parsed.workspaceBound, true, `${name} entry is bound`);
    assert.equal(parsed.cwd, w.root, `${name} entry is bound to the project`);
    const handlers = createToolHandlers({
      ...parsed, processCwd: w.root, userHome: w.installHome, env: {}, conversationService: service
    });
    entries[name] = { name, service, call: async (tool, args = {}) => fromMcp(await handlers[tool](args)) };
  }
  return entries;
}

/** Calls `tool` in every entry and asserts the outcomes are deep-equal. Returns the shared outcome. */
async function sameInAll(entries, tool, args = {}) {
  const outcomes = {};
  for (const name of ENTRY_NAMES) outcomes[name] = await entries[name].call(tool, args);
  for (const name of ENTRY_NAMES.slice(1)) assert.deepEqual(outcomes[name], outcomes.cursor, `${tool}: ${name} must equal cursor`);
  return outcomes.cursor;
}

const okData = (outcome) => { assert.equal(outcome.ok, true, `expected ok, got ${outcome.code}`); return outcome.data; };

async function launchVia(entry, taskId) {
  const plan = okData(await entry.call("kairo_plan_execution", { taskId, role: "Builder" }));
  assert.equal(plan.confirmationRequired, true);
  return okData(await entry.call("kairo_execute_plan", { taskId, confirmationTarget: plan.confirmationTarget }));
}

// ---------------------------------------------------------------- process-level entries

function startMcp({ args, cwd, home }) {
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd,
    // No gentle-ai and no provider CLI on PATH: the child cannot reach anything real.
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, HARNESS_HOME: home },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stderr = "";
  let buffer = "";
  let seq = 0;
  const pending = new Map();
  child.stderr.on("data", (d) => { stderr += d; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try { const msg = JSON.parse(line); if (msg.id != null) pending.get(msg.id)?.(msg); } catch { /* not a response */ }
    }
  });
  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  const request = (method, params) => new Promise((ok, fail) => {
    const id = ++seq;
    const timer = setTimeout(() => fail(new Error(`timeout ${method}\n${stderr}`)), 30000);
    pending.set(id, (m) => { clearTimeout(timer); ok(m); });
    send({ jsonrpc: "2.0", id, method, params });
  });
  const ready = request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "entries-test", version: "0" } })
    .then((init) => { assert.ok(init.result?.serverInfo, "initialize returned serverInfo"); send({ jsonrpc: "2.0", method: "notifications/initialized" }); });
  return {
    call: async (tool, args = {}) => {
      await ready;
      const res = await request("tools/call", { name: tool, arguments: args });
      return fromMcp({ structuredContent: res.result?.structuredContent ?? { ok: false, code: "no_result", data: null } });
    },
    close: () => { child.kill(); }
  };
}

async function launchProcesses(w, installed) {
  const procs = {};
  for (const name of PROCESS_NAMES) procs[name] = startMcp({ args: installed[name].args, cwd: w.root, home: w.home });
  return procs;
}

const withProcesses = async (w, installed, fn) => {
  const procs = await launchProcesses(w, installed);
  try { return await fn(procs); } finally { for (const p of Object.values(procs)) p.close(); }
};

/** Provider-independent projection of a team (children see no providers; roles keep their names). */
const teamCore = (team) => ({
  state: team.state,
  roles: team.roles.map((r) => ({ role: r.role, provider: r.provider, model: r.model, modelId: r.modelId })),
  tasks: team.tasks
});
const resultCore = ({ gentle, ...rest }) => rest; // gentle is typed-unavailable in children by design (PROCESS_LIMIT)

async function sameInProcesses(procs, tool, args = {}) {
  const out = {};
  for (const name of PROCESS_NAMES) out[name] = await procs[name].call(tool, args);
  for (const name of PROCESS_NAMES.slice(1)) assert.deepEqual(out[name], out[PROCESS_NAMES[0]], `${tool}: ${name} process must equal ${PROCESS_NAMES[0]}`);
  return out[PROCESS_NAMES[0]];
}

const snapshotOf = (w) => loadKairoWorkspaceSnapshot(
  { cwd: w.root, availabilityIntelligence: w.h.modelIntelligence, usageIntelligence: null },
  {
    resolveProjectRoot: async () => w.root, resolveHomeDir: () => w.home,
    listProviderUsage: async () => [], inspectEngramIntegration: () => ({ status: "configured" }),
    readCachedUsage: async () => null, writeCachedUsage: async () => {},
    readCachedAvailability: async () => null, writeCachedAvailability: async () => {},
    createConversationService: () => w.newService()
  }
);

// ================================================================ 1. entry identity

test("1a. same project, same state: Cursor, Claude Code and Codex return identical team, setup, sessions, task result, run identity and status vocabulary", async () => {
  const w = await world();
  const installed = await installEntries(w);
  const entries = openEntries(w, installed);

  // draft team (setup ops), visible identically everywhere
  await w.draftTeam();
  const draft = okData(await sameInAll(entries, "kairo_team"));
  assert.equal(draft.state, "suggested");
  assert.equal(okData(await sameInAll(entries, "kairo_setup")).strategyStatus, "draft");

  // active team
  await w.approveTeam();
  const team0 = okData(await sameInAll(entries, "kairo_team"));
  assert.equal(team0.state, "active");
  assert.ok(team0.roles.length > 0);
  const setup = okData(await sameInAll(entries, "kairo_setup"));
  assert.equal(setup.strategyStatus, "active");
  const claude = setup.providers.find((p) => p.id === "claude");
  assert.equal(claude.installed, true);

  // a delegation (Claude Code entry) and a result
  const taskId = await w.newTask(SESSION_A);
  const launched = await launchVia(entries["claude-code"], taskId);
  assert.equal(launched.reused, false);
  assert.equal(launched.role, "Builder");
  assert.equal(w.counters.startRun, 1);
  await w.complete(launched.runId);

  const sessions = okData(await sameInAll(entries, "kairo_sessions"));
  assert.deepEqual(sessions.sessions.map((s) => s.sessionId).sort(), [SESSION_A, SESSION_B]);
  const result = okData(await sameInAll(entries, "kairo_task_result", { taskId }));
  assert.equal(result.runId, launched.runId);
  assert.equal(result.status, "terminal");
  assert.equal(result.result.ok, true);
  assert.equal(result.transitions.state, "ok");
  assert.deepEqual(result.transitions.recorded, ["delegated", "result_observed"]);
  assert.equal(result.transitions.next, "review_authorized");
  const team = okData(await sameInAll(entries, "kairo_team"));
  const row = team.tasks.find((t) => t.taskId === taskId);
  assert.equal(row.execution.runId, launched.runId);
  assert.equal(row.execution.role, "Builder");
  assert.equal(row.nextTransition, "review_authorized");
  assert.equal(result.gentle.rddMode, "on");
  assert.equal(result.gentle.rddSource, "default");
  assert.equal(result.gentle.taskReview, "not_established", "a project receipt/mode is never task approval");
  okData(await sameInAll(entries, "kairo_plan_execution", { taskId, role: "Builder" }));

  // status vocabulary is derived from the same data in every entry
  for (const name of ENTRY_NAMES) {
    const t = okData(await entries[name].call("kairo_team"));
    assert.equal(deriveTeamStatus(t.state).status, "active", name);
    assert.equal(deriveTaskStatus(t.tasks.find((x) => x.taskId === taskId)).status, deriveTaskStatus(row).status, name);
  }
  assert.equal(w.counters.startRun, 1, "reads never launch");
});

// Process-level limit (documented in the header): children run with no Gentle/provider, so they
// are compared to each other in full and to the service on the provider-independent parts.
test("1b. real processes (Cursor, Claude Code, Codex entries via bin/kairo.js) read the same on-disk state the service wrote", async () => {
  const w = await world();
  const installed = await installEntries(w);
  await w.draftTeam();
  await w.approveTeam();
  const taskId = await w.newTask(SESSION_A);
  const inProc = openEntries(w, installed);
  const launched = await launchVia(inProc["claude-code"], taskId);
  await w.complete(launched.runId);
  const expectedResult = okData(await inProc.cursor.call("kairo_task_result", { taskId })); // settles the transitions file first
  const expectedTeam = okData(await inProc.cursor.call("kairo_team"));
  const expectedSessions = okData(await inProc.cursor.call("kairo_sessions"));
  const runsBefore = await w.runCount();

  await withProcesses(w, installed, async (procs) => {
    const sessions = okData(await sameInProcesses(procs, "kairo_sessions"));
    assert.deepEqual(sessions, expectedSessions);
    const team = okData(await sameInProcesses(procs, "kairo_team"));
    assert.deepEqual(teamCore(team), teamCore(expectedTeam));
    assert.equal(team.tasks.find((t) => t.taskId === taskId).execution.runId, launched.runId);
    const result = okData(await sameInProcesses(procs, "kairo_task_result", { taskId }));
    assert.deepEqual(resultCore(result), resultCore(expectedResult));
    assert.equal(result.gentle.rddMode, "unknown", "no Gentle in the child: unknown, never permission");
    const setup = okData(await sameInProcesses(procs, "kairo_setup"));
    assert.equal(setup.strategyStatus, "active");
  });
  assert.equal(await w.runCount(), runsBefore, "process reads create no run");
  assert.equal(w.counters.startRun, 1);

  // The installer's Cursor entry is unbound by design: typed refusal, no state read or written.
  const unbound = startMcp({ args: installed.cursorUnbound.args, cwd: w.root, home: w.home });
  try {
    const refused = await unbound.call("kairo_team");
    assert.equal(refused.ok, false);
    assert.match(refused.code, /^workspace_/);
  } finally { unbound.close(); }
});

// ================================================================ 2. reopen and recovery

test("2a. close every entry, reopen over the same disk state: identical output 3 times in each entry, zero extra launches, transitions bytes unchanged", async () => {
  const w = await world();
  const installed = await installEntries(w);
  await w.draftTeam();
  await w.approveTeam();
  const taskId = await w.newTask(SESSION_A);
  const first = openEntries(w, installed);
  const run = await launchVia(first.cursor, taskId);
  await w.complete(run.runId);
  const before = {
    result: okData(await sameInAll(first, "kairo_task_result", { taskId })), // records result_observed first
    team: okData(await sameInAll(first, "kairo_team")),
    sessions: okData(await sameInAll(first, "kairo_sessions"))
  };
  const bytes = await readFile(taskPaths(w.root, taskId).transitionsPath, "utf8");
  const runsBefore = await w.runCount();

  for (let i = 0; i < 3; i += 1) {
    const reopened = openEntries(w, installed); // fresh service/handlers/tool instances
    for (const name of ENTRY_NAMES) {
      assert.deepEqual(okData(await reopened[name].call("kairo_team")), before.team, `${name} team #${i}`);
      assert.deepEqual(okData(await reopened[name].call("kairo_task_result", { taskId })), before.result, `${name} result #${i}`);
      assert.deepEqual(okData(await reopened[name].call("kairo_sessions")), before.sessions, `${name} sessions #${i}`);
    }
  }
  assert.equal(await readFile(taskPaths(w.root, taskId).transitionsPath, "utf8"), bytes);
  assert.equal(w.counters.startRun, 1, "reopen never launches");
  assert.equal(w.counters.stopRun, 0);
  assert.equal(await w.runCount(), runsBefore);

  // real processes, closed and relaunched, agree with themselves and launch nothing
  const reads = [];
  for (let i = 0; i < 2; i += 1) {
    reads.push(await withProcesses(w, installed, async (procs) => ({
      team: await sameInProcesses(procs, "kairo_team"), result: await sameInProcesses(procs, "kairo_task_result", { taskId })
    })));
  }
  assert.deepEqual(reads[1], reads[0]);
  assert.equal(await readFile(taskPaths(w.root, taskId).transitionsPath, "utf8"), bytes);
  assert.equal(await w.runCount(), runsBefore);
});

test("2b. a confirmed execute repeated from a different entry is reused: one launch, one run, one execution link", async () => {
  const w = await world();
  const installed = await installEntries(w);
  const taskId = await w.newTask();
  const first = await launchVia(openEntries(w, installed)["claude-code"], taskId);
  assert.equal(first.reused, false);
  for (const name of ["codex", "cursor", "claude-code"]) {
    const entry = openEntries(w, installed)[name]; // a different, freshly opened entry each time
    const again = await launchVia(entry, taskId);
    assert.equal(again.reused, true, `${name} reuses the run`);
    assert.equal(again.runId, first.runId, name);
  }
  assert.equal(w.counters.startRun, 1);
  assert.equal(await w.runCount(), 1);
  const link = JSON.parse(await readFile(taskPaths(w.root, taskId).executionPath, "utf8"));
  assert.equal(link.runId, first.runId);
});

// ================================================================ 3. failure cases across entries

test("3a. access missing (installed but unverified): analysis and assignment are blocked with the same typed code from every entry, nothing written", async () => {
  const w = await world({ claude: ENTITLEMENT.UNVERIFIED });
  const installed = await installEntries(w);
  const entries = openEntries(w, installed);
  await w.draftTeam();
  const strategyBefore = JSON.stringify(await w.strategy());
  const setup = okData(await sameInAll(entries, "kairo_setup"));
  const claude = setup.providers.find((p) => p.id === "claude");
  assert.equal(claude.installed, true);
  assert.equal(claude.accessVerified, "unverified");

  const analysis = okData(await sameInAll(entries, "kairo_setup_plan", { action: "run_analysis", analyzerKey: "claude::claude-model" }));
  assert.equal(analysis.decision, "REFUSED");
  assert.equal(analysis.reasonCode, "access_unverified");
  assert.equal(analysis.confirmationTarget, null);
  const assignment = okData(await sameInAll(entries, "kairo_setup_plan", { action: "set_assignment", role: "Architect", candidateKey: "claude::claude-model" }));
  assert.equal(assignment.reasonCode, "access_unverified");
  assert.equal(assignment.confirmationTarget, null);

  // forged targets cannot bypass the gate on any entry
  const forgedAnalysis = { action: "run_analysis", subject: "claude::claude-model", candidateKey: null, stateFingerprint: "x" };
  const forgedAssign = { action: "set_assignment", subject: "Architect", candidateKey: "claude::claude-model", stateFingerprint: "x" };
  const a = await sameInAll(entries, "kairo_setup_run_analysis", { confirmationTarget: forgedAnalysis });
  assert.equal(a.ok, false);
  assert.equal(a.code, "access_unverified");
  const b = await sameInAll(entries, "kairo_setup_set_assignment", { confirmationTarget: forgedAssign });
  assert.equal(b.ok, false);
  assert.equal(b.code, "access_unverified");

  assert.equal(JSON.stringify(await w.strategy()), strategyBefore);
  assert.equal(w.h.counts.analyze, 1, "only the original codex analysis ran");
  assert.equal(w.counters.startRun, 0);
});

test("3b. confirmation missing or stale: identical typed refusal from every entry and no state change", async () => {
  const w = await world();
  const installed = await installEntries(w);
  const entries = openEntries(w, installed);
  await w.draftTeam();
  const taskId = await w.newTask();
  const strategyBefore = JSON.stringify(await w.strategy());
  const analyzeBefore = w.h.counts.analyze;

  const missing = await sameInAll(entries, "kairo_execute_plan", { taskId });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "confirmation_required");
  const plan = okData(await sameInAll(entries, "kairo_plan_execution", { taskId, role: "Builder" }));
  const stale = await sameInAll(entries, "kairo_execute_plan", { taskId, confirmationTarget: { ...plan.confirmationTarget, strategyFingerprint: "old" } });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "confirmation_stale");

  const noAnalysis = await sameInAll(entries, "kairo_setup_run_analysis", {});
  assert.equal(noAnalysis.code, "confirmation_required");
  const approve = okData(await sameInAll(entries, "kairo_setup_plan", { action: "approve_team" }));
  const staleApprove = await sameInAll(entries, "kairo_setup_approve_team", { confirmationTarget: { ...approve.confirmationTarget, stateFingerprint: "old" } });
  assert.equal(staleApprove.code, "confirmation_stale");

  assert.equal(JSON.stringify(await w.strategy()), strategyBefore, "team still a draft, byte-identical");
  assert.equal((await w.strategy()).status, "suggested");
  assert.equal(w.h.counts.analyze, analyzeBefore);
  assert.equal(w.counters.startRun, 0);
  assert.equal(await w.runCount(), 0);
  assert.equal(await exists(taskPaths(w.root, taskId).executionPath), false, "no execution link");
  assert.equal(await exists(taskPaths(w.root, taskId).transitionsPath), false, "no transitions file");
});

test("3c. cancel with a ref of another session is refused from every entry and the run keeps running", async () => {
  const w = await world();
  const installed = await installEntries(w);
  const taskId = await w.newTask(SESSION_A);
  const run = await launchVia(openEntries(w, installed)["claude-code"], taskId);
  const entries = openEntries(w, installed);
  const refused = await sameInAll(entries, "kairo_cancel_execution", { taskId, ref: SESSION_B });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "session_mismatch");
  assert.equal(w.counters.stopRun, 0, "a foreign session must not stop anything");
  assert.equal((await readRunState(w.home, run.runId)).state, "running");
  const result = okData(await sameInAll(entries, "kairo_task_result", { taskId }));
  assert.equal(result.runState, "running");
  assert.equal(result.status, "running");
  // the owning session still can, from another entry
  const cancelled = okData(await entries.codex.call("kairo_cancel_execution", { taskId, ref: SESSION_A }));
  assert.equal(cancelled.state, "cancelled");
  assert.equal(w.counters.stopRun, 1);
});

async function runningTask(w, installed) {
  const taskId = await w.newTask(SESSION_A);
  const run = await launchVia(openEntries(w, installed)["claude-code"], taskId);
  await w.complete(run.runId);
  return { taskId, run };
}

test("3d. corrupt run record: identical typed outcome in every entry, file never rewritten, nothing relaunched", async () => {
  const w = await world();
  const installed = await installEntries(w);
  const { taskId, run } = await runningTask(w, installed);
  const { statePath } = runPaths(w.home, run.runId);
  await writeFile(statePath, "garbage{\n");
  const entries = openEntries(w, installed);
  const result = await sameInAll(entries, "kairo_task_result", { taskId });
  const data = okData(result);
  assert.equal(data.status, "evidence_unreadable");
  assert.equal(data.result, null);
  // One corrupt run record must not hide the whole team: the task shows typed unreadable evidence.
  const team = okData(await sameInAll(entries, "kairo_team"));
  assert.equal(team.tasks.find((t) => t.taskId === taskId).execution.state, "evidence_unreadable");
  assert.equal(deriveTaskStatus(team.tasks.find((t) => t.taskId === taskId)).status, "blocked");
  assert.equal((await snapshotOf(w)).tasks.find((t) => t.id === taskId).status, "blocked");
  assert.equal(await readFile(statePath, "utf8"), "garbage{\n");
  assert.equal(w.counters.startRun, 1);
  const again = await launchVia(entries.codex, taskId);
  assert.equal(again.reused, true);
  assert.equal(w.counters.startRun, 1);
});

test("3e. corrupt run events: identical result_corrupt in every entry, events file untouched, nothing relaunched", async () => {
  const w = await world();
  const installed = await installEntries(w);
  const { taskId, run } = await runningTask(w, installed);
  const { eventsPath } = runPaths(w.home, run.runId);
  await appendFile(eventsPath, "garbage{\n");
  const bytes = await readFile(eventsPath, "utf8");
  const entries = openEntries(w, installed);
  const data = okData(await sameInAll(entries, "kairo_task_result", { taskId }));
  assert.equal(data.status, "evidence_unreadable");
  assert.equal(data.errorCode, "result_corrupt");
  assert.equal(data.result, null);
  okData(await sameInAll(entries, "kairo_team"));
  assert.equal(await readFile(eventsPath, "utf8"), bytes);
  assert.equal(w.counters.startRun, 1);
});

test("3f. corrupt transitions file: identical transitions_corrupt state in every entry, file never overwritten, replay reused", async () => {
  const w = await world();
  const installed = await installEntries(w);
  const { taskId } = await runningTask(w, installed);
  const { transitionsPath } = taskPaths(w.root, taskId);
  await writeFile(transitionsPath, "garbage{\n");
  const entries = openEntries(w, installed);
  const data = okData(await sameInAll(entries, "kairo_task_result", { taskId }));
  assert.equal(data.status, "terminal", "the result is still readable");
  assert.equal(data.transitions.state, "corrupt");
  assert.equal(data.transitions.next, null);
  const team = okData(await sameInAll(entries, "kairo_team"));
  assert.equal(team.tasks.find((t) => t.taskId === taskId).nextTransition, null);
  assert.equal(await readFile(transitionsPath, "utf8"), "garbage{\n");
  assert.equal((await launchVia(entries.cursor, taskId)).reused, true);
  assert.equal(w.counters.startRun, 1);
});

// ================================================================ 4. real interruption

test("4. REAL interruption: a real child process killed with SIGKILL is reported interrupted -> blocked by every entry, next transition derived, no relaunch", async () => {
  const w = await world();
  const installed = await installEntries(w);
  await w.draftTeam();
  await w.approveTeam();
  const taskId = await w.newTask(SESSION_A);
  // A real throwaway local process, recorded as the run's pid through the fake-provider seam.
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    w.setPid(child.pid);
    const launched = await launchVia(openEntries(w, installed)["claude-code"], taskId);
    assert.equal(w.counters.startRun, 1);

    // while the process is alive every entry (and the snapshot) sees a working run
    let entries = openEntries(w, installed);
    const alive = okData(await sameInAll(entries, "kairo_task_result", { taskId }));
    assert.equal(alive.runState, "running");
    assert.equal(alive.status, "running");
    assert.equal((await snapshotOf(w)).tasks.find((t) => t.id === taskId).status, "working");

    child.kill("SIGKILL");
    await exited;

    entries = openEntries(w, installed);
    const dead = okData(await sameInAll(entries, "kairo_task_result", { taskId }));
    assert.equal(dead.runState, "interrupted");
    assert.equal(dead.status, "terminal");
    assert.equal(dead.result.ok, false);
    assert.equal(dead.transitions.next, "review_authorized");
    const team = okData(await sameInAll(entries, "kairo_team"));
    const row = team.tasks.find((t) => t.taskId === taskId);
    assert.equal(row.execution.state, "interrupted");
    assert.equal(row.nextTransition, "review_authorized");
    // blocked, with the same derivation in the tool output and the workspace snapshot
    const snapshot = await snapshotOf(w);
    assert.equal(snapshot.tasks.find((t) => t.id === taskId).status, "blocked");
    assert.equal(deriveTaskStatus(row).status, "blocked");

    // real processes read the same recovered evidence
    await withProcesses(w, installed, async (procs) => {
      const processTeam = okData(await sameInProcesses(procs, "kairo_team"));
      assert.equal(processTeam.tasks.find((t) => t.taskId === taskId).execution.state, "interrupted");
      const processResult = okData(await sameInProcesses(procs, "kairo_task_result", { taskId }));
      assert.equal(processResult.runState, "interrupted");
      assert.equal(processResult.transitions.next, "review_authorized");
    });

    assert.equal((await readRunState(w.home, launched.runId)).state, "interrupted");
    assert.equal(w.counters.startRun, 1, "no relaunch");
    assert.equal(await w.runCount(), 1);
    // a repeated confirmed execute from another entry reuses the interrupted run, it does not relaunch it
    assert.equal((await launchVia(entries.codex, taskId)).reused, true);
    assert.equal(w.counters.startRun, 1);
  } finally {
    child.kill("SIGKILL");
    await exited;
  }
});

// ================================================================ 5. status vocabulary identity

test("5. workspace snapshot status (draft / active / working) equals the status derived from kairo_team in every entry", async () => {
  const w = await world();
  const installed = await installEntries(w);
  const agree = async (expectedTeam, expectedTask = null, taskId = null) => {
    const entries = openEntries(w, installed);
    const team = okData(await sameInAll(entries, "kairo_team"));
    const snapshot = await snapshotOf(w);
    const derived = deriveWorkspaceStatus({
      team: { state: team.state },
      roles: rolesFromPublicTeam(team).map((r) => ({ ...r, availability: r.availability, reason: r.reason })),
      tasks: team.tasks
    });
    assert.equal(snapshot.status.status, derived.team.status);
    assert.equal(snapshot.status.status, expectedTeam);
    for (const task of team.tasks) {
      assert.equal(snapshot.tasks.find((t) => t.id === task.taskId).status, derived.tasks.find((t) => t.taskId === task.taskId).status);
    }
    if (taskId && expectedTask) assert.equal(snapshot.tasks.find((t) => t.id === taskId).status, expectedTask);
    for (const agent of snapshot.agents) assert.equal(agent.status, derived.agents.find((a) => a.role === agent.role).status, agent.role);
    // the process entries agree on the team state vocabulary too
    await withProcesses(w, installed, async (procs) => {
      const processTeam = okData(await sameInProcesses(procs, "kairo_team"));
      assert.equal(deriveTeamStatus(processTeam.state).status, expectedTeam);
    });
  };
  await agree("none");
  await w.draftTeam();
  await agree("draft");
  await w.approveTeam();
  await agree("active");
  const taskId = await w.newTask(SESSION_A);
  await agree("active", "draft", taskId);
  const run = await launchVia(openEntries(w, installed).codex, taskId);
  await agree("active", "working", taskId);
  await w.complete(run.runId);
  await agree("active", null, taskId);
  assert.equal(w.counters.startRun, 1);
});
