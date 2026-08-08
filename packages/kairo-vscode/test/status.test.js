"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const {
  StatusCache,
  buildTreeModel,
  fetchKairoStatus,
  mapStatusBar
} = require("../src/status.js");
const { buildPanelModel } = require("../src/panel-model.js");

test("mapStatusBar covers missing, ready, and drift", () => {
  assert.equal(mapStatusBar({ installed: false }).text, "Kairo: not installed");
  assert.equal(mapStatusBar({ installed: true, overall: "ok" }).text, "Kairo: ready");
  assert.equal(
    mapStatusBar({ installed: true, overall: "drift", nextAction: "sync" }).text,
    "Kairo: needs attention"
  );
});

test("buildTreeModel drops ok checks", () => {
  const model = buildTreeModel({
    installed: true,
    overall: "drift",
    nextAction: "sync",
    checks: [
      { name: "ok", status: "ok", category: "state" },
      { name: "gap", status: "missing", category: "managed_section", detail: "gone" }
    ]
  });
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].items[0].detail, "gone");
});

test("buildPanelModel exposes clickable Repair when drift", () => {
  const model = buildPanelModel({
    installed: true,
    overall: "drift",
    nextAction: "Repair 7 changes",
    cliVersion: "0.14.0",
    checks: [
      { name: "orchestrator.md", status: "drift", category: "managed", detail: "repair" },
      { name: "ok", status: "ok", category: "state" }
    ]
  }, [{ id: "agent", state: "not_connected" }]);
  assert.equal(model.headline, "Needs attention");
  assert.ok(model.actions.some((a) => a.id === "setup"));
  assert.equal(model.actions.find((a) => a.id === "repair").command, "kairo sync");
  assert.ok(model.actions.some((a) => a.id === "connect-agent"));
  assert.ok(model.entries.some((e) => e.title === "Repair 7 changes"));
  assert.ok(model.entries.some((e) => e.title === "orchestrator.md"));
  assert.equal(model.connections[0].id, "agent");
});

test("buildPanelModel ready state leads with Setup", () => {
  const model = buildPanelModel({
    installed: true,
    overall: "ok",
    nextAction: "All clear",
    checks: []
  }, [{ id: "agent", state: "not_connected" }]);
  assert.equal(model.headline, "Ready");
  assert.equal(model.actions.find((a) => a.primary)?.id, "fleet-configure");
  assert.ok(model.actions.some((a) => a.id === "setup"));
  assert.ok(model.actions.some((a) => a.id === "connect-agent"));
  assert.ok(model.actions.some((a) => a.id === "fleet" && a.command === "kairo fleet"));
  assert.ok(model.actions.some((a) => a.id === "fleet-configure" && /fleet configure/.test(a.command)));
  assert.ok(model.actions.some((a) => a.id === "fleet-models" && /fleet models/.test(a.command)));
});

test("buildPanelModel hides Connect Agent when MCP connected", () => {
  const model = buildPanelModel({
    installed: true,
    overall: "ok",
    nextAction: "All clear",
    checks: []
  }, [{ id: "agent", state: "connected" }]);
  assert.ok(model.actions.some((a) => a.id === "setup"));
  assert.ok(!model.actions.some((a) => a.id === "connect-agent"));
  assert.ok(model.actions.some((a) => a.id === "doctor"));
});

test("buildPanelModel softens not-detected warnings to note", () => {
  const model = buildPanelModel({
    installed: true,
    overall: "ok",
    nextAction: "All clear",
    checks: [
      { name: "agent:pi", status: "warning", detail: "Not detected on this machine." },
      { name: "engram:agent:pi", status: "warning", detail: "pi → pi: unconfigured (config evidence only; not runtime-active)." },
      { name: "sdd-core:skills", status: "warning", detail: "SDD skills conflict: configured=27, conflict=9" }
    ]
  }, [{ id: "agent", state: "connected" }]);
  assert.equal(model.entries.find((e) => e.title === "agent:pi").status, "note");
  assert.equal(model.entries.find((e) => e.title === "engram:agent:pi").status, "note");
  assert.equal(model.entries.find((e) => e.title === "sdd-core:skills").status, "conflict");
  assert.equal(model.entries[0].title, "sdd-core:skills");
  assert.ok(model.entries[0].actions.some((a) => a.id === "configure-sdd"));
  assert.ok(model.actions.some((a) => a.id === "configure-sdd"));
  assert.ok(model.entries.find((e) => e.title === "agent:pi").actions.some((a) => a.id === "guide-optional"));
});

