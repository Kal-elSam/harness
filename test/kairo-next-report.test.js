import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.js";
import {
  NEXT_SCHEMA,
  INTEGRATION_STATE,
  buildNextReport
} from "../src/global/next/next-report.js";
import { publishWorkSnapshot } from "../src/global/next/publish-work-snapshot.js";

const snap = {
  conversationId: "chat-next-1",
  provider: "cursor",
  goal: "Expose next JSON",
  progress: ["Slice 2 publish"],
  now: "Building next report",
  blockers: ["Panel still pending"],
  next: "Wire panel to kairo next --json",
  delegations: [{
    workId: "kw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    title: "Panel wire",
    role: "worker",
    state: "assigned"
  }]
};

test("parseArgs recognizes next", () => {
  assert.equal(parseArgs(["next", "--json"]).command, "next");
  assert.equal(parseArgs(["next", "--json"]).options.json, true);
});

test("next report selects latest snapshot and maps integration states", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-next-"));
  const cwd = join(homeDir, "ws");
  const cursorDir = join(homeDir, ".cursor");
  try {
    const missing = await buildNextReport({
      homeDir,
      cwd,
      detectAgent: async () => ({ connected: false, state: "not_connected", detail: "missing" })
    });
    assert.equal(missing.schema, NEXT_SCHEMA);
    assert.equal(missing.integration.state, INTEGRATION_STATE.MISSING);
    assert.equal(missing.integration.showRepair, false);
    assert.equal(missing.goal, null);
    assert.equal(missing.team, undefined);

    await mkdir(cursorDir, { recursive: true });
    await writeFile(join(cursorDir, "mcp.json"), JSON.stringify({
      mcpServers: { kairo: { command: "kairo", args: ["mcp"], cwd: "." } }
    }));

    const ready = await buildNextReport({
      homeDir,
      cwd,
      detectAgent: async () => ({ connected: true, state: "connected", detail: "ok" })
    });
    assert.equal(ready.integration.state, INTEGRATION_STATE.READY);
    assert.equal(ready.integration.showRepair, false);

    const legacyBroken = await buildNextReport({
      homeDir,
      cwd,
      detectAgent: async () => ({
        connected: false,
        state: "error",
        detail: "Kairo MCP entry is missing cwd: \".\"."
      })
    });
    assert.equal(legacyBroken.integration.state, INTEGRATION_STATE.BROKEN);
    assert.equal(legacyBroken.integration.showRepair, true);

    await publishWorkSnapshot(snap, {
      homeDir, cwd, now: () => "2026-08-11T12:00:00.000Z"
    });
    await publishWorkSnapshot({
      ...snap,
      conversationId: "chat-next-2",
      goal: "Newer conversation",
      now: "Selected as latest",
      next: "Panel consumes this",
      blockers: [],
      delegations: undefined
    }, { homeDir, cwd, now: () => "2026-08-11T13:00:00.000Z" });

    const active = await buildNextReport({
      homeDir,
      cwd,
      detectAgent: async () => ({ connected: true, state: "connected", detail: "ok" })
    });
    assert.equal(active.integration.state, INTEGRATION_STATE.ACTIVE);
    assert.equal(active.goal, "Newer conversation");
    assert.equal(active.conversationId, "chat-next-2");
    assert.equal(active.team, undefined);
    assert.equal(active.integration.enrolled, true);
    assert.equal(active.integration.showRepair, false);

    const withTeam = await buildNextReport({
      homeDir,
      cwd,
      detectAgent: async () => ({ connected: true, state: "connected", detail: "ok" }),
      listSnapshots: async () => [{
        schema: "kairo.work-snapshot/v1",
        ...snap,
        updatedAt: "2026-08-11T14:00:00.000Z"
      }]
    });
    assert.equal(withTeam.team.members[0].title, "Panel wire");

    const prefersComplete = await buildNextReport({
      homeDir,
      cwd,
      detectAgent: async () => ({ connected: true, state: "connected", detail: "ok" }),
      listSnapshots: async () => [
        {
          schema: "kairo.work-snapshot/v1",
          conversationId: "incomplete-new",
          goal: "Incomplete newer",
          progress: [],
          now: null,
          blockers: [],
          next: null,
          updatedAt: "2026-08-11T15:00:00.000Z"
        },
        {
          schema: "kairo.work-snapshot/v1",
          conversationId: "complete-old",
          goal: "Complete older",
          progress: ["done"],
          now: "still valid",
          blockers: [],
          next: "keep",
          updatedAt: "2026-08-11T10:00:00.000Z"
        }
      ]
    });
    assert.equal(prefersComplete.goal, "Complete older");
    assert.equal(prefersComplete.conversationId, "complete-old");
    assert.equal(prefersComplete.integration.state, INTEGRATION_STATE.ACTIVE);

    const broken = await buildNextReport({
      homeDir,
      cwd,
      detectAgent: async () => ({
        connected: false, state: "error", detail: "Could not read mcp.json"
      })
    });
    assert.equal(broken.ok, false);
    assert.equal(broken.integration.state, INTEGRATION_STATE.BROKEN);
    assert.equal(broken.integration.showRepair, true);
    assert.deepEqual(broken.diagnostics, ["integration_broken"]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("next never invents snapshot fields when absent", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-next-empty-"));
  try {
    const report = await buildNextReport({
      homeDir,
      cwd: join(homeDir, "ws"),
      detectAgent: async () => ({ connected: true, state: "connected" }),
      listSnapshots: async () => []
    });
    assert.equal(report.goal, null);
    assert.equal(report.now, null);
    assert.equal(report.next, null);
    assert.deepEqual(report.progress, []);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.team, undefined);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
