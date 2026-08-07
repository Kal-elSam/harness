import test from "node:test";
import assert from "node:assert/strict";
import {
  diskFreeTone,
  formatSystemResourcesLines
} from "../src/global/ink/system-resources-display.js";
import { buildControlCenterModel } from "../src/global/ink/cockpit-control-center.js";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";

test("diskFreeTone thresholds and opaque missing", () => {
  assert.equal(diskFreeTone(null), null);
  assert.equal(diskFreeTone(9.9), "critical");
  assert.equal(diskFreeTone(10), "warning");
  assert.equal(diskFreeTone(19.9), "warning");
  assert.equal(diskFreeTone(20), "healthy");
});

test("system resource lines never invent metrics and vary by layout", () => {
  assert.deepEqual(formatSystemResourcesLines(null), ["System · unavailable"]);
  assert.deepEqual(formatSystemResourcesLines({ state: "error" }), ["System · error"]);

  const sample = {
    state: "available",
    memory: { totalBytes: 16e9, freePercent: 12 },
    swap: { totalBytes: 2e9, usedBytes: 1.98 * 1024 ** 3, freeBytes: 0.02 * 1024 ** 3 },
    disk: { totalBytes: 228e9, freeBytes: 11e9, freePercent: 11 },
    processes: {
      totalCount: 480,
      zombieCount: 2,
      tracked: [{ name: "cursor", count: 3 }, { name: "obsidian", count: 1 }]
    },
    thermal: { state: "unavailable" },
    ssdWear: { state: "unavailable" }
  };

  const minimal = formatSystemResourcesLines(sample, LAYOUT_MODES.MINIMAL);
  assert.equal(minimal.length, 1);
  assert.match(minimal[0], /System · RAM 12% free · Swap 2G used · Disk 11% free · warning/);

  const compact = formatSystemResourcesLines(sample, LAYOUT_MODES.COMPACT);
  assert.ok(compact.some((line) => /Memory pressure/.test(line)));
  assert.ok(compact.some((line) => line === "  · Processes 480 · zombies 2"));
  assert.ok(!compact.some((line) => /Thermal|cursor/.test(line)));

  const wide = formatSystemResourcesLines(sample, LAYOUT_MODES.WIDE);
  assert.ok(wide.some((line) => line === "  · cursor ×3"));
  assert.ok(wide.some((line) => line === "  · Thermal · unavailable"));
  assert.doesNotMatch(wide.join("\n"), /\/Users|pid=|args/i);
});

test("control center overlay includes System display-only lines", () => {
  const companion = {
    ok: true,
    signals: {
      gentle: { state: "available" },
      graphify: { state: "available", graphStatus: "fresh" },
      hermes: { activity: { state: "unavailable", sessions: [], aggregates: {} } },
      system: {
        resources: {
          state: "partial",
          memory: { freePercent: 40 },
          swap: null,
          disk: { freePercent: 8 },
          processes: { totalCount: 10, zombieCount: 0, tracked: [] },
          thermal: { state: "unavailable" },
          ssdWear: { state: "unavailable" }
        }
      }
    },
    engram: { status: "ready" },
    links: []
  };
  const model = buildControlCenterModel({
    projectName: "p",
    layoutMode: LAYOUT_MODES.COMPACT,
    snapshot: { health: CONTROL_PLANE_HEALTH.HEALTHY, coverage: {}, diff: { hasChanges: false } },
    companion
  });
  assert.ok(model.companion.lines.some((line) => /System · RAM 40% free · Swap n\/a · Disk 8% free · critical/.test(line)));
});