test("buildPanelModel renders fleet tree nodes from connections report", () => {
  const model = buildPanelModel({
    installed: true,
    overall: "ok",
    nextAction: "All clear",
    checks: []
  }, [{ id: "agent", state: "connected" }], {
    fleets: [
      {
        platform: "opencode",
        writable: true,
        orchestrator: {
          id: "gentle-orchestrator",
          model: "opencode-go/deepseek-v4-pro",
          modelShort: "deepseek-v4-pro",
          opaque: false
        },
        minions: [
          { id: "sdd-apply", model: "opencode-go/deepseek-v4-pro", modelShort: "deepseek-v4-pro", role: "executor" }
        ]
      },
      {
        platform: "cursor",
        writable: false,
        orchestrator: { id: "auto", model: null, opaque: true },
        minions: [],
        note: "IDE-managed"
      }
    ],
    activity: {
      available: true,
      activeCount: 1,
      note: "live",
      agents: [
        {
          id: "sdd-apply",
          state: "active",
          model: "opencode-go/deepseek-v4-pro",
          modelShort: "deepseek-v4-pro",
          sessionId: "ses_1",
          parentId: "ses_0",
          title: "Apply work"
        }
      ]
    },
    fleetNote: "Declared config, not live tokens.",
    orchestratorAuthority: "gentle-ai"
  });

  assert.equal(model.orchestratorAuthority, "gentle-ai");
  assert.ok(model.fleetNodes.some((n) => n.kind === "desk" && /OpenCode/.test(n.title)));
  assert.ok(model.fleetNodes.some((n) => n.platform === "opencode" && n.minionCount >= 1));
  assert.ok(model.fleetNodes.some((n) => n.actions?.some((a) => /fleet set|fleet configure/.test(a.command))));
  const cursor = model.fleetNodes.find((n) => n.platform === "cursor");
  assert.ok(cursor?.opaque);
  assert.ok(cursor.actions.some((a) => a.id === "configure-all"));
  assert.ok(cursor.actions.some((a) => a.id === "fleet-models"));
  assert.ok(cursor.actions.some((a) => a.id === "open-cursor-agents"));
  assert.ok(cursor.actions.some((a) => a.id === "pixel-agents"));
  assert.match(cursor.title, /opaque/i);
  assert.equal(model.activityActiveCount, 1);
  assert.equal(model.showActivityFloor, true);
  assert.ok(model.activityNodes.some((n) => n.state === "active" && /sdd-apply/.test(n.title)));
  assert.match(model.fleetNote, /declared/i);
});

test("buildPanelModel prefers check.resolutions over heuristics", () => {
  const model = buildPanelModel({
    installed: true,
    overall: "ok",
    nextAction: "All clear",
    checks: [{
      name: "sdd-core:skills",
      status: "warning",
      detail: "SDD skills conflict: conflict=9",
      resolutions: [
        { id: "sdd-diff", label: "Ver diff", command: "kairo components diff sdd-core", kind: "run", safety: "read-only" },
        { id: "sdd-adopt", label: "Conservar el mío", command: "kairo components adopt sdd-core --yes", kind: "configure", safety: "consent" },
        { id: "sdd-overwrite", label: "Usar versión Kairo", command: "kairo components configure sdd-core --overwrite-conflicts --yes", kind: "configure", safety: "destructive" }
      ]
    }]
  }, [{ id: "agent", state: "connected" }]);
  const entry = model.entries.find((e) => e.title === "sdd-core:skills");
  assert.ok(entry.actions.some((a) => a.id === "sdd-adopt"));
  assert.ok(entry.actions.some((a) => a.id === "sdd-overwrite" && a.safety === "destructive"));
  assert.ok(!entry.actions.some((a) => a.id === "configure-sdd"));
  assert.equal(model.actions.find((a) => a.primary)?.id, "sdd-adopt");
});

test("fetchKairoStatus passes workspace cwd to spawn", async () => {
  let seenCwd = null;
  await fetchKairoStatus({
    cwd: "/tmp/workspace-root",
    spawnFn(_cmd, _args, opts) {
      seenCwd = opts.cwd;
      const child = new EventEmitter();
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      stdout.setEncoding = () => {};
      stderr.setEncoding = () => {};
      child.stdout = stdout;
      child.stderr = stderr;
      process.nextTick(() => {
        stdout.emit("data", JSON.stringify({ overall: "ok", nextAction: "ok", checks: [] }));
        process.nextTick(() => child.emit("close", 0));
      });
      return child;
    }
  });
  assert.equal(seenCwd, "/tmp/workspace-root");
});

test("fetchKairoStatus parses JSON and reports ENOENT", async () => {
  const ok = await fetchKairoStatus({
    spawnFn() {
      const child = new EventEmitter();
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      stdout.setEncoding = () => {};
      stderr.setEncoding = () => {};
      child.stdout = stdout;
      child.stderr = stderr;
      process.nextTick(() => {
        stdout.emit("data", JSON.stringify({ overall: "drift", nextAction: "sync", checks: [] }));
        process.nextTick(() => child.emit("close", 0));
      });
      return child;
    }
  });
  assert.equal(ok.overall, "drift");

  const missing = await fetchKairoStatus({
    spawnFn() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdout.setEncoding = () => {};
      child.stderr.setEncoding = () => {};
      process.nextTick(() => {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        child.emit("error", err);
      });
      return child;
    }
  });
  assert.equal(missing.installed, false);

  let calls = 0;
  const cache = new StatusCache({
    ttlMs: 60_000,
    fetch: async () => {
      calls += 1;
      return { installed: true, overall: "ok", nextAction: "ok", checks: [] };
    }
  });
  await cache.get();
  await cache.get();
  assert.equal(calls, 1);
});

test("fetchKairoConnections keeps fleets and activity from JSON", async () => {
  const { fetchKairoConnections } = require("../src/connections-cache.js");
  const report = await fetchKairoConnections({
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
          ok: true,
          connections: [{ id: "gentle", state: "available" }],
          fleets: [{ platform: "opencode", orchestrator: { id: "gentle-orchestrator" }, minions: [] }],
          activity: { available: true, activeCount: 1, agents: [] },
          orchestratorAuthority: "gentle-ai"
        }));
        process.nextTick(() => child.emit("close", 0));
      });
      return child;
    }
  });
  assert.equal(report.fleets.length, 1);
  assert.equal(report.activity.activeCount, 1);
  assert.equal(report.orchestratorAuthority, "gentle-ai");
});
