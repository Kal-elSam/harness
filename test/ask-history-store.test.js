import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAskHistoryEntry, ASK_HISTORY_SCHEMA, clearAskHistory, readAskHistory
} from "../src/global/conversation/ask-history-store.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";

async function tempHomeAndProject() {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "kairo-project-"));
  return { homeDir, projectRoot };
}

function askHistoryFilePath(homeDir, projectRoot) {
  return join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(projectRoot), "ask-history.json");
}

test("readAskHistory returns an empty list when nothing has been persisted yet", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  assert.deepEqual(await readAskHistory(homeDir, projectRoot), []);
});

test("appendAskHistoryEntry persists real question/answer exchanges in order, with real timestamps", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await appendAskHistoryEntry(homeDir, projectRoot, { question: "what is this project?", answer: "It's an orchestrator.", provider: "claude", model: "claude-opus-5" });
  await appendAskHistoryEntry(homeDir, projectRoot, { question: "and what does it orchestrate?", answer: "Codex, Claude, Cursor, OpenCode.", provider: "codex", model: "gpt-6-astra" });
  const entries = await readAskHistory(homeDir, projectRoot);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].question, "what is this project?");
  assert.equal(entries[0].provider, "claude");
  assert.equal(entries[1].answer, "Codex, Claude, Cursor, OpenCode.");
  assert.match(entries[1].at, /^\d{4}-\d{2}-\d{2}T/);

  const onDisk = JSON.parse(await readFile(askHistoryFilePath(homeDir, projectRoot), "utf8"));
  assert.equal(onDisk.schema, ASK_HISTORY_SCHEMA);
  assert.equal(onDisk.entries.length, 2);
});

test("a missing model is stored as null, never fabricated", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await appendAskHistoryEntry(homeDir, projectRoot, { question: "q", answer: "a", provider: "codex" });
  const [entry] = await readAskHistory(homeDir, projectRoot);
  assert.equal(entry.model, null);
});

test("the ask history is keyed by project path, never written inside the project's own directory", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await appendAskHistoryEntry(homeDir, projectRoot, { question: "hi", answer: "hello", provider: "codex" });
  const path = askHistoryFilePath(homeDir, projectRoot);
  assert.ok(path.startsWith(homeDir), "ask history must live under the harness home");
  assert.ok(!path.startsWith(projectRoot), "ask history must never live inside the project directory");
});

test("readAskHistory fails closed to an empty list on a malformed file, never throwing", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await appendAskHistoryEntry(homeDir, projectRoot, { question: "seed a real dir first", answer: "ok", provider: "codex" });
  await writeFile(askHistoryFilePath(homeDir, projectRoot), "not json");
  assert.deepEqual(await readAskHistory(homeDir, projectRoot), []);
});

test("readAskHistory drops entries missing a real question/answer/provider instead of trusting them", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const path = askHistoryFilePath(homeDir, projectRoot);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify({
    schema: ASK_HISTORY_SCHEMA,
    entries: [
      { question: "ok", answer: "ok", provider: "codex" },
      { question: "missing provider", answer: "x" },
      { question: 42, answer: "x", provider: "codex" }
    ]
  }));
  const entries = await readAskHistory(homeDir, projectRoot);
  assert.deepEqual(entries.map((e) => e.question), ["ok"]);
});

test("clearAskHistory persists an empty list so a cleared chat stops carrying prior ASK context forward", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await appendAskHistoryEntry(homeDir, projectRoot, { question: "q", answer: "a", provider: "codex" });
  await clearAskHistory(homeDir, projectRoot);
  assert.deepEqual(await readAskHistory(homeDir, projectRoot), []);
});

test("appendAskHistoryEntry bounds stored history instead of growing forever", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  for (let i = 0; i < 205; i += 1) {
    await appendAskHistoryEntry(homeDir, projectRoot, { question: `question ${i}`, answer: `answer ${i}`, provider: "codex" });
  }
  const entries = await readAskHistory(homeDir, projectRoot);
  assert.equal(entries.length, 200);
  assert.equal(entries[0].question, "question 5");
  assert.equal(entries[199].question, "question 204");
});
