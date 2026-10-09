import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectExecutionAdapters,
  resolveExecutionAdapter
} from "../src/global/runtime/execution-adapters/index.js";

test("public adapter contract exposes reviewCompatible only for Codex and Pi", () => {
  assert.equal(resolveExecutionAdapter("codex").capabilities.reviewCompatible, true);
  assert.equal(resolveExecutionAdapter("pi").capabilities.reviewCompatible, true);
  assert.equal(resolveExecutionAdapter("cursor").capabilities.reviewCompatible, false);
  assert.equal(resolveExecutionAdapter("claude").capabilities.reviewCompatible, false);
  assert.equal(resolveExecutionAdapter("opencode").capabilities.reviewCompatible, false);

  const inspected = inspectExecutionAdapters();
  const byId = Object.fromEntries(inspected.map((entry) => [entry.id, entry]));
  assert.equal(byId.codex.reviewCompatible, true);
  assert.equal(byId.pi.reviewCompatible, true);
  assert.equal(byId.cursor.reviewCompatible, false);
  assert.equal(byId.claude.reviewCompatible, false);
  assert.equal(byId.opencode.reviewCompatible, false);
});
