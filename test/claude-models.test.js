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

test("returns a fresh copy each call, so callers can't mutate the shared catalog", () => {
  const first = readClaudeModels();
  first.models.push({ id: "fake", displayName: "Fake" });
  const second = readClaudeModels();
  assert.equal(second.models.some((model) => model.id === "fake"), false);
});
