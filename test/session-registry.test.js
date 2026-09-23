import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  conversationsDir, createSession, ensureHostMetadata, getSession, listSessions, migrateLegacySessionIfNeeded, resolveSessionRef,
  SESSION_SCHEMA_V2, sessionDirFor, updateSessionMode
} from "../src/global/conversation/session-registry.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";

async function tempHomeAndProject() {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "kairo-project-"));
  return { homeDir, projectRoot };
}

function legacyRoot(homeDir, projectRoot) {
  return join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(projectRoot));
}

test("createSession persists a real, isolated v2 session and returns it", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const session = await createSession(homeDir, projectRoot, { title: "Investigate the flaky test" });
  assert.equal(session.schema, SESSION_SCHEMA_V2);
  assert.equal(session.title, "Investigate the flaky test");
  assert.equal(session.mode, "ask");
  assert.match(session.id, /^[0-9a-f-]{36}$/);
  const onDisk = JSON.parse(await readFile(join(sessionDirFor(homeDir, projectRoot, session.id), "session.json"), "utf8"));
  assert.deepEqual(onDisk, session);
});

test("a title longer than 80 chars is truncated with a real ellipsis, never silently cut with no indication", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const session = await createSession(homeDir, projectRoot, { title: "x".repeat(100) });
  assert.equal(session.title.length, 80);
  assert.ok(session.title.endsWith("…"));
});

test("a session created with no title stores title: null — never a fabricated placeholder", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const session = await createSession(homeDir, projectRoot, {});
  assert.equal(session.title, null);
});

test("listSessions returns real sessions ordered by most recently updated first", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const first = await createSession(homeDir, projectRoot, { title: "First" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await createSession(homeDir, projectRoot, { title: "Second" });
  const sessions = await listSessions(homeDir, projectRoot);
  assert.deepEqual(sessions.map((s) => s.id), [second.id, first.id]);
});

test("listSessions skips a corrupt individual session directory instead of hiding every other real one", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const good = await createSession(homeDir, projectRoot, { title: "Good" });
  const corruptDir = sessionDirFor(homeDir, projectRoot, "aaaaaaaa-0000-0000-0000-00000000dead");
  await mkdir(corruptDir, { recursive: true });
  await writeFile(join(corruptDir, "session.json"), "not json");
  const sessions = await listSessions(homeDir, projectRoot);
  assert.deepEqual(sessions.map((s) => s.id), [good.id]);
});

test("REGRESSION: getSession returns the real, current v2 document for one specific session, and null for an unknown or invalid id — never throws", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const session = await createSession(homeDir, projectRoot, { title: "Real one" });
  assert.deepEqual(await getSession(homeDir, projectRoot, session.id), session);
  assert.equal(await getSession(homeDir, projectRoot, "aaaaaaaa-0000-0000-0000-000000000000"), null);
  assert.equal(await getSession(homeDir, projectRoot, "../../etc"), null);
});

test("REGRESSION: updateSessionMode persists a new WorkMode onto that session's own v2 document, never the legacy project-wide session.json", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const session = await createSession(homeDir, projectRoot, { title: "Real one" });
  const updated = await updateSessionMode(homeDir, projectRoot, session.id, "agent");
  assert.equal(updated.mode, "agent");
  assert.equal(updated.title, "Real one");
  assert.deepEqual(await getSession(homeDir, projectRoot, session.id), updated);
});

test("REGRESSION: updateSessionMode rejects an invalid WorkMode and an unknown session id, instead of silently persisting or creating one", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const session = await createSession(homeDir, projectRoot, {});
  await assert.rejects(() => updateSessionMode(homeDir, projectRoot, session.id, "yolo"), /Unknown work mode/);
  await assert.rejects(
    () => updateSessionMode(homeDir, projectRoot, "aaaaaaaa-0000-0000-0000-000000000000", "plan"),
    /not found/
  );
});

test("resolveSessionRef matches the exact real id", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const session = await createSession(homeDir, projectRoot, {});
  const resolved = await resolveSessionRef(homeDir, projectRoot, session.id);
  assert.equal(resolved.id, session.id);
});

test("resolveSessionRef matches a unique prefix", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const session = await createSession(homeDir, projectRoot, {});
  const resolved = await resolveSessionRef(homeDir, projectRoot, session.id.slice(0, 8));
  assert.equal(resolved.id, session.id);
});

test("REGRESSION: resolveSessionRef throws on an ambiguous prefix instead of silently guessing one of several real matches", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  // Force a shared real prefix by using the deps.randomUUID override.
  let n = 0;
  const deps = { randomUUID: () => (n++ === 0 ? "aaaaaaaa-0000-0000-0000-000000000001" : "aaaaaaaa-0000-0000-0000-000000000002") };
  await createSession(homeDir, projectRoot, {}, deps);
  await createSession(homeDir, projectRoot, {}, deps);
  await assert.rejects(() => resolveSessionRef(homeDir, projectRoot, "aaaaaaaa"), /matches 2 real sessions/);
});

test("resolveSessionRef returns null (never throws) for a real but unknown reference", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  assert.equal(await resolveSessionRef(homeDir, projectRoot, "does-not-exist"), null);
});

