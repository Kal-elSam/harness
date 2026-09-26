import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  cwdToSessionDirName,
  listPiSessionFilesForCwd
} from "../src/global/host/pi-rpc-sessions.js";

test("cwdToSessionDirName matches Pi session dir encoding", () => {
  const name = cwdToSessionDirName("/work/my-project");
  assert.match(name, /^--work-my-project--$/);
});

test("listPiSessionFilesForCwd returns newest jsonl sessions for cwd", () => {
  const home = mkdtempSync(join(tmpdir(), "kairo-pi-sessions-"));
  const cwd = resolve("/tmp/list-test-repo");
  const agentDir = join(home, ".harness", "pi-agent");
  const sessionDir = join(agentDir, "sessions", cwdToSessionDirName(cwd));
  mkdirSync(sessionDir, { recursive: true });
  const older = join(sessionDir, "1000_old.jsonl");
  const newer = join(sessionDir, "2000_new.jsonl");
  const header = (id, name) =>
    `${JSON.stringify({ type: "session", id, name, cwd })}\n`;
  writeFileSync(older, header("sess-old", "Older"));
  writeFileSync(newer, header("sess-new", "Newer"));
  const env = { HOME: home, PI_CODING_AGENT_DIR: agentDir };
  const list = listPiSessionFilesForCwd({ cwd, env });
  assert.equal(list.length, 2);
  assert.equal(list[0].sessionId, "sess-new");
  assert.equal(list[0].label, "Newer");
  assert.equal(list[1].sessionId, "sess-old");
});
