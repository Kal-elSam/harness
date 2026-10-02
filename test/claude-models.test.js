import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readClaudeModels } from "../src/global/observability/claude-models.js";

const NO_CACHE_HOME = join(tmpdir(), "kairo-no-claude-cache-home");

function homeWithCache(files) {
  const home = mkdtempSync(join(tmpdir(), "kairo-claude-cache-"));
  const dir = join(home, ".claude", "cache", "model-catalog");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return { home, dir, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

function cacheDoc(models, overrides = {}) {
  return { version: 2, fetchedAt: Date.parse("2026-10-02T17:34:10Z"), staleAt: Date.parse("2026-10-02T17:58:09Z"),
    catalog: { surface: "cc", config: { id: "cc", models } }, ...overrides };
}

test("returns the documented catalog, explicitly labeled 'documented' (never 'measured')", () => {
  const result = readClaudeModels({ homeDir: NO_CACHE_HOME });
  assert.equal(result.status, "documented");
  assert.ok(result.models.length > 0);
  assert.ok(result.models.every((model) => typeof model.id === "string" && typeof model.displayName === "string"));
  assert.equal(result.error, null);
});

test("documents CLI-verified Opus/Sonnet 5.5 IDs alongside prior generations", () => {
  const ids = readClaudeModels().models.map((model) => model.id);
  assert.ok(ids.includes("claude-opus-5-5"));
  assert.ok(ids.includes("claude-sonnet-5-5"));
  assert.ok(ids.includes("claude-opus-5"));
  assert.ok(ids.includes("claude-sonnet-5"));
  assert.ok(ids.includes("claude-fable-5-1"));
});

test("returns a fresh copy each call, so callers can't mutate the shared catalog", () => {
  const first = readClaudeModels();
  first.models.push({ id: "fake", displayName: "Fake" });
  const second = readClaudeModels();
  assert.equal(second.models.some((model) => model.id === "fake"), false);
});

test("reads Claude Code's own model-catalog cache, adds unknown IDs and labels the result 'cached' with its fetch time", () => {
  const { home, cleanup } = homeWithCache({
    "abc-123-cc.json": cacheDoc([
      { id: "claude-opus-5-5", name: "Opus 5.5", section: "main" },
      { id: "claude-opus-6", name: "Opus 6", section: "main" }
    ])
  });
  try {
    const result = readClaudeModels({ homeDir: home });
    assert.equal(result.status, "cached");
    assert.equal(result.fetchedAt, "2026-10-02T17:34:10.000Z");
    assert.equal(result.error, null);
    const added = result.models.find((model) => model.id === "claude-opus-6");
    assert.deepEqual({ id: added.id, displayName: added.displayName }, { id: "claude-opus-6", displayName: "Claude Opus 6" });
    assert.equal(result.models.filter((model) => model.id === "claude-opus-5-5").length, 1, "no duplicates");
    assert.ok(result.models.some((model) => model.id === "claude-sonnet-4-6"), "documented IDs missing from the cache are kept");
  } finally { cleanup(); }
});

test("falls back to the documented catalog when the cache is missing", () => {
  const result = readClaudeModels({ homeDir: NO_CACHE_HOME });
  assert.equal(result.status, "documented");
  assert.equal(result.error, null);
});

test("falls back to the documented catalog (never throws) for corrupt JSON, another version or a missing models array", () => {
  for (const body of ["{not json", cacheDoc([], { version: 3 }), { version: 2, catalog: {} }, "null", "[]"]) {
    const { home, cleanup } = homeWithCache({ "x-cc.json": body });
    try {
      const result = readClaudeModels({ homeDir: home });
      assert.equal(result.status, "documented", `fallback for ${typeof body === "string" ? body : JSON.stringify(body).slice(0, 40)}`);
      assert.ok(result.models.length > 0);
    } finally { cleanup(); }
  }
});

test("skips malformed entries and non-Claude IDs but keeps the valid ones", () => {
  const { home, cleanup } = homeWithCache({
    "x-cc.json": cacheDoc([
      { id: "gpt-5", name: "GPT" }, { id: 42, name: "Num" }, null, { name: "No id" },
      { id: "claude-bad id", name: "Space" }, { id: "claude-haiku-9", name: "Haiku 9" }
    ])
  });
  try {
    const ids = readClaudeModels({ homeDir: home }).models.map((model) => model.id);
    assert.ok(ids.includes("claude-haiku-9"));
    assert.equal(ids.some((id) => id === "gpt-5" || id === 42 || id === "claude-bad id"), false);
  } finally { cleanup(); }
});

test("only *-cc.json files count, and the newest one wins", () => {
  const { home, dir, cleanup } = homeWithCache({
    "old-cc.json": cacheDoc([{ id: "claude-old-1", name: "Old 1" }]),
    "new-cc.json": cacheDoc([{ id: "claude-new-1", name: "New 1" }]),
    "other.json": cacheDoc([{ id: "claude-ignored-1", name: "Ignored 1" }])
  });
  try {
    utimesSync(join(dir, "old-cc.json"), new Date("2026-10-01"), new Date("2026-10-01"));
    utimesSync(join(dir, "new-cc.json"), new Date("2026-10-02"), new Date("2026-10-02"));
    utimesSync(join(dir, "other.json"), new Date("2026-10-03"), new Date("2026-10-03"));
    const ids = readClaudeModels({ homeDir: home }).models.map((model) => model.id);
    assert.ok(ids.includes("claude-new-1"));
    assert.equal(ids.includes("claude-old-1"), false);
    assert.equal(ids.includes("claude-ignored-1"), false);
  } finally { cleanup(); }
});

test("cached results are also fresh copies", () => {
  const { home, cleanup } = homeWithCache({ "x-cc.json": cacheDoc([{ id: "claude-opus-6", name: "Opus 6" }]) });
  try {
    readClaudeModels({ homeDir: home }).models.push({ id: "fake", displayName: "Fake" });
    assert.equal(readClaudeModels({ homeDir: home }).models.some((model) => model.id === "fake"), false);
  } finally { cleanup(); }
});
