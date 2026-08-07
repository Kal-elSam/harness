import test from "node:test";
import assert from "node:assert/strict";
import { recommendSystemResources } from "../src/global/observability/resource-advisor.js";
import { formatResourceAdviceLines } from "../src/global/ink/system-resources-display.js";
import { buildCompanionSnapshot } from "../src/global/observability/build-companion-snapshot.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";

test("advisor is quiet without actionable fields", () => {
  assert.deepEqual(
    recommendSystemResources({ state: "unavailable" }).recommendations,
    []
  );
  assert.deepEqual(
    recommendSystemResources({
      state: "available",
      memory: { freePercent: 40 },
      disk: { freePercent: 50 },
      processes: { totalCount: 1, zombieCount: 0, tracked: [] }
    }).recommendations,
    []
  );
});

test("advisor emits deterministic disk/memory/tracked rules without mutations", () => {
  const out = recommendSystemResources({
    state: "partial",
    memory: { freePercent: 10 },
    disk: { freePercent: 8 },
    processes: {
      totalCount: 100,
      zombieCount: 0,
      tracked: [{ name: "cursor", count: 3 }]
    }
  });
  assert.deepEqual(out.recommendations.map((r) => r.id), [
    "free-disk-critical",
    "quit-heavy-apps",
    "inspect-tracked-apps"
  ]);
  assert.equal(out.deepScan, false);
  assert.ok(out.recommendations.every((r) => !/\b(deletes?|compacts?|kills?)\b/i.test(`${r.title} ${r.detail}`)));
});

test("deep-scan recommendation only when explicitly opted in", () => {
  const shallow = recommendSystemResources({ state: "available", disk: { freePercent: 50 } });
  assert.equal(shallow.recommendations.some((r) => r.id === "deep-scan-known-caches"), false);
  const deep = recommendSystemResources(
    { state: "available", disk: { freePercent: 50 } },
    { deepScan: true }
  );
  assert.equal(deep.deepScan, true);
  assert.ok(deep.recommendations.some((r) => r.id === "deep-scan-known-caches"));
});

test("companion advice defaults to shallow refresh", async () => {
  const snap = await buildCompanionSnapshot({
    ensureRegistered: () => {},
    buildObservability: async () => ({ probes: [] }),
    loadHermesActivity: async () => ({ state: "unavailable", sessions: [], aggregates: {} }),
    loadSystemResources: async () => ({
      state: "available",
      memory: { freePercent: 10 },
      swap: null,
      disk: { freePercent: 8 },
      processes: { totalCount: 1, zombieCount: 0, tracked: [] },
      thermal: { state: "unavailable" },
      ssdWear: { state: "unavailable" }
    })
  });
  assert.equal(snap.signals.system.advice.deepScan, false);
  assert.ok(snap.signals.system.advice.recommendations.some((r) => r.id === "free-disk-critical"));
  assert.ok(!snap.signals.system.advice.recommendations.some((r) => r.id === "deep-scan-known-caches"));
  const lines = formatResourceAdviceLines(snap.signals.system.advice, LAYOUT_MODES.COMPACT);
  assert.match(lines[0], /Advisor · critical · Free disk space/);
});