test("REGRESSION: migrateLegacySessionIfNeeded imports the old single-session files without deleting or moving the originals", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const root = legacyRoot(homeDir, projectRoot);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "session.json"), JSON.stringify({ schema: "kairo.session/v1", id: "old", mode: "plan", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }));
  await writeFile(join(root, "transcript.json"), JSON.stringify({ schema: "kairo.transcript/v1", entries: [{ role: "user", text: "hi", at: "2026-01-01T00:00:00.000Z" }] }));
  await writeFile(join(root, "ask-history.json"), JSON.stringify({ schema: "kairo.ask-history/v1", entries: [] }));

  const legacyId = await migrateLegacySessionIfNeeded(homeDir, projectRoot);
  assert.equal(legacyId, `legacy-${projectKeyForPath(projectRoot)}`);

  const sessions = await listSessions(homeDir, projectRoot);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, "Previous Kairo session");
  assert.equal(sessions[0].mode, "plan", "the real prior WorkMode must survive the migration");

  const migratedTranscript = JSON.parse(await readFile(join(sessionDirFor(homeDir, projectRoot, legacyId), "transcript.json"), "utf8"));
  assert.equal(migratedTranscript.entries[0].text, "hi");

  // The original files must still exist, untouched — never deleted or moved.
  assert.ok(await readFile(join(root, "session.json"), "utf8"));
  assert.ok(await readFile(join(root, "transcript.json"), "utf8"));
});

test("migrateLegacySessionIfNeeded is a no-op when no legacy files exist", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  assert.equal(await migrateLegacySessionIfNeeded(homeDir, projectRoot), null);
  assert.deepEqual(await listSessions(homeDir, projectRoot), []);
});

test("REGRESSION: an interrupted/junk entry in conversations/ (no real valid session inside it) never permanently blocks the migration retry", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const root = legacyRoot(homeDir, projectRoot);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "transcript.json"), JSON.stringify({ schema: "kairo.transcript/v1", entries: [{ role: "user", text: "real message", at: "2026-01-01T00:00:00.000Z" }] }));
  // Simulate a crashed prior migration attempt or unrelated filesystem
  // noise — a directory under conversations/ with no real session.json.
  await mkdir(join(conversationsDir(homeDir, projectRoot), "some-leftover-junk"), { recursive: true });

  const legacyId = await migrateLegacySessionIfNeeded(homeDir, projectRoot);
  assert.notEqual(legacyId, null, "migration must still run — no real valid session exists yet");
  const sessions = await listSessions(homeDir, projectRoot);
  assert.ok(sessions.some((s) => s.id === legacyId));
});

test("REGRESSION: createSession rejects an invalid WorkMode instead of silently persisting it", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await assert.rejects(() => createSession(homeDir, projectRoot, { mode: "yolo" }), /Unknown work mode/);
});

test("REGRESSION: sessionDirFor refuses a session id that isn't a real UUID or legacy id — never builds a path that could escape conversations/", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  assert.throws(() => sessionDirFor(homeDir, projectRoot, "../../../../../../etc"), /Invalid session id/);
});

test("REGRESSION: listSessions skips a directory whose name isn't a real session id, instead of reading it as one", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const good = await createSession(homeDir, projectRoot, { title: "Good" });
  await mkdir(join(conversationsDir(homeDir, projectRoot), "..evil..name"), { recursive: true });
  const sessions = await listSessions(homeDir, projectRoot);
  assert.deepEqual(sessions.map((s) => s.id), [good.id]);
});

test("REGRESSION: migrateLegacySessionIfNeeded never re-runs once a real session already exists — idempotent, not just harmless to call twice", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await createSession(homeDir, projectRoot, { title: "A fresh real session, no legacy involved" });
  const root = legacyRoot(homeDir, projectRoot);
  await writeFile(join(root, "transcript.json"), JSON.stringify({ schema: "kairo.transcript/v1", entries: [{ role: "user", text: "should never be imported", at: "2026-01-01T00:00:00.000Z" }] }));
  assert.equal(await migrateLegacySessionIfNeeded(homeDir, projectRoot), null);
  const sessions = await listSessions(homeDir, projectRoot);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, "A fresh real session, no legacy involved");
});

test("ensureHostMetadata writes host.json without changing session.json or transcript.json", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const session = await createSession(homeDir, projectRoot, { title: "Keep me" });
  const dir = sessionDirFor(homeDir, projectRoot, session.id);
  const transcriptPath = join(dir, "transcript.json");
  await writeFile(transcriptPath, JSON.stringify({ schema: "kairo.transcript/v1", entries: [{ role: "user", text: "keep", at: "2026-01-01T00:00:00.000Z" }] }));
  const sessionBytes = await readFile(join(dir, "session.json"));
  const transcriptBytes = await readFile(transcriptPath);

  await ensureHostMetadata(homeDir, projectRoot, session.id);

  assert.deepEqual(await readFile(join(dir, "session.json")), sessionBytes);
  assert.deepEqual(await readFile(transcriptPath), transcriptBytes);
  const host = JSON.parse(await readFile(join(dir, "host.json"), "utf8"));
  assert.equal(host.schema, "kairo.host-binding/v1");
  assert.equal(host.host, "pi");
  assert.equal(host.sessionId, session.id);
});

test("conversationsDir nests cleanly under the existing per-project sessions path, never colliding with project-strategy.json", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const dir = conversationsDir(homeDir, projectRoot);
  assert.equal(dir, join(legacyRoot(homeDir, projectRoot), "conversations"));
});
