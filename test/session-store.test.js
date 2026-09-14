import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSession, SESSION_SCHEMA, writeSessionMode } from "../src/global/conversation/session-store.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";

async function tempHomeAndProject() {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "kairo-project-"));
  return { homeDir, projectRoot };
}

function sessionFilePath(homeDir, projectRoot) {
  return join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(projectRoot), "session.json");
}

test("readSession defaults to ASK — the strictly read-only mode — when nothing has been persisted yet", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const session = await readSession(homeDir, projectRoot);
  assert.equal(session.mode, "ask");
  assert.equal(session.schema, SESSION_SCHEMA);
});

test("writeSessionMode persists the new mode under the global harness home, never inside the project directory", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await writeSessionMode(homeDir, projectRoot, "plan");
  const session = await readSession(homeDir, projectRoot);
  assert.equal(session.mode, "plan");
  const path = sessionFilePath(homeDir, projectRoot);
  assert.ok(path.startsWith(homeDir));
  assert.ok(!path.startsWith(projectRoot));
});

test("writeSessionMode round-trips through ASK -> PLAN -> AGENT -> ASK, keeping id/createdAt stable across changes", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const first = await writeSessionMode(homeDir, projectRoot, "plan");
  const second = await writeSessionMode(homeDir, projectRoot, "agent");
  const third = await writeSessionMode(homeDir, projectRoot, "ask");
  assert.equal(third.mode, "ask");
  assert.equal(first.id, second.id);
  assert.equal(second.id, third.id);
  assert.equal(first.createdAt, third.createdAt);
});

test("writeSessionMode rejects an unrecognized mode instead of silently persisting garbage", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await assert.rejects(() => writeSessionMode(homeDir, projectRoot, "yolo"));
});

test("readSession fails closed to ASK on a malformed file, never throwing — this is how a pre-WorkMode session migrates", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const path = sessionFilePath(homeDir, projectRoot);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "not json");
  const session = await readSession(homeDir, projectRoot);
  assert.equal(session.mode, "ask");
});

test("readSession fails closed to ASK when the persisted mode isn't a recognized WorkMode", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const path = sessionFilePath(homeDir, projectRoot);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify({ schema: SESSION_SCHEMA, id: "x", mode: "execute-everything" }));
  const session = await readSession(homeDir, projectRoot);
  assert.equal(session.mode, "ask");
});
