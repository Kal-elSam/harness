import test from "node:test";
import assert from "node:assert/strict";
import {
  loadSystemResources, parseProcessTable, PROCESS_ALLOWLIST, SYSTEM_RESOURCES_TIMEOUT_MS
} from "../src/global/observability/system-resources.js";
import { buildCompanionSnapshot } from "../src/global/observability/build-companion-snapshot.js";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";

const NOW = Date.parse("2026-08-06T20:00:00.000Z");
const ok = (stdout) => ({ ok: true, status: 0, stdout, stderr: "", error: null, timedOut: false });
function fail(kind) {
  if (kind === "timeout") return { ok: false, status: null, stdout: "", stderr: "", error: "ETIMEDOUT", timedOut: true };
  if (kind === "permission") {
    return { ok: false, status: 1, stdout: "", stderr: "Operation not permitted", error: "spawn EACCES", timedOut: false };
  }
  return { ok: false, status: null, stdout: "", stderr: "", error: "spawn ENOENT", timedOut: false };
}
function scripted(map) {
  return (cmd, args = []) => {
    const key = `${cmd} ${args.join(" ")}`.trim();
    if (!(key in map)) throw new Error(`unexpected probe ${key}`);
    return map[key];
  };
}
const FULL = {
  "/usr/sbin/sysctl -n hw.memsize": ok("17179869184"),
  "/usr/bin/pagesize": ok("16384"),
  "/usr/bin/vm_stat": ok("Pages free: 1000.\nPages speculative: 100.\n"),
  "/usr/sbin/sysctl -n vm.swapusage": ok("total = 3072.00M  used = 1941.56M  free = 1130.44M  (encrypted)"),
  "/bin/df -k /System/Volumes/Data": ok("Filesystem 1024-blocks Used Available Capacity\n/dev/disk3s5 100000000 80000000 20000000 80%"),
  "/bin/ps -axc -o pid=,stat=,comm=": ok("1 Ss launchd\n10 Z  zombiehelper\n801 S CursorUIViewService\n802 S Cursor Helper\n1812 S Brave Browser\n1813 S Brave Browser Helper")
};

test("allowlist aggregation scrubs paths/args", () => {
  const out = parseProcessTable("1 Ss /sbin/launchd --evil\n2 S Cursor\n3 Z Cursor Helper\n4 S Codex\n5 S ChatGPT\n6 S Microsoft Teams\n7 S Obsidian\n8 S ollama");
  assert.equal(out.totalCount, 8);
  assert.equal(out.zombieCount, 1);
  assert.deepEqual(out.tracked.map((t) => t.name).sort(), ["chatgpt", "codex", "cursor", "obsidian", "ollama", "teams"]);
  assert.ok(!JSON.stringify(out).includes("/sbin") && !JSON.stringify(out).includes("--evil"));
  assert.equal(PROCESS_ALLOWLIST.length, 7);
});

test("macOS full → available; thermal/ssd unavailable", async () => {
  const out = await loadSystemResources({
    platform: "darwin", nowMs: NOW, timeoutMs: SYSTEM_RESOURCES_TIMEOUT_MS, probeCommand: scripted(FULL)
  });
  assert.equal(out.state, "available");
  assert.equal(out.sampledAt, "2026-08-06T20:00:00.000Z");
  assert.equal(out.memory.totalBytes, 17179869184);
  assert.ok(out.memory.freePercent > 0);
  assert.equal(out.swap.totalBytes, 3072 * 1024 * 1024);
  assert.equal(out.disk.freePercent, 20);
  assert.equal(out.processes.tracked.find((t) => t.name === "cursor").count, 2);
  assert.equal(out.processes.zombieCount, 1);
  assert.equal(out.thermal.state, "unavailable");
  assert.equal(out.ssdWear.state, "unavailable");
});

test("partial / timeout / spawn / opaque / non-macOS", async () => {
  const partial = await loadSystemResources({
    platform: "darwin", nowMs: NOW,
    probeCommand: scripted({ ...FULL, "/usr/sbin/sysctl -n vm.swapusage": fail("permission") })
  });
  assert.equal(partial.state, "partial");
  assert.equal(partial.swap, null);

  const noPage = await loadSystemResources({
    platform: "darwin", nowMs: NOW,
    probeCommand: scripted({ ...FULL, "/usr/bin/pagesize": fail("spawn") })
  });
  assert.equal(noPage.state, "partial");
  assert.equal(noPage.memory, null);

  const timed = await loadSystemResources({
    platform: "darwin", nowMs: NOW, probeCommand: () => fail("timeout")
  });
  assert.equal(timed.state, "error");
  assert.ok(timed.diagnostics.every((d) => /timeout/.test(d)));

  const spawned = await loadSystemResources({
    platform: "darwin", nowMs: NOW, probeCommand: () => fail("spawn")
  });
  assert.equal(spawned.state, "error");

  let calls = 0;
  const unavailable = await loadSystemResources({
    platform: "linux", nowMs: NOW, probeCommand: () => { calls += 1; return ok(""); }
  });
  assert.equal(unavailable.state, "unavailable");
  assert.equal(calls, 0);

  const opaque = await loadSystemResources({
    platform: "darwin", nowMs: NOW,
    probeCommand: () => { throw new Error("boom secret=/tmp/private"); }
  });
  assert.equal(opaque.state, "error");
  assert.ok(!JSON.stringify(opaque).includes("secret") && !JSON.stringify(opaque).includes("/tmp/private"));
});

test("companion carries signals.system.resources; fail-soft on throw", async () => {
  const snap = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.HEALTHY,
    buildObservability: async () => ({ probes: [{ id: "gentle", state: "available", evidence: [] }] }),
    inspectEngram: () => ({ status: "configured", binary: { path: "/e" } }),
    loadSystemResources: async () => ({
      state: "available", sampledAt: "2026-08-06T20:00:00.000Z", diagnostics: [],
      memory: { totalBytes: 16, freePercent: 50 },
      swap: { totalBytes: 1, usedBytes: 0, freeBytes: 1 },
      disk: { totalBytes: 100, freeBytes: 20, freePercent: 20 },
      processes: { totalCount: 1, zombieCount: 0, tracked: [{ name: "cursor", count: 1 }] },
      thermal: { state: "unavailable" }, ssdWear: { state: "unavailable" }
    }),
    runs: [], reviews: [], alerts: []
  });
  assert.equal(snap.signals.system.resources.state, "available");
  assert.equal(snap.nextSafeAction.kind, "missing");
  const threw = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.HEALTHY,
    buildObservability: async () => ({ probes: [] }),
    loadSystemResources: async () => { throw new Error("boom"); },
    runs: [], reviews: [], alerts: []
  });
  assert.equal(threw.signals.system.resources.state, "error");
});
