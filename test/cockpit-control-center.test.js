import test from "node:test";
import assert from "node:assert/strict";
import { buildControlCenterModel } from "../src/global/ink/cockpit-control-center.js";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";
import { COCKPIT_NAV } from "../src/global/ink/cockpit-models.js";

test("control center model surfaces health, coverage, and CTA from snapshot", () => {
  const model = buildControlCenterModel({
    projectName: "agentic-harness",
    snapshot: {
      health: CONTROL_PLANE_HEALTH.ACTION_REQUIRED,
      coverage: {
        governedAgents: 1,
        detectedAgents: 3,
        components: 2,
        activeModules: ["orchestrator", "sdd-core"]
      },
      backups: { count: 2 },
      policy: { profile: "safe", applyMode: "prompt" },
      status: { counts: { warning: 1 }, checks: [{ name: "engram", status: "warning", detail: "missing" }] },
      diff: { hasChanges: true, changeCount: 2 },
      cta: {
        kind: "repair",
        title: "Review and repair drift",
        detail: "Preview repairs first.",
        destination: "changes"
      }
    }
  });

  assert.match(model.title, /CONTROL CENTER/);
  assert.equal(model.health.label, "ACTION REQUIRED");
  assert.match(model.health.summaryLine, /1\/3 agents governed/);
  assert.equal(model.cta.destination, "changes");
  assert.ok(model.notes.length >= 1);
  assert.match(model.runsSecondaryHint, /secondary/i);
});

test("governance navigation lists Control center first and Runs last", () => {
  assert.equal(COCKPIT_NAV[0].label, "Control center");
  assert.equal(COCKPIT_NAV[COCKPIT_NAV.length - 1].label, "Runs");
  assert.deepEqual(COCKPIT_NAV.map((item) => item.label), [
    "Control center",
    "IDEs & models",
    "Harness modules",
    "Changes",
    "Activity & recovery",
    "Profile & policy",
    "Runs"
  ]);
});
