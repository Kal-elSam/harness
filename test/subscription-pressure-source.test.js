import test from "node:test";
import assert from "node:assert/strict";
import { buildProviderCapacity } from "../src/global/intelligence/subscription-pressure-source.js";

test("buildProviderCapacity creates one real entry per adapter with a real remaining-percent", () => {
  const capacity = buildProviderCapacity({ claude: 42, codex: 80 });
  assert.deepEqual(capacity.claude, { adapterId: "claude", quotaRemainingPercent: 42 });
  assert.deepEqual(capacity.codex, { adapterId: "codex", quotaRemainingPercent: 80 });
});

test("an adapter with no real remaining-percent gets no entry — never fabricate quota headroom", () => {
  const capacity = buildProviderCapacity({ claude: null, codex: undefined });
  assert.deepEqual(capacity, {});
});

test("an empty or missing input produces an empty map, never throws", () => {
  assert.deepEqual(buildProviderCapacity({}), {});
  assert.deepEqual(buildProviderCapacity(undefined), {});
});

test("capacity is per-adapter, not per-model — two models under the same adapter are never represented separately here", () => {
  // ProviderCapacity has no concept of a model at all: it's keyed only by
  // adapterId, so there is no way to even ask "is model X more
  // quota-efficient than model Y" — that question doesn't apply to a
  // provider-level resource.
  const capacity = buildProviderCapacity({ claude: 55 });
  assert.deepEqual(Object.keys(capacity), ["claude"]);
  assert.equal(capacity.claude.quotaRemainingPercent, 55);
});
