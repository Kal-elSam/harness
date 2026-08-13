"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const {
  emptyControlPlane,
  fetchKairoControlPlane,
  fleetReportFromControlPlane
} = require("../src/control-plane-cache.js");

test("fleetReportFromControlPlane preserves honesty and Cursor agents", () => {
  const fleet = fleetReportFromControlPlane({
    team: {
      platforms: [{
        platform: "cursor",
        honesty: "opaque",
        orchestrator: { id: "auto", model: null, honesty: "opaque", role: "orchestrator" },
        agents: Array.from({ length: 10 }, (_, i) => ({
          id: `sdd-${i}`,
          model: null,
          role: "specialist",
          honesty: "declared"
        }))
      }],
      activity: null,
      fleetNote: "declared",
      orchestratorAuthority: "gentle-ai",
      connections: [{ id: "agent", state: "connected" }]
    }
  });
  assert.equal(fleet.fleets[0].honesty, "opaque");
  assert.equal(fleet.fleets[0].minions.length, 10);
  assert.equal(fleet.orchestratorAuthority, "gentle-ai");
});

test("fetchKairoControlPlane validates schema and empty fallback", async () => {
  const ok = await fetchKairoControlPlane({
    spawnFn() {
      const child = new EventEmitter();
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      stdout.setEncoding = () => {};
      stderr.setEncoding = () => {};
      child.stdout = stdout;
      child.stderr = stderr;
      process.nextTick(() => {
        stdout.emit("data", JSON.stringify({
          schema: "kairo.control-plane/v1",
          ok: true,
          team: { platforms: [] },
          workflow: { kind: "none", active: false },
          attention: { items: [], primaryActions: [], secondaryActions: [] },
          sections: {
            work: { ok: true },
            workflow: { ok: true },
            team: { ok: true },
            attention: { ok: true }
          }
        }));
        process.nextTick(() => child.emit("close", 0));
      });
      return child;
    }
  });
  assert.equal(ok.schema, "kairo.control-plane/v1");

  const bad = await fetchKairoControlPlane({
    spawnFn() {
      const child = new EventEmitter();
      const stdout = new EventEmitter();
      child.stdout = stdout;
      child.stderr = new EventEmitter();
      stdout.setEncoding = () => {};
      child.stderr.setEncoding = () => {};
      process.nextTick(() => {
        stdout.emit("data", JSON.stringify({ schema: "other" }));
        process.nextTick(() => child.emit("close", 0));
      });
      return child;
    }
  });
  assert.equal(bad.error, "invalid_schema");
  assert.equal(emptyControlPlane("x").schema, "kairo.control-plane/v1");
});
