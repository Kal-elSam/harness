import test from "node:test";
import assert from "node:assert/strict";
import {
  ENTITLEMENT,
  TEMPORARY_LIMIT,
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
  is_error: true, api_error_status: 429, api_error_code: "rate_limit_error",
  result: "API Error: 429 rate limited", ...extra
});

test("429 without an explicit denial code is a temporary limit: not denied, not allowed", () => {
  const out = classifyClaudeEntitlementResponse(rateLimited());
  assert.notEqual(out.status, ENTITLEMENT.DENIED);
  assert.notEqual(out.status, ENTITLEMENT.ALLOWED);
  assert.equal(out.status, ENTITLEMENT.UNVERIFIED);
  assert.equal(out.limit, TEMPORARY_LIMIT);
  assert.ok(out.retryAfterMs > 0 && out.retryAfterMs < DEFAULT_ENTITLEMENT_TTL_MS);
});

test("429 honors Retry-After (seconds) with a conservative cap", () => {
  assert.equal(classifyClaudeEntitlementResponse(rateLimited({ retry_after: 120 })).retryAfterMs, 120_000);
  const huge = classifyClaudeEntitlementResponse(rateLimited({ retry_after: 99_999_999 }));
  assert.ok(huge.retryAfterMs <= 60 * 60 * 1000);
  const junk = classifyClaudeEntitlementResponse(rateLimited({ retry_after: "soon" }));
  assert.ok(junk.retryAfterMs > 0);
});

test("429 with credits_required stays an explicit denial", () => {
  const out = classifyClaudeEntitlementResponse({
    is_error: true, api_error_status: 429, api_error_code: "credits_required",
    result: "Fable 5.1 requires usage credits."
  });
  assert.equal(out.status, ENTITLEMENT.DENIED);
  assert.equal(out.limit, undefined);
});

test("429 whose message documents a usage-credits denial is denied", () => {
  const out = classifyClaudeEntitlementResponse({
    is_error: true, api_error_status: 429, result: "Model X requires usage credits to continue."
  });
  assert.equal(out.status, ENTITLEMENT.DENIED);
});

test("402 and 403 remain denied", () => {
  for (const status of [402, 403]) {
    const out = classifyClaudeEntitlementResponse({ is_error: true, api_error_status: status, result: "no" });
    assert.equal(out.status, ENTITLEMENT.DENIED, String(status));
  }
});

test("a fresh temporary limit resolves unverified+temporary, never denied or allowed", () => {
  const limited = { modelId: "m1", status: ENTITLEMENT.UNVERIFIED, limit: TEMPORARY_LIMIT, retryAfterMs: 120_000, reason: "slow down", probedAt: iso(NOW - 30_000) };
  const cache = mergeEntitlementResults(null, { subscriptionType: "pro", results: [limited] });
  const view = resolveClaudeEntitlements({ cache, subscriptionType: "pro", catalogIds: ["m1"], now: NOW });
  assert.equal(view.m1.status, ENTITLEMENT.UNVERIFIED);
  assert.equal(view.m1.limit, TEMPORARY_LIMIT);
  assert.equal(view.m1.reason, "slow down");
});

test("a temporary limit expires on its short TTL, long before the 7 day denial TTL", () => {
  const limited = { modelId: "m1", status: ENTITLEMENT.UNVERIFIED, limit: TEMPORARY_LIMIT, retryAfterMs: 120_000, reason: "slow down", probedAt: iso(NOW - 121_000) };
  const cache = mergeEntitlementResults(null, { subscriptionType: "pro", results: [limited] });
  const view = resolveClaudeEntitlements({ cache, subscriptionType: "pro", catalogIds: ["m1"], now: NOW });
  assert.equal(view.m1.status, ENTITLEMENT.UNVERIFIED);
  assert.equal(view.m1.limit, undefined);
  assert.equal(view.m1.reason, null);
});

test("explicit denial keeps the long TTL", () => {
  const denied = { modelId: "m1", status: ENTITLEMENT.DENIED, reason: "requires usage credits", probedAt: iso(NOW - 6 * 24 * 3600_000) };
  const cache = mergeEntitlementResults(null, { subscriptionType: "pro", results: [denied] });
  const view = resolveClaudeEntitlements({ cache, subscriptionType: "pro", catalogIds: ["m1"], now: NOW });
  assert.equal(view.m1.status, ENTITLEMENT.DENIED);
});

test("a temporary limit never overwrites... and a later allowed result replaces it", () => {
  const limited = { modelId: "m1", status: ENTITLEMENT.UNVERIFIED, limit: TEMPORARY_LIMIT, retryAfterMs: 120_000, probedAt: iso(NOW - 10_000) };
  let cache = mergeEntitlementResults(null, { subscriptionType: "pro", results: [limited] });
  cache = mergeEntitlementResults(cache, { subscriptionType: "pro", results: [{ modelId: "m1", status: ENTITLEMENT.ALLOWED, probedAt: iso(NOW - 1000) }] });
  const view = resolveClaudeEntitlements({ cache, subscriptionType: "pro", catalogIds: ["m1"], now: NOW });
  assert.equal(view.m1.status, ENTITLEMENT.ALLOWED);
});
