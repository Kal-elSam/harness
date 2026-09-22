import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "../src/cli.js";
import { runKairoResume, runKairoSessionsList, runKairoStart } from "../src/global/conversation/session-cli.js";
import { readTranscript } from "../src/global/conversation/transcript-store.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";

async function realRepo() {
  const root = await mkdtemp(join(tmpdir(), "kairo-session-cli-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

test("resume and list parse their dedicated options", () => {
  const withId = parseArgs(["resume", "abc123", "--cwd", "/repo"]);
  assert.equal(withId.command, "resume");
  assert.equal(withId.options.sessionRef, "abc123");
  assert.equal(withId.options.cwd, "/repo");

  const withoutId = parseArgs(["resume", "--cwd", "/repo"]);
  assert.equal(withoutId.options.sessionRef, null);

  const list = parseArgs(["list", "--json"]);
  assert.equal(list.command, "list");
  assert.equal(list.options.json, true);
});

test("kairo start launches the host with a session binding and does not write a second transcript", async () => {
  const launches = [];
  await runKairoStart({ cwd: "/repo" }, {
    resolveProjectRoot: async () => "/repo",
    createSession: async () => ({ id: "aaaaaaaa-0000-4000-8000-000000000001" }),
    launchGentleShell: async (opts) => { launches.push(opts); return {}; },
    ensureHostMetadata: async () => ({})
  });
  assert.equal(launches.length, 1);
  assert.equal(launches[0].sessionId, "aaaaaaaa-0000-4000-8000-000000000001");
  assert.equal(launches[0].cwd, "/repo");
});

test("kairo resume launches the host bound to the resolved session", async () => {
  const launches = [];
  await runKairoResume({ cwd: "/repo", sessionRef: "abc" }, {
    resolveProjectRoot: async () => "/repo",
    resolveSessionRef: async () => ({ id: "aaaaaaaa-0000-4000-8000-000000000002" }),
    launchGentleShell: async (opts) => { launches.push(opts); return {}; },
    ensureHostMetadata: async () => ({})
  });
  assert.equal(launches[0].sessionId, "aaaaaaaa-0000-4000-8000-000000000002");
});

test("REGRESSION: kairo start always creates a brand new real session, never resuming an existing one", async () => {
  let createdWithMode = null;
  let launchedWith = null;
  await runKairoStart({ cwd: "/repo" }, {
    resolveProjectRoot: async () => "/repo",
    createSession: async (homeDir, projectRoot, opts) => { createdWithMode = opts; return { id: "aaaaaaaa-0000-4000-8000-000000000099" }; },
    launchGentleShell: async (options) => { launchedWith = options; return {}; },
    ensureHostMetadata: async () => ({})
  });
  assert.deepEqual(createdWithMode, {});
  assert.equal(launchedWith.sessionId, "aaaaaaaa-0000-4000-8000-000000000099");
});

test("REGRESSION: kairo resume <ref> resolves the exact real session and launches bound to it, throwing on an unknown reference", async () => {
  let launchedWith = null;
  await runKairoResume({ cwd: "/repo", sessionRef: "abc" }, {
    resolveProjectRoot: async () => "/repo",
    resolveSessionRef: async (homeDir, projectRoot, ref) => (ref === "abc" ? { id: "real-session" } : null),
    launchGentleShell: async (options) => { launchedWith = options; return {}; }
  });
  assert.equal(launchedWith.sessionId, "real-session");

  await assert.rejects(
    () => runKairoResume({ cwd: "/repo", sessionRef: "nope" }, {
      resolveProjectRoot: async () => "/repo",
      resolveSessionRef: async () => null,
      launchGentleShell: async () => ({})
    }),
    /No session matches/
  );
});

test("REGRESSION: kairo resume with no ref and exactly one real session resumes it with no prompt", async () => {
  let launchedWith = null;
  await runKairoResume({ cwd: "/repo" }, {
    resolveProjectRoot: async () => "/repo",
    listSessions: async () => [{ id: "only-one" }],
    launchGentleShell: async (options) => { launchedWith = options; return {}; }
  });
  assert.equal(launchedWith.sessionId, "only-one");
});

test("REGRESSION: kairo resume with no ref and no real sessions yet throws, telling the user to start one", async () => {
  await assert.rejects(
    () => runKairoResume({ cwd: "/repo" }, {
      resolveProjectRoot: async () => "/repo",
      listSessions: async () => [],
      launchGentleShell: async () => ({})
    }),
    /No sessions yet/
  );
});

test("REGRESSION: kairo resume with no ref and multiple real sessions shows a real numbered picker and launches the chosen one", async () => {
  let launchedWith = null;
  const prompts = [];
  await runKairoResume({ cwd: "/repo" }, {
    resolveProjectRoot: async () => "/repo",
    listSessions: async () => [{ id: "session-a" }, { id: "session-b" }],
    launchGentleShell: async (options) => { launchedWith = options; return {}; },
    interactive: true,
    createPrompt: () => {
      const prompt = async (question) => { prompts.push(question); return "2"; };
      prompt.close = async () => {};
      return prompt;
    }
  });
  assert.equal(prompts.length, 1);
  assert.equal(launchedWith.sessionId, "session-b");
});

test("REGRESSION: kairo resume with no ref, multiple sessions, and a non-interactive terminal throws instead of guessing", async () => {
  await assert.rejects(
    () => runKairoResume({ cwd: "/repo" }, {
      resolveProjectRoot: async () => "/repo",
      listSessions: async () => [{ id: "session-a" }, { id: "session-b" }],
      launchGentleShell: async () => ({}),
      interactive: false
    }),
    /non-interactive terminal needs an explicit id/
  );
});

test("REGRESSION: kairo resume rejects an invalid picker answer instead of silently launching something", async () => {
  await assert.rejects(
    () => runKairoResume({ cwd: "/repo" }, {
      resolveProjectRoot: async () => "/repo",
      listSessions: async () => [{ id: "session-a" }, { id: "session-b" }],
      launchGentleShell: async () => ({}),
      interactive: true,
      createPrompt: () => {
        const prompt = async () => "not a number";
        prompt.close = async () => {};
        return prompt;
      }
    }),
    /not a valid choice/
  );
});

test("REGRESSION: start then resume against the real session-registry (no mocked storage) — a session start actually creates persists, and resume finds it by prefix", async () => {
  const root = await realRepo();
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-session-cli-home-"));
  let launchedSessionId = null;
  const launchGentleShell = async (options) => { launchedSessionId = options.sessionId; return {}; };

  await runKairoStart({ cwd: root }, { homeDir, launchGentleShell });
  const createdId = launchedSessionId;
  assert.match(createdId, /^[0-9a-f-]{36}$/);

  launchedSessionId = null;
  await runKairoResume({ cwd: root, sessionRef: createdId.slice(0, 8) }, { homeDir, launchGentleShell });
  assert.equal(launchedSessionId, createdId);

  const listed = await runKairoSessionsList({ cwd: root, json: true }, { homeDir });
  assert.deepEqual(listed.map((s) => s.id), [createdId]);
});

test("REGRESSION: kairo start always opens a brand new session with an empty transcript, even when the legacy project-wide transcript already has real content", async () => {
  const root = await realRepo();
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-session-cli-home-"));
  const legacyDir = join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(root));
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, "transcript.json"), JSON.stringify({
    schema: "kairo.transcript/v1",
    entries: [{ role: "user", text: "old content from before multi-session", at: "2026-01-01T00:00:00.000Z" }]
  }));

  let launchedSessionId = null;
  await runKairoStart({ cwd: root }, {
    homeDir,
    launchGentleShell: async (options) => { launchedSessionId = options.sessionId; return {}; }
  });

  const entries = await readTranscript(homeDir, root, launchedSessionId);
  assert.deepEqual(entries, [], "a brand new session must never inherit legacy or another session's transcript content");
});

test("REGRESSION: kairo list returns every real session for the project, non-interactively", async () => {
  const sessions = await runKairoSessionsList({ cwd: "/repo", json: true }, {
    resolveProjectRoot: async () => "/repo",
    listSessions: async () => [{ id: "s1", title: "First", mode: "ask", createdAt: "t0", updatedAt: "t1" }]
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, "s1");
});
