import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTranscriptEntry, clearTranscript, readTranscript, TRANSCRIPT_SCHEMA } from "../src/global/conversation/transcript-store.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";

async function tempHomeAndProject() {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "kairo-project-"));
  return { homeDir, projectRoot };
}

function transcriptFilePath(homeDir, projectRoot) {
  return join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(projectRoot), "transcript.json");
}

test("readTranscript returns an empty list when nothing has been persisted yet", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  assert.deepEqual(await readTranscript(homeDir, projectRoot), []);
});

test("appendTranscriptEntry persists entries in order under the global harness home, real timestamps included", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await appendTranscriptEntry(homeDir, projectRoot, { role: "user", text: "what is this project?" });
  await appendTranscriptEntry(homeDir, projectRoot, { role: "kairo", text: "claude: it's an orchestrator." });
  const entries = await readTranscript(homeDir, projectRoot);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].role, "user");
  assert.equal(entries[0].text, "what is this project?");
  assert.equal(entries[1].role, "kairo");
  assert.match(entries[1].at, /^\d{4}-\d{2}-\d{2}T/);

  const onDisk = JSON.parse(await readFile(transcriptFilePath(homeDir, projectRoot), "utf8"));
  assert.equal(onDisk.schema, TRANSCRIPT_SCHEMA);
  assert.equal(onDisk.entries.length, 2);
});

test("the transcript is keyed by project path, never written inside the project's own directory", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await appendTranscriptEntry(homeDir, projectRoot, { role: "user", text: "hi" });
  const path = transcriptFilePath(homeDir, projectRoot);
  assert.ok(path.startsWith(homeDir), "transcript must live under the harness home");
  assert.ok(!path.startsWith(projectRoot), "transcript must never live inside the project directory");
});

test("readTranscript fails closed to an empty list on a malformed file, never throwing", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await appendTranscriptEntry(homeDir, projectRoot, { role: "user", text: "seed a real dir first" });
  await writeFile(transcriptFilePath(homeDir, projectRoot), "not json");
  assert.deepEqual(await readTranscript(homeDir, projectRoot), []);
});

test("readTranscript drops entries with an unrecognized role or non-string text instead of trusting them", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const path = transcriptFilePath(homeDir, projectRoot);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify({
    schema: TRANSCRIPT_SCHEMA,
    entries: [
      { role: "user", text: "ok" },
      { role: "system", text: "should be dropped" },
      { role: "kairo", text: 42 }
    ]
  }));
  const entries = await readTranscript(homeDir, projectRoot);
  assert.deepEqual(entries.map((e) => e.text), ["ok"]);
});

test("clearTranscript persists an empty list so a cleared chat stays cleared", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await appendTranscriptEntry(homeDir, projectRoot, { role: "user", text: "hello" });
  await clearTranscript(homeDir, projectRoot);
  assert.deepEqual(await readTranscript(homeDir, projectRoot), []);
});

test("appendTranscriptEntry bounds stored history instead of growing forever", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  for (let i = 0; i < 505; i += 1) {
    await appendTranscriptEntry(homeDir, projectRoot, { role: "user", text: `message ${i}` });
  }
  const entries = await readTranscript(homeDir, projectRoot);
  assert.equal(entries.length, 500);
  assert.equal(entries[0].text, "message 5");
  assert.equal(entries[499].text, "message 504");
});
