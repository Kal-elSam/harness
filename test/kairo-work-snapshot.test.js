import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";
import {
  WORK_SNAPSHOT_SCHEMA,
  createWorkSnapshot,
  saveWorkSnapshot,
  loadWorkSnapshot,
  listWorkSnapshots,
  selectLatestWorkSnapshot,
  snapshotFileId,
  snapshotIsComplete,
  IGNORED_SMOKE_CONVERSATION_IDS
} from "../src/global/next/work-snapshot.js";

test("createWorkSnapshot strips leaks and rejects private payloads", () => {
  assert.throws(() => createWorkSnapshot({ goal: "x", prompt: "secret" }), /Private field/);
  const snap = createWorkSnapshot({
    goal: "Ship companion vertical",
    progress: ["Slice 1 store", "ks_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    now: "Writing work-snapshot/v1",
    blockers: ["CI packaging not verified", "call kairo_turn_sync missing"],
    next: "Add MCP publish",
    delegations: [
      {
        workId: "kw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        title: "Worker slice",
        role: "worker",
        state: "working"
      },
      { title: "ks_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
    ]
  });
  assert.equal(snap.schema, WORK_SNAPSHOT_SCHEMA);
  assert.deepEqual(snap.progress, ["Slice 1 store"]);
  assert.deepEqual(snap.blockers, ["CI packaging not verified"]);
  assert.equal(snap.delegations.length, 1);
  assert.equal(snapshotIsComplete(snap), true);
});

test("incomplete snapshot keeps nulls and never invents content", () => {
  const snap = createWorkSnapshot({ goal: "Only goal" });
  assert.equal(snap.now, null);
  assert.equal(snap.next, null);
  assert.equal(snap.delegations, undefined);
  assert.equal(snapshotIsComplete(snap), false);
});

test("snapshots isolate workspace/conversation and avoid path collisions", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-snap-iso-"));
  const projectA = join(homeDir, "proj-a");
  const projectB = join(homeDir, "proj-b");
  try {
    assert.equal(
      harnessHomePaths(homeDir).sessionsDir,
      join(homeDir, ".harness", "sessions")
    );
    assert.notEqual(snapshotFileId("chat/1"), snapshotFileId("chat_1"));
    await assert.rejects(
      () => saveWorkSnapshot(homeDir, projectA, null, { goal: "x", now: "y", next: "z" }),
      /conversationId is required/
    );

    await saveWorkSnapshot(homeDir, projectA, null, {
      conversationId: "chat/1",
      goal: "slash",
      now: "a",
      next: "b"
    });
    await saveWorkSnapshot(homeDir, projectA, "chat_1", {
      goal: "underscore",
      now: "a",
      next: "b"
    });
    await saveWorkSnapshot(homeDir, projectB, "chat/1", {
      goal: "other-ws",
      now: "a",
      next: "b"
    });

    assert.equal((await loadWorkSnapshot(homeDir, projectA, "chat/1")).goal, "slash");
    assert.equal((await loadWorkSnapshot(homeDir, projectA, "chat_1")).goal, "underscore");
    assert.equal((await loadWorkSnapshot(homeDir, projectB, "chat/1")).goal, "other-ws");
    assert.notEqual(projectKeyForPath(projectA), projectKeyForPath(projectB));
    assert.equal((await listWorkSnapshots(homeDir, projectA)).length, 2);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("selectLatest prefers newest and ignores smoke without deleting", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-snap-latest-"));
  const projectPath = join(homeDir, "proj");
  const projectKey = projectKeyForPath(projectPath);
  const dir = join(harnessHomePaths(homeDir).sessionsDir, projectKey, "snapshots");
  try {
    await saveWorkSnapshot(homeDir, projectPath, "older", {
      goal: "Older", now: "was working", next: "done"
    }, { now: () => "2026-08-01T00:00:00.000Z" });
    await saveWorkSnapshot(homeDir, projectPath, "newer", {
      goal: "Newer", now: "is working", next: "ship"
    }, { now: () => "2026-08-11T12:00:00.000Z" });

    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "smoke-seed.json"), `${JSON.stringify({
      schema: WORK_SNAPSHOT_SCHEMA,
      goal: "Smoke fixture",
      progress: [],
      now: "seeded",
      blockers: [],
      next: "ignore me",
      conversationId: IGNORED_SMOKE_CONVERSATION_IDS[0],
      projectKey,
      updatedAt: "2026-08-12T00:00:00.000Z"
    }, null, 2)}\n`);
    await writeFile(join(dir, "corrupt.json"), "{ not-json");

    const latest = await selectLatestWorkSnapshot(homeDir, projectPath);
    assert.equal(latest.goal, "Newer");
    assert.equal((await listWorkSnapshots(homeDir, projectPath)).length, 2);
    assert.match(await readFile(join(dir, "smoke-seed.json"), "utf8"), /Smoke fixture/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
