import test from "node:test";
import assert from "node:assert/strict";
import {
  ENTITLEMENT,
  classifyClaudeEntitlementResponse
} from "../src/global/observability/claude-model-entitlement.js";
import {
  DEFAULT_ENTITLEMENT_TTL_MS,
  mergeEntitlementResults,
  resolveClaudeEntitlements
} from "../src/global/observability/claude-entitlement-store.js";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

const rateLimited = (extra = {}) => ({
  is_error: true,
  api_error_status: 429,
  api_error_code: "rate_limit_error",
  result: "API Error: 429 rate limited",
  ...extra
});

test("429 without an explicit denial is never DENIED (temporary unverified)", () => {
  const out = classifyClaudeEntitlementResponse(rateLimited());
  assert.notEqual(out.status, ENTITLEMENT.DENIED, "a bare 429 must not become a 7-day denial");
  assert.notEqual(out.status, ENTITLEMENT.ALLOWED);
  assert.equal(out.status, ENTITLEMENT.UNVERIFIED);
  assert.equal(out.limit, "temporary");
  assert.ok(out.retryAfterMs > 0 && out.retryAfterMs < DEFAULT_ENTITLEMENT_TTL_MS);
});

test("a temporary-limit cache entry expires on its short TTL, not the 7-day denial TTL", () => {
  const limited = {
    modelId: "m1",
    status: ENTITLEMENT.UNVERIFIED,
    limit: "temporary",
    retryAfterMs: 120_000,
    reason: "slow down",
    probedAt: iso(NOW - 121_000)
  };
  const cache = mergeEntitlementResults(null, { subscriptionType: "pro", results: [limited] });
  const view = resolveClaudeEntitlements({
    cache,
    subscriptionType: "pro",
    catalogIds: ["m1"],
    now: NOW
  });
  assert.equal(view.m1.status, ENTITLEMENT.UNVERIFIED);
  assert.equal(view.m1.limit, undefined, "short TTL elapsed — temporary marker must be gone");
  assert.equal(view.m1.reason, null);
});
