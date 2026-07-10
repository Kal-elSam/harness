import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendRunEvent,
  createRunRecord,
  listRunRecords,
  markInterruptedRuns,
  readRunEvents,
  readRunState
} from "../src/global/runtime/run-store.js";
import { createRunMetadata, RUN_STATES } from "../src/global/runtime/run-types.js";
import { createRunEvent } from "../src/global/runtime/run-events.js";

test("run store persists state and append-only events", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-store-"));
  const metadata = createRunMetadata({
    runId: "run_store_test",
    agentId: "cursor",
    provider: "Cursor",
    task: "do work",
    cwd: homeDir,
    cliVersion: "0.2.1"
  });

  await createRunRecord(homeDir, metadata);
  await appendRunEvent(homeDir, createRunEvent({
    runId: metadata.runId,
    type: "run.started",
    data: { agentId: "cursor" }
  }));

  const statePath = join(homeDir, ".harness", "runs", metadata.runId, "state.json");
  const eventsPath = join(homeDir, ".harness", "runs", metadata.runId, "events.jsonl");

  assert.equal(existsSync(statePath), true);
  assert.equal(existsSync(eventsPath), true);

  const loaded = await readRunState(homeDir, metadata.runId);
  assert.equal(loaded.runId, metadata.runId);

  const events = await readRunEvents(homeDir, metadata.runId);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "run.started");
});

test("listRunRecords sorts by startedAt descending", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-list-"));

  const older = createRunMetadata({
    runId: "run_old",
    agentId: "cursor",
    provider: "Cursor",
    task: "old",
    cwd: homeDir,
    cliVersion: "0.2.1"
  });
  older.startedAt = "2026-01-01T00:00:00.000Z";

  const newer = createRunMetadata({
    runId: "run_new",
    agentId: "codex",
    provider: "Codex",
    task: "new",
    cwd: homeDir,
    cliVersion: "0.2.1"
  });
  newer.startedAt = "2026-07-01T00:00:00.000Z";

  await createRunRecord(homeDir, older);
  await createRunRecord(homeDir, newer);

  const runs = await listRunRecords(homeDir);
  assert.equal(runs[0].runId, "run_new");
  assert.equal(runs[1].runId, "run_old");
});

test("markInterruptedRuns updates active runs", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-interrupt-"));
  const metadata = createRunMetadata({
    runId: "run_active",
    agentId: "cursor",
    provider: "Cursor",
    task: "active",
    cwd: homeDir,
    cliVersion: "0.2.1"
  });
  metadata.state = RUN_STATES.RUNNING;

  await createRunRecord(homeDir, metadata);
  const interrupted = await markInterruptedRuns(homeDir);

  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].state, RUN_STATES.INTERRUPTED);

  const events = await readRunEvents(homeDir, metadata.runId);
  assert.ok(events.some((event) => event.type === "run.failed"));
});

test("transcript file is not created without opt-in", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-transcript-"));
  const metadata = createRunMetadata({
    runId: "run_no_transcript",
    agentId: "cursor",
    provider: "Cursor",
    task: "task",
    cwd: homeDir,
    cliVersion: "0.2.1"
  });

  await createRunRecord(homeDir, metadata);
  await appendRunEvent(
    homeDir,
    createRunEvent({ runId: metadata.runId, type: "run.transcript", data: { content: "secret" } }),
    { captureTranscript: false }
  );

  const transcriptPath = join(homeDir, ".harness", "runs", metadata.runId, "transcript.jsonl");
  assert.equal(existsSync(transcriptPath), false);
});

test("transcript file is created with opt-in", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-transcript-on-"));
  const metadata = createRunMetadata({
    runId: "run_with_transcript",
    agentId: "cursor",
    provider: "Cursor",
    task: "task",
    cwd: homeDir,
    cliVersion: "0.2.1",
    captureTranscript: true
  });

  await createRunRecord(homeDir, metadata);
  await appendRunEvent(
    homeDir,
    createRunEvent({
      runId: metadata.runId,
      type: "run.transcript",
      data: { content: "visible" },
      captureTranscript: true
    }),
    { captureTranscript: true }
  );

  const transcriptPath = join(homeDir, ".harness", "runs", metadata.runId, "transcript.jsonl");
  assert.equal(existsSync(transcriptPath), true);
  const content = await readFile(transcriptPath, "utf8");
  assert.match(content, /visible/);
});
