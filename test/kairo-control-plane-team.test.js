import assert from "node:assert/strict";
import test from "node:test";
import { HONESTY } from "../src/global/control-plane/constants.js";
import { normalizeTeam } from "../src/global/control-plane/team.js";

test("normalizeTeam tags OpenCode live vs Cursor declared/opaque", () => {
  const team = normalizeTeam({
    fleets: [
      {
        platform: "opencode",
        orchestrator: { id: "gentle-orchestrator", modelShort: "gpt" },
        minions: [{ id: "sdd-spec", role: "specifier", modelShort: "gpt" }],
        opaque: false
      },
      {
        platform: "cursor",
        orchestrator: { id: "auto", opaque: true },
        minions: [{ id: "sdd-apply", role: "executor", opaque: false }],
        opaque: true
      }
    ],
    activity: {
      available: true,
      activeCount: 1,
      agents: [{ id: "sdd-apply", state: "active" }]
    }
  });
  assert.equal(team.platforms[0].honesty, HONESTY.LIVE);
  assert.equal(team.platforms[0].agents[0].honesty, HONESTY.DECLARED);
  assert.equal(team.platforms[1].honesty, HONESTY.OPAQUE);
  assert.equal(team.platforms[1].orchestrator.honesty, HONESTY.OPAQUE);
  assert.equal(team.platforms[1].agents[0].honesty, HONESTY.DECLARED);
  assert.equal(team.platforms[1].agents.length, 1);
});

test("normalizeTeam does not treat idle OpenCode sessions as live", () => {
  const idleOnly = normalizeTeam({
    fleets: [{
      platform: "opencode",
      orchestrator: { id: "gentle-orchestrator" },
      minions: [],
      opaque: false
    }],
    activity: {
      available: true,
      activeCount: 0,
      agents: [{ id: "sdd-apply", state: "idle" }],
      sessions: [{ id: "ses_1", state: "idle" }]
    }
  });
  assert.equal(idleOnly.platforms[0].honesty, HONESTY.DECLARED);
  assert.equal(idleOnly.activity, null);
});

test("normalizeTeam never tags Claude or Codex as live", () => {
  const team = normalizeTeam({
    fleets: [
      { platform: "claude", orchestrator: { id: "default" }, minions: [], opaque: false },
      { platform: "codex", orchestrator: { id: "default" }, minions: [], opaque: false }
    ],
    activity: { available: true, activeCount: 1, agents: [{ state: "active" }] }
  });
  assert.equal(team.platforms[0].honesty, HONESTY.DECLARED);
  assert.equal(team.platforms[1].honesty, HONESTY.DECLARED);
});
