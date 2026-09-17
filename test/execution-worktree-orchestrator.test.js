import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import { transitionTask } from "../src/global/architect/architect-store.js";
import { beginRoleRun, createExecutionWorktree } from "../src/global/runtime/execution-worktree-manager.js";
import { readWorktreeState, readCheckpoints } from "../src/global/runtime/execution-worktree-store.js";
import { WORKTREE_STATES } from "../src/global/runtime/execution-worktree-types.js";
import { runOrchestratedChain } from "../src/global/runtime/execution-worktree-orchestrator.js";
import { resolveExecutionAdapter } from "../src/global/runtime/execution-adapters/index.js";
import { recordProviderUsage } from "../src/global/runtime/usage-manager.js";

function resolveAdapterWithNoopPreflight(agentId) {
  const adapter = resolveExecutionAdapter(agentId);
  return { ...adapter, preflight: async () => ({ ok: true }) };
}

/**
 * One `step` per expected real startRun invocation, consumed strictly in
 * order — matches runOrchestratedChain's own strict Builder/Debugger/
 * Tester sequencing, so step[0] is always Builder's real run, step[1]
 * Debugger's, step[2] Tester's.
 */
function createStepSpawn(steps) {
  let index = 0;
  const invocations = [];
  const spawnImpl = (_command, _args, options) => {
    const step = steps[index] ?? { exitCode: 0 };
    invocations.push({ cwd: options.cwd, args: _args });
    index += 1;

    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242 + index;
    child.kill = () => child.emit("close", 130);

    setImmediate(async () => {
      if (step.writeFile) {
        await writeFile(join(options.cwd, step.writeFile.name), step.writeFile.content);
      }
      if (step.usage) {
        child.stdout.emit("data", `${JSON.stringify({ type: "result", usage: step.usage })}\n`);
      }
      child.emit("close", step.exitCode ?? 0);
    });

    return child;
  };
  return { spawnImpl, invocations };
}

