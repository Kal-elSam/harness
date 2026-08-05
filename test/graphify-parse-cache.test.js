import test from "node:test";
import assert from "node:assert/strict";
import {
  GRAPHIFY_PARSE_MAX_ENTRIES,
  GRAPHIFY_PARSE_TTL_MS,
  buildGraphifyParseIdentity,
  graphifyParseCacheSizeForTests,
  inspectGraphArtifactCached,
  resetGraphifyParseCacheForTests
} from "../src/global/observability/graphify-parse-cache.js";
import { runGraphifyOp } from "../src/global/observability/graphify-ops.js";

test("graphify parse cache: ok|stale only, identity, TTL, ops bypass", async () => {
  resetGraphifyParseCacheForTests();
  let clock = 1_000;
  let inspectCalls = 0;
  const stats = new Map();
  const stat = (p) => {
    const hit = stats.get(p);
    if (!hit) throw Object.assign(new Error("enoent"), { code: "ENOENT" });
    return hit;
  };
  const realpath = (p) => p;
  const setStat = (p, patch = {}) => {
    stats.set(p, { dev: 1, ino: 10, size: 100, mtimeMs: 50, ...stats.get(p), ...patch });
  };

  const inspect = (path, opts) => {
    inspectCalls += 1;
    if (path === "/missing.json") {
      return { status: "missing", path: null, error: null, diagnostics: ["graph_missing"] };
    }
    if (path === "/bad.json") {
      return { status: "malformed", path: "/bad.json", error: null, diagnostics: ["invalid_json"] };
    }
    if (path === "/err.json") {
      return { status: "error", path: "/err.json", error: "boom", diagnostics: ["read_error"] };
    }
    const status = opts.headSha === "stale-head" ? "stale" : "ok";
    return { status, path, error: null, diagnostics: status === "stale" ? ["stale"] : [] };
  };

  const opts = {
    inspect, now: () => clock, realpath, stat, cwd: "/", ttlMs: GRAPHIFY_PARSE_TTL_MS
  };

  assert.equal(inspectGraphArtifactCached("/missing.json", opts).status, "missing");
  setStat("/bad.json");
  assert.equal(inspectGraphArtifactCached("/bad.json", opts).status, "malformed");
  setStat("/err.json");
  assert.equal(inspectGraphArtifactCached("/err.json", opts).status, "error");
  assert.equal(graphifyParseCacheSizeForTests(), 0);

  resetGraphifyParseCacheForTests();
  inspectCalls = 0;
  setStat("/g.json");
  assert.equal(inspectGraphArtifactCached("/g.json", { ...opts, headSha: "abc" }).status, "ok");
  assert.equal(inspectGraphArtifactCached("/g.json", { ...opts, headSha: "abc" }).status, "ok");
  assert.equal(inspectCalls, 1);

  assert.equal(inspectGraphArtifactCached("/g.json", { ...opts, headSha: "stale-head" }).status, "stale");
  assert.equal(inspectCalls, 2);

  clock += GRAPHIFY_PARSE_TTL_MS + 1;
  inspectGraphArtifactCached("/g.json", { ...opts, headSha: "abc" });
  assert.equal(inspectCalls, 3);

  setStat("/g.json", { mtimeMs: 99 });
  inspectGraphArtifactCached("/g.json", { ...opts, headSha: "abc" });
  assert.equal(inspectCalls, 4);

  assert.match(buildGraphifyParseIdentity("/g.json", "abc", { stat }), /\/g\.json/);

  resetGraphifyParseCacheForTests();
  for (let i = 0; i < GRAPHIFY_PARSE_MAX_ENTRIES + 2; i += 1) {
    const p = `/g-${i}.json`;
    setStat(p, { ino: 100 + i });
    inspectGraphArtifactCached(p, { ...opts, headSha: "h" });
  }
  assert.equal(graphifyParseCacheSizeForTests(), GRAPHIFY_PARSE_MAX_ENTRIES);

  let opInspects = 0;
  await runGraphifyOp({
    op: "query", args: ["q"], graphPath: "/g.json", cwd: "/", workspaceRoot: "/",
    whichCommand: () => "/usr/bin/graphify",
    containPath: () => ({ ok: true, path: "/g.json", root: "/" }),
    inspectGraph: (p, o) => { opInspects += 1; return inspect(p, o); },
    probeCommand: () => ({ ok: true, status: 0, stdout: "ok", timedOut: false }),
    headSha: "abc"
  });
  await runGraphifyOp({
    op: "path", args: ["a", "b"], graphPath: "/g.json", cwd: "/", workspaceRoot: "/",
    whichCommand: () => "/usr/bin/graphify",
    containPath: () => ({ ok: true, path: "/g.json", root: "/" }),
    inspectGraph: (p, o) => { opInspects += 1; return inspect(p, o); },
    probeCommand: () => ({ ok: true, status: 0, stdout: "ok", timedOut: false }),
    headSha: "abc"
  });
  assert.equal(opInspects, 2);
});
