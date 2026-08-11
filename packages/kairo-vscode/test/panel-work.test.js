"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildWorkViewport } = require("../src/panel-work.js");
const { buildPanelModel } = require("../src/panel-model.js");
const { renderWorkViewport } = require("../src/panel-html.js");

const activeNext = {
  schema: "kairo.next/v1",
  ok: true,
  goal: "Ship companion panel",
  progress: ["next JSON ready"],
  now: "Rendering work viewport",
  blockers: ["Visual approval"],
  next: "Reload Window",
  conversationId: "chat-1",
  updatedAt: "2026-08-11T18:00:00.000Z",
  team: { members: [{ title: "Worker A", role: "worker", state: "working" }] },
  integration: { state: "active", showRepair: false, detail: "ok" }
};

test("work viewport stays honest; Repair integration only when broken", () => {
  const empty = buildWorkViewport({
    schema: "kairo.next/v1", ok: true, goal: null, progress: [], now: null, blockers: [], next: null,
    integration: { state: "ready", showRepair: false }
  });
  assert.equal(empty.present, false);
  assert.equal(empty.goal, null);
  assert.equal(empty.team, null);

  const active = buildWorkViewport(activeNext);
  assert.equal(active.present, true);
  assert.equal(active.team.members.length, 1);

  const ready = buildPanelModel(
    { installed: true, overall: "ok", nextAction: "All clear", checks: [] },
    [{ id: "agent", state: "connected" }],
    null,
    {
      schema: "kairo.next/v1", ok: true, goal: null, progress: [], now: null, blockers: [], next: null,
      integration: { state: "ready", showRepair: false }
    }
  );
  assert.ok(!ready.actions.some((a) => a.id === "repair-integration"));

  const broken = buildPanelModel(
    { installed: true, overall: "ok", nextAction: "All clear", checks: [] },
    [{ id: "agent", state: "connected" }],
    null,
    {
      schema: "kairo.next/v1",
      ok: false,
      goal: null,
      progress: [],
      now: null,
      blockers: [],
      next: null,
      integration: { state: "broken", showRepair: true, detail: "Could not read mcp.json" }
    }
  );
  const repair = broken.actions.find((a) => a.id === "repair-integration");
  assert.equal(repair.command, "kairo mcp install --yes");
  assert.equal(broken.work.showRepair, true);

  const unavailable = buildPanelModel(
    { installed: true, overall: "ok", nextAction: "All clear", checks: [] },
    [{ id: "agent", state: "connected" }],
    null,
    { ok: false, error: "timeout" }
  );
  assert.ok(!unavailable.actions.some((a) => a.id === "repair-integration"));
  assert.equal(unavailable.work.showRepair, false);

  const htmlEmpty = renderWorkViewport(empty);
  assert.match(htmlEmpty, /No published work snapshot/);
  assert.doesNotMatch(htmlEmpty, /Waiting for work context|Ship companion/);
  const htmlActive = renderWorkViewport(active);
  assert.match(htmlActive, /Ship companion panel/);
  assert.match(htmlActive, /Team/);
});