async function repo() {
  const root = await mkdtemp(join(tmpdir(), "kairo-orchestrator-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(join(root, "README.md"), "hello\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

async function harnessHome() {
  return mkdtemp(join(tmpdir(), "kairo-orchestrator-home-"));
}

async function readyToOrchestrate(root, task = "Design safe payments") {
  const homeDir = await harnessHome();
  const created = await createArchitecturePlan({
    task, cwd: root, runCodex: async () => ({ plan: "## Plan\nReal work.", usage: null })
  });
  await transitionTask(root, created.status.taskId, "approved");
  const worktree = await createExecutionWorktree({ projectRoot: root, taskId: created.status.taskId, homeDir });
  return { homeDir, worktree };
}

test("runOrchestratedChain drives Builder -> Debugger -> Tester in strict order, each producing a real commit, ending READY_FOR_REVIEW", async () => {
  const root = await repo();
  const { homeDir, worktree } = await readyToOrchestrate(root);

  const { spawnImpl, invocations } = createStepSpawn([
    { writeFile: { name: "builder.txt", content: "real builder work\n" }, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
    { writeFile: { name: "debugger.txt", content: "real debugger fix\n" }, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
    { writeFile: { name: "tester.txt", content: "real tests\n" }, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }
  ]);

  const result = await runOrchestratedChain({
    worktreeId: worktree.worktreeId, homeDir, agentId: "codex", cliVersion: "0.16.0",
    spawnImpl, resolveAdapterImpl: resolveAdapterWithNoopPreflight
  });

  assert.deepEqual(result.completedRoles, ["Builder", "Debugger", "Tester"]);
  assert.equal(result.worktree.status, WORKTREE_STATES.READY_FOR_REVIEW);
  assert.equal(invocations.length, 3, "exactly one real run per role, never more, never fewer");

  const log = execFileSync("git", ["-C", worktree.treePath, "log", "--oneline"], { encoding: "utf8" });
  const commitCount = log.trim().split("\n").length;
  assert.equal(commitCount, 4, "one real commit per role (3) on top of the original baseSha commit (1)");

  const checkpoints = await readCheckpoints(homeDir, worktree.worktreeId);
  const roles = checkpoints.filter((c) => c.phase === "before").map((c) => c.role);
  assert.deepEqual(roles, ["Builder", "Debugger", "Tester"], "checkpoints must reflect the exact real order roles actually ran in");
});

test("runOrchestratedChain stops immediately when a role's real run fails — later roles are never attempted", async () => {
  const root = await repo();
  const { homeDir, worktree } = await readyToOrchestrate(root);

  const { spawnImpl, invocations } = createStepSpawn([
    { writeFile: { name: "builder.txt", content: "real builder work\n" } },
    { exitCode: 1 }, // Debugger's real process fails
    { writeFile: { name: "tester.txt", content: "must never be written" } }
  ]);

  await assert.rejects(
    () => runOrchestratedChain({
      worktreeId: worktree.worktreeId, homeDir, agentId: "codex", cliVersion: "0.16.0",
      spawnImpl, resolveAdapterImpl: resolveAdapterWithNoopPreflight
    }),
    /Orchestrated chain stopped at role "Debugger"/
  );

  assert.equal(invocations.length, 2, "Tester's real run must never be launched once Debugger fails");
  const state = await readWorktreeState(homeDir, worktree.worktreeId);
  assert.equal(state.status, WORKTREE_STATES.INTERRUPTED);
  assert.equal(existsSync(join(worktree.treePath, "tester.txt")), false);

  const log = execFileSync("git", ["-C", worktree.treePath, "log", "--oneline"], { encoding: "utf8" });
  assert.equal(log.trim().split("\n").length, 2, "only Builder's real commit exists — Debugger's failed attempt produced none");
});

test("runOrchestratedChain marks the worktree INTERRUPTED when a role's run can never even start (real budget exhausted)", async () => {
  const root = await repo();
  const { homeDir, worktree } = await readyToOrchestrate(root);
  await recordProviderUsage(homeDir, "claude", { total: 1000, cost: null });

  const { spawnImpl, invocations } = createStepSpawn([
    { writeFile: { name: "builder.txt", content: "real builder work\n" } },
    { writeFile: { name: "debugger.txt", content: "must never be reached" } }
  ]);

  await assert.rejects(
    () => runOrchestratedChain({
      worktreeId: worktree.worktreeId, homeDir, agentId: "codex", cliVersion: "0.16.0",
      roleAgents: { Debugger: "claude" },
      profile: { profile: { providerTokenBudgets: { claude: 1000 } }, sources: null },
      spawnImpl, resolveAdapterImpl: resolveAdapterWithNoopPreflight
    }),
    /Orchestrated chain stopped at role "Debugger".*exhausted/
  );

  assert.equal(invocations.length, 1, "Debugger's real run must never even spawn once its provider is exhausted");
  const state = await readWorktreeState(homeDir, worktree.worktreeId);
  assert.equal(state.status, WORKTREE_STATES.INTERRUPTED);
});

test("runOrchestratedChain rejects a worktree that isn't freshly PENDING — already in progress must be driven manually", async () => {
  const root = await repo();
  const { homeDir, worktree } = await readyToOrchestrate(root);

  // A role already started manually — real ACTIVE state, never a fresh,
  // never-run worktree runOrchestratedChain expects.
  await beginRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_manual", homeDir });

  const { spawnImpl } = createStepSpawn([{ writeFile: { name: "never-runs.txt", content: "never runs\n" } }]);
  await assert.rejects(
    () => runOrchestratedChain({
      worktreeId: worktree.worktreeId, homeDir, agentId: "codex", cliVersion: "0.16.0",
      spawnImpl, resolveAdapterImpl: resolveAdapterWithNoopPreflight
    }),
    /only drives a freshly-created worktree from PENDING/
  );

  const state = await readWorktreeState(homeDir, worktree.worktreeId);
  assert.equal(state.status, WORKTREE_STATES.ACTIVE, "a rejected orchestration attempt must never disturb the worktree's real, already-in-progress state");
});

test("runOrchestratedChain uses a per-role provider override from roleAgents", async () => {
  const root = await repo();
  const { homeDir, worktree } = await readyToOrchestrate(root);

  const usedAdapterIds = [];
  const trackingResolveAdapter = (agentId) => {
    usedAdapterIds.push(agentId);
    return resolveAdapterWithNoopPreflight(agentId);
  };

  const { spawnImpl } = createStepSpawn([
    { writeFile: { name: "builder.txt", content: "b\n" } },
    { writeFile: { name: "debugger.txt", content: "d\n" } },
    { writeFile: { name: "tester.txt", content: "t\n" } }
  ]);

  await runOrchestratedChain({
    worktreeId: worktree.worktreeId, homeDir, agentId: "codex", cliVersion: "0.16.0",
    roleAgents: { Tester: "claude" },
    spawnImpl, resolveAdapterImpl: trackingResolveAdapter
  });

  // resolveAdapterImpl is called more than once per role internally
  // (run-manager.js's own prepareRun and run-supervisor.js's own
  // supervisePreparedRun each resolve it independently) — what matters
  // here is the real sequence of providers used, not the exact call count.
  const collapsed = usedAdapterIds.filter((id, i) => id !== usedAdapterIds[i - 1]);
  assert.deepEqual(collapsed, ["codex", "claude"], "only Tester's explicit override changes its provider — Builder/Debugger keep the default agentId");
});

test("REGRESSION: runOrchestratedChain injects a matching real project skill's name/path into every role's real task text, never the skill's own content", async () => {
  const root = await repo();

  // A real, committed skill the worktree's own checkout will contain —
  // the exact same real catalog readSkillCatalog/matchSkills already read
  // for ASK-mode routing, reused here rather than reinvented.
  execFileSync("mkdir", ["-p", join(root, "docs", "skills", "payment-reconciliation")]);
  await writeFile(
    join(root, "docs", "skills", "payment-reconciliation", "SKILL.md"),
    "---\nname: payment-reconciliation\ndescription: Reconciliation rules for payments refunds and settlement ledgers.\n---\nFull skill body — must never be injected verbatim.\n"
  );
  execFileSync("git", ["add", "docs"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "add skill"], { cwd: root });

  const homeDir = await harnessHome();
  const created = await createArchitecturePlan({
    task: "Fix refunds reconciliation", cwd: root,
    runCodex: async () => ({ plan: "## Plan\nReconcile payments refunds against the settlement ledger.", usage: null })
  });
  await transitionTask(root, created.status.taskId, "approved");
  const worktree = await createExecutionWorktree({ projectRoot: root, taskId: created.status.taskId, homeDir });

  const { spawnImpl, invocations } = createStepSpawn([
    { writeFile: { name: "builder.txt", content: "b\n" } },
    { writeFile: { name: "debugger.txt", content: "d\n" } },
    { writeFile: { name: "tester.txt", content: "t\n" } }
  ]);

  await runOrchestratedChain({
    worktreeId: worktree.worktreeId, homeDir, agentId: "codex", cliVersion: "0.16.0",
    spawnImpl, resolveAdapterImpl: resolveAdapterWithNoopPreflight
  });

  assert.equal(invocations.length, 3);
  for (const invocation of invocations) {
    const task = invocation.args.at(-1);
    assert.match(task, /payment-reconciliation \(docs\/skills\/payment-reconciliation\/SKILL\.md\)/, "each role's real task must reference the real matched skill's name and real file path");
    assert.doesNotMatch(task, /Full skill body/, "the skill's own real content must never be duplicated into the prompt — only its name/path/description");
  }
});

test("runOrchestratedChain leaves the task text untouched when no real project skill matches", async () => {
  const root = await repo();
  const { homeDir, worktree } = await readyToOrchestrate(root);
  const { spawnImpl, invocations } = createStepSpawn([
    { writeFile: { name: "builder.txt", content: "b\n" } },
    { writeFile: { name: "debugger.txt", content: "d\n" } },
    { writeFile: { name: "tester.txt", content: "t\n" } }
  ]);

  await runOrchestratedChain({
    worktreeId: worktree.worktreeId, homeDir, agentId: "codex", cliVersion: "0.16.0",
    spawnImpl, resolveAdapterImpl: resolveAdapterWithNoopPreflight
  });

  for (const invocation of invocations) {
    assert.doesNotMatch(invocation.args.at(-1), /Relevant project skills/, "no real skill catalog exists for this project — nothing to inject");
  }
});
