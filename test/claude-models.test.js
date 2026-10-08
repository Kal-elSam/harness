import test from "node:test";
import assert from "node:assert/strict";
import { readClaudeModels } from "../src/global/observability/claude-models.js";

test("returns the documented catalog, explicitly labeled 'documented' (never 'measured')", () => {
  const result = readClaudeModels();
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
