import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import {
  acquireRequestLock, listTaskRecords, readExecutionLink, readTaskRecord, resolveProjectRoot,
  transitionTask, updateExecutionLink, verifyPlanForExecution, writeExecutionLink
} from "../src/global/architect/architect-store.js";
import {
  ARCHITECT_SCHEMA, createArchitectureRequestKey, createTaskId, sha256
} from "../src/global/architect/architect-types.js";

async function repo() {
  const root = await mkdtemp(join(tmpdir(), "kairo-architect-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(join(root, "README.md"), "hello\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

test("architecture plan persists project artifacts and explicit approval", async () => {
  const root = await repo();
  const result = await createArchitecturePlan({
    task: "Design safe payments", cwd: root, now: new Date("2026-01-02T03:04:05Z"),
    runCodex: async () => {
      const draftPath = join(root, ".ai", "tasks", "20260102030405-design-safe-payments-3ba0a93c", "status.json");
      const draft = JSON.parse(await readFile(draftPath, "utf8"));
      assert.equal(draft.state, "draft");
      return { plan: "## Design\nUse idempotency.", usage: { totalTokens: 12 } };
    }
  });
  assert.match(result.status.taskId, /^20260102030405-design-safe-payments-/);
  assert.equal(result.status.state, "awaiting_approval");
  assert.equal(result.status.projectRoot, await resolveProjectRoot(root));
  assert.match(await readFile(result.paths.taskPath, "utf8"), /Design safe payments/);
  assert.match(await readFile(result.paths.planPath, "utf8"), /Use idempotency/);
  assert.equal((await listTaskRecords(root)).length, 1);

  const duplicate = await createArchitecturePlan({
    task: "Design safe payments", cwd: root, now: new Date("2026-01-02T03:04:05Z"),
    runCodex: async () => ({ plan: "collision", usage: null })
  });
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.status.taskId, result.status.taskId);

  const approved = await transitionTask(root, result.status.taskId, "approved");
  assert.equal(approved.status.state, "approved");
  assert.equal(approved.status.decisionHead, result.status.baseHead);
});

test("duplicate concurrent and retried requests reuse one durable active plan", async () => {
  const root = await repo();
  let releaseCodex;
  const codexGate = new Promise((resolve) => { releaseCodex = resolve; });
  let started;
  const codexStarted = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  const firstPromise = createArchitecturePlan({
    task: "  Design   safe payments  ", cwd: root, model: " gpt-x ",
    runCodex: async () => {
      calls += 1;
      started();
      await codexGate;
      return { plan: "Use one idempotency key.", usage: null };
    }
  });
  await codexStarted;

  const concurrent = await createArchitecturePlan({
    task: "Design safe payments", cwd: root, model: "gpt-x",
    runCodex: async () => {
      calls += 1;
      return { plan: "duplicate", usage: null };
    }
  });
  assert.equal(concurrent.reused, true);
  assert.equal(concurrent.status.state, "draft");
  assert.equal(calls, 1);

  releaseCodex();
  const first = await firstPromise;
  const retry = await createArchitecturePlan({
    task: "Design safe payments", cwd: root, model: "gpt-x",
    runCodex: async () => {
      calls += 1;
      return { plan: "duplicate", usage: null };
    }
  });
  assert.equal(retry.reused, true);
  assert.equal(retry.status.state, "awaiting_approval");
  assert.equal(retry.status.taskId, first.status.taskId);
  assert.equal(calls, 1);
});

test("architect context pack carries governance without scanning private or unrelated files", async () => {
  const root = await repo();
  await writeFile(join(root, "AGENTS.md"), "# Governance\nUse TDD and Gentle review policy.\n");
  await writeFile(join(root, ".env"), "NEVER_INCLUDE_THIS_SECRET=1\n");
  await writeFile(join(root, "unrelated.txt"), "DO_NOT_SCAN_UNRELATED\n");
  let captured;
  await createArchitecturePlan({
    task: "Plan a bounded change", cwd: root,
    runCodex: async (input) => {
      captured = input.contextPack;
      return { plan: "Bounded plan", usage: null };
    }
  });
  assert.match(captured.systemPrompt, /Use TDD and Gentle review policy/);
  assert.doesNotMatch(captured.systemPrompt, /NEVER_INCLUDE_THIS_SECRET/);
  assert.doesNotMatch(captured.systemPrompt, /DO_NOT_SCAN_UNRELATED/);
  assert.equal(captured.privacy.includePrivate, false);
  assert.equal(captured.perRequest.files.length, 0);
  assert.ok(captured.estimatedTokens <= 10_000);
});

test("stale dead-process request locks are recovered safely", async () => {
  const root = await repo();
  const canonicalRoot = await resolveProjectRoot(root);
  const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const requestKey = createArchitectureRequestKey({
    projectRoot: canonicalRoot, baseHead, task: "Recover stale lock", model: null
  });
  const first = await acquireRequestLock(canonicalRoot, requestKey, {
    now: new Date("2020-01-01T00:00:00Z")
  });
  assert.equal(first.acquired, true);
  const recovered = await acquireRequestLock(canonicalRoot, requestKey, {
    now: new Date("2026-01-01T00:00:00Z"), staleAfterMs: 1
  });
  assert.equal(recovered.acquired, false, "a live owner must never be stolen solely due to age");
  await first.release();

  const lockDir = join(root, ".ai", "tasks", ".requests", `${requestKey}.lock`);
  await mkdir(lockDir);
  await writeFile(join(lockDir, "lease.json"), JSON.stringify({
    requestKey, token: "dead", pid: 2147483647, createdAt: "2020-01-01T00:00:00Z"
  }));
  const staleRecovered = await acquireRequestLock(canonicalRoot, requestKey, {
    now: new Date("2026-01-01T00:00:00Z"), staleAfterMs: 1
  });
  assert.equal(staleRecovered.acquired, true);
  await staleRecovered.release();
});

test("crashed draft is failed and replaced once after stale lock recovery", async () => {
  const root = await repo();
  const canonicalRoot = await resolveProjectRoot(root);
  const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const task = "Recover crashed planning";
  const requestKey = createArchitectureRequestKey({ projectRoot: canonicalRoot, baseHead, task, model: null });
  const orphanId = createTaskId(task, new Date("2026-01-01T00:00:00Z"));
  const orphanDir = join(root, ".ai", "tasks", orphanId);
  const taskMarkdown = `# Task\n\n${task}\n`;
  await mkdir(orphanDir, { recursive: true });
  await writeFile(join(orphanDir, "task.md"), taskMarkdown);
  await writeFile(join(orphanDir, "status.json"), JSON.stringify({
    schema: ARCHITECT_SCHEMA, taskId: orphanId, state: "draft", requestKey,
    provider: "codex", model: null, projectRoot: canonicalRoot, baseHead,
    taskDigest: sha256(task), taskArtifactDigest: sha256(taskMarkdown),
    planArtifactDigest: null, usage: null,
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z",
    decisionAt: null, decisionHead: null,
    artifacts: {
      task: `.ai/tasks/${orphanId}/task.md`, plan: `.ai/tasks/${orphanId}/plan.md`
    }
  }));
  const lockDir = join(root, ".ai", "tasks", ".requests", `${requestKey}.lock`);
  await mkdir(lockDir, { recursive: true });
  await writeFile(join(lockDir, "lease.json"), JSON.stringify({
    requestKey, token: "dead", pid: 2147483647, createdAt: "2020-01-01T00:00:00Z"
  }));

  let calls = 0;
  const recovered = await createArchitecturePlan({
    task, cwd: root, now: new Date("2026-01-01T00:00:00Z"),
    runCodex: async () => {
      calls += 1;
      return { plan: "Recovered plan", usage: null };
    }
  });
  assert.equal(calls, 1);
  assert.equal(recovered.reused, false);
  assert.equal(recovered.status.state, "awaiting_approval");
  assert.notEqual(recovered.status.taskId, orphanId);
  const orphan = await readTaskRecord(root, orphanId);
  assert.equal(orphan.status.state, "failed");
  assert.equal(orphan.status.error.code, "stale_architect_request");
});

test("approval refuses modified artifacts and stale repository HEAD", async () => {
  const root = await repo();
  const first = await createArchitecturePlan({
    task: "First", cwd: root,
    runCodex: async () => ({ plan: "Plan one", usage: null })
  });
  await writeFile(first.paths.planPath, "tampered\n");
  await assert.rejects(() => transitionTask(root, first.status.taskId, "approved"), /Plan artifact changed/);

  const second = await createArchitecturePlan({
    task: "Second", cwd: root,
    runCodex: async () => ({ plan: "Plan two", usage: null })
  });
  await writeFile(join(root, "next.txt"), "next\n");
  execFileSync("git", ["add", "next.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "next"], { cwd: root });
  await assert.rejects(() => transitionTask(root, second.status.taskId, "approved"), /stale/);
});

test("automatic execution requires the exact working tree captured at approval", async () => {
  const root = await repo();
  await writeFile(join(root, "work.txt"), "approved state\n");
  const created = await createArchitecturePlan({
    task: "Implement exact plan", cwd: root,
    runCodex: async () => ({ plan: "Plan", usage: null })
  });
  const approved = await transitionTask(root, created.status.taskId, "approved");
  assert.match(approved.status.workingTreeFingerprint, /^[0-9a-f]{64}$/);
  await verifyPlanForExecution(root, created.status.taskId);
  await writeExecutionLink(approved.status.projectRoot, created.status.taskId, {
    runId: "run_fixed", state: "reserved", createdAt: "now", updatedAt: "now"
  });
  await verifyPlanForExecution(root, created.status.taskId);
  await writeFile(join(root, "work.txt"), "changed after approval\n");
  await assert.rejects(() => verifyPlanForExecution(root, created.status.taskId), /working tree changed/);
});

test("execution link provider mirrors the real agentId, not a hardcoded value", async () => {
  const root = await repo();
  const created = await createArchitecturePlan({
    task: "Route to codex", cwd: root,
    runCodex: async () => ({ plan: "Plan", usage: null })
  });
  await transitionTask(root, created.status.taskId, "approved");
  const written = await writeExecutionLink(created.status.projectRoot, created.status.taskId, {
    runId: "run_codex1", agentId: "codex", state: "reserved", createdAt: "now", updatedAt: "now"
  });
  assert.equal(written.provider, "codex");
  const readBack = await readExecutionLink(created.status.projectRoot, created.status.taskId);
  assert.equal(readBack.provider, "codex");

  const updated = await updateExecutionLink(created.status.projectRoot, created.status.taskId, {
    ...readBack, agentId: "cursor", state: "running"
  });
  assert.equal(updated.provider, "cursor");
  assert.equal((await readExecutionLink(created.status.projectRoot, created.status.taskId)).provider, "cursor");
});

test("legacy approvals without a working-tree fingerprint fail closed", async () => {
  const root = await repo();
  const created = await createArchitecturePlan({
    task: "Legacy plan", cwd: root,
    runCodex: async () => ({ plan: "Plan", usage: null })
  });
  await transitionTask(root, created.status.taskId, "approved");
  const status = JSON.parse(await readFile(created.paths.statusPath, "utf8"));
  delete status.workingTreeFingerprint;
  await writeFile(created.paths.statusPath, JSON.stringify(status));
  await assert.rejects(() => verifyPlanForExecution(root, created.status.taskId), /predates working-tree fingerprints/);
});

test("artifact store rejects symlinked .ai/tasks path", async () => {
  const root = await repo();
  const outside = await mkdtemp(join(tmpdir(), "kairo-architect-outside-"));
  await mkdir(join(root, ".ai"));
  await symlink(outside, join(root, ".ai", "tasks"));
  await assert.rejects(() => createArchitecturePlan({
    task: "Escape", cwd: root,
    runCodex: async () => ({ plan: "no", usage: null })
  }), /Unsafe (?:artifact|tasks) directory/);
  assert.equal(await readTaskRecord(root, "valid-id"), null);
});

test("failed planning remains safely observable without a plan artifact", async () => {
  const root = await repo();
  await assert.rejects(() => createArchitecturePlan({
    task: "Impossible plan", cwd: root,
    runCodex: async () => { throw new Error("Codex unavailable"); }
  }), /Codex unavailable/);
  const records = await listTaskRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].state, "failed");
  assert.equal(records[0].error.message, "Codex unavailable");
  const record = await readTaskRecord(root, records[0].taskId);
  assert.equal(record.planMarkdown, null);
});
