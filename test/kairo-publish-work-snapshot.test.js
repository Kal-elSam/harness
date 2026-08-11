import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolHandlers } from "../src/global/mcp/kairo-mcp.js";
import { publishWorkSnapshot } from "../src/global/next/publish-work-snapshot.js";
import { enrollConversation, loadEnrollment } from "../src/global/next/work-enroll.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";
import {
  IGNORED_SMOKE_CONVERSATION_IDS,
  listWorkSnapshots,
  loadWorkSnapshot,
  selectLatestWorkSnapshot
} from "../src/global/next/work-snapshot.js";
import { harnessHomePaths } from "../src/global/paths.js";

const base = {
  conversationId: "chat-real-1",
  provider: "cursor",
  goal: "Ship companion publish",
  progress: ["Slice 1 store"],
  now: "Publishing snapshot via MCP",
  blockers: ["None"],
  next: "Wire panel selection"
};

test("publish enrolls once, updates same chat, rejects bad payloads", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-pub-"));
  const cwd = join(homeDir, "workspace");
  try {
    const first = await publishWorkSnapshot(base, {
      homeDir, cwd, now: () => "2026-08-11T10:00:00.000Z"
    });
    assert.equal(first.ok && first.code === "enrolled" && first.data.selected, true);

    const second = await publishWorkSnapshot({
      ...base, now: "Still same conversation", next: "Continue"
    }, { homeDir, cwd, now: () => "2026-08-11T11:00:00.000Z" });
    assert.equal(second.code, "updated");
    assert.equal(second.data.created, false);

    const enrollDir = join(
      harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(cwd), "enrollments"
    );
    assert.equal((await readdir(enrollDir)).length, 1);
    assert.equal((await listWorkSnapshots(homeDir, cwd)).length, 1);
    assert.equal((await selectLatestWorkSnapshot(homeDir, cwd)).now, "Still same conversation");

    assert.equal((await publishWorkSnapshot({ ...base, projectKey: "evil" }, { homeDir, cwd })).code,
      "forbidden_identity_fields");
    assert.equal((await publishWorkSnapshot({ ...base, prompt: "secret" }, { homeDir, cwd })).code,
      "private_payload");
    assert.equal((await publishWorkSnapshot({
      conversationId: "x", provider: "cursor", goal: "Only goal"
    }, { homeDir, cwd })).code, "incomplete_snapshot");
    assert.equal((await publishWorkSnapshot({
      ...base, conversationId: IGNORED_SMOKE_CONVERSATION_IDS[0]
    }, { homeDir, cwd })).code, "ignored_conversation");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("workspaces stay isolated; MCP uses runtime cwd; enroll is idempotent", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-pub-iso-"));
  const wsA = join(homeDir, "a");
  const wsB = join(homeDir, "b");
  try {
    await publishWorkSnapshot(base, { homeDir, cwd: wsA });
    await publishWorkSnapshot({ ...base, conversationId: "chat-b", goal: "Other workspace" }, {
      homeDir, cwd: wsB
    });
    assert.equal((await loadWorkSnapshot(homeDir, wsA, "chat-real-1")).goal, base.goal);
    assert.equal(await loadWorkSnapshot(homeDir, wsB, "chat-real-1"), null);
    assert.equal(await loadEnrollment(homeDir, wsB, "chat-real-1"), null);

    const again = await enrollConversation(homeDir, wsA, {
      conversationId: "chat-real-1", provider: "cursor"
    });
    assert.equal(again.created, false);

    const handlers = createToolHandlers({
      homeDir,
      cwd: wsA,
      publishWorkSnapshot: async (input) => publishWorkSnapshot(input, { homeDir, cwd: wsA })
    });
    const res = await handlers.kairo_publish_work_snapshot({
      ...base, conversationId: "mcp-chat", goal: "Via MCP handler"
    });
    assert.equal(res.structuredContent.ok, true);
    assert.equal((await loadWorkSnapshot(homeDir, wsA, "mcp-chat")).goal, "Via MCP handler");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
