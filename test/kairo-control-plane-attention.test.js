import assert from "node:assert/strict";
import test from "node:test";
import { buildAttention } from "../src/global/control-plane/attention.js";
import {
  GENTLE_DOCTOR_COMMAND,
  GENTLE_UPGRADE_LABEL,
  PROVIDER
} from "../src/global/control-plane/constants.js";

const workOk = {
  integration: { showRepair: false, state: "active" }
};
const teamOk = {
  platforms: [{ platform: "cursor", agents: [{}] }]
};

test("upgrade_required primary is Upgrade Gentle with documented doctor command", () => {
  const attention = buildAttention({
    work: workOk,
    workflow: { kind: "none", active: false, provider: PROVIDER.UPGRADE_REQUIRED },
    team: teamOk,
    connections: []
  });
  assert.equal(attention.primaryActions.length, 1);
  assert.equal(attention.primaryActions[0].label, GENTLE_UPGRADE_LABEL);
  assert.equal(attention.primaryActions[0].command, GENTLE_DOCTOR_COMMAND);
  assert.ok(attention.items.some((i) => i.id === "upgrade-gentle"));
});

test("connected primary uses Gentle execute.command verbatim", () => {
  const command = "gentle-ai review start --contract=gentle-ai.review-integration/v2 --consent=relay";
  const attention = buildAttention({
    work: workOk,
    workflow: {
      kind: "review",
      active: true,
      provider: PROVIDER.CONNECTED,
      nextTransition: {
        kind: "execute",
        execute: { operation: "review.start", command }
      }
    },
    team: teamOk,
    connections: []
  });
  assert.equal(attention.primaryActions[0].command, command);
  assert.equal(attention.primaryActions[0].label, "review.start");
  assert.ok(attention.primaryActions.length <= 2);
});

test("MCP repair does not outrank Gentle next transition", () => {
  const command = "gentle-ai review start --contract=v2";
  const attention = buildAttention({
    work: { integration: { showRepair: true, state: "broken", detail: "repair" } },
    workflow: {
      kind: "review",
      active: true,
      provider: PROVIDER.CONNECTED,
      nextTransition: { execute: { operation: "review.start", command } }
    },
    team: teamOk,
    connections: []
  });
  assert.equal(attention.primaryActions[0].command, command);
  assert.equal(attention.primaryActions[1].id, "repair");
  assert.equal(attention.primaryActions.length, 2);
});
