import test from "node:test";
import assert from "node:assert/strict";
import { computeTotal } from "../src/compute-total.js";

test("sums item values", () => {
  assert.equal(computeTotal([{ value: 2 }, { value: 3 }]), 5);
});

test("empty array returns 0", () => {
  assert.equal(computeTotal([]), 0);
});
