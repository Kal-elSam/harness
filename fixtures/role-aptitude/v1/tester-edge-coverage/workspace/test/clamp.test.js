import test from "node:test";
import assert from "node:assert/strict";
import { clamp } from "../src/clamp.js";

test("returns value inside range", () => {
  assert.equal(clamp(5, 0, 10), 5);
});

// Intentionally missing: below min, above max, and min === max edges.
