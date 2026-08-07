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
