import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTranscriptEntry, clearTranscript, readTranscript, TRANSCRIPT_SCHEMA } from "../src/global/conversation/transcript-store.js";

async function tempProject() {
  return mkdtemp(join(tmpdir(), "kairo-transcript-"));
}

test("readTranscript returns an empty list when nothing has been persisted yet", async () => {
  const root = await tempProject();
  assert.deepEqual(await readTranscript(root), []);
});

test("appendTranscriptEntry persists entries in order, real timestamps included", async () => {
  const root = await tempProject();
  await appendTranscriptEntry(root, { role: "user", text: "what is this project?" });
  await appendTranscriptEntry(root, { role: "kairo", text: "claude: it's an orchestrator." });
  const entries = await readTranscript(root);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].role, "user");
  assert.equal(entries[0].text, "what is this project?");
  assert.equal(entries[1].role, "kairo");
  assert.match(entries[1].at, /^\d{4}-\d{2}-\d{2}T/);

  const onDisk = JSON.parse(await readFile(join(root, ".ai", "kairo", "transcript.json"), "utf8"));
  assert.equal(onDisk.schema, TRANSCRIPT_SCHEMA);
  assert.equal(onDisk.entries.length, 2);
});

test("readTranscript fails closed to an empty list on a malformed file, never throwing", async () => {
  const root = await tempProject();
  await appendTranscriptEntry(root, { role: "user", text: "seed a real dir first" });
  await writeFile(join(root, ".ai", "kairo", "transcript.json"), "not json");
  assert.deepEqual(await readTranscript(root), []);
});

test("readTranscript drops entries with an unrecognized role or non-string text instead of trusting them", async () => {
  const root = await tempProject();
  await mkdir(join(root, ".ai", "kairo"), { recursive: true });
  await writeFile(join(root, ".ai", "kairo", "transcript.json"), JSON.stringify({
    schema: TRANSCRIPT_SCHEMA,
    entries: [
      { role: "user", text: "ok" },
      { role: "system", text: "should be dropped" },
      { role: "kairo", text: 42 }
    ]
  }));
  const entries = await readTranscript(root);
  assert.deepEqual(entries.map((e) => e.text), ["ok"]);
});

test("clearTranscript persists an empty list so a cleared chat stays cleared", async () => {
  const root = await tempProject();
  await appendTranscriptEntry(root, { role: "user", text: "hello" });
  await clearTranscript(root);
  assert.deepEqual(await readTranscript(root), []);
});

test("appendTranscriptEntry bounds stored history instead of growing forever", async () => {
  const root = await tempProject();
  for (let i = 0; i < 505; i += 1) {
    await appendTranscriptEntry(root, { role: "user", text: `message ${i}` });
  }
  const entries = await readTranscript(root);
  assert.equal(entries.length, 500);
  assert.equal(entries[0].text, "message 5");
  assert.equal(entries[499].text, "message 504");
});
