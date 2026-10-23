import test from "node:test";
import assert from "node:assert/strict";
import { indexOf } from "../src/index-of.js";

test("finds a middle element", () => {
  assert.equal(indexOf(["a", "b", "c"], "b"), 1);
});

test("finds the last element", () => {
  assert.equal(indexOf(["a", "b", "c"], "c"), 2);
});

test("returns -1 when missing", () => {
  assert.equal(indexOf(["a", "b"], "z"), -1);
});

test("empty haystack does not match undefined past the end", () => {
  assert.equal(indexOf([], undefined), -1);
});

test("non-empty haystack does not match undefined past the end", () => {
  assert.equal(indexOf(["a"], undefined), -1);
});
