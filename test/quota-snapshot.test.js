import test from 'node:test';
import assert from 'node:assert/strict';
import { QUOTA_CACHE_MAX_AGE_MS, isRoutingQuotaUsable, routingQuotaWindows } from '../src/global/team/quota-snapshot.js';
import { ROUTING_INPUT_CACHE_SCHEMA } from '../src/global/team/routing-input-cache.js';

const now = Date.parse('2026-10-23T12:00:00Z');
const cache = (age, windows = [{ kind: '5h', remainingPercent: 50 }]) => ({ schema: ROUTING_INPUT_CACHE_SCHEMA, generatedAt: now - age, providerCapacity: { codex: { quotaWindows: windows } } });

test('routing quota is usable up to 30 minutes and no longer', () => {
  assert.equal(QUOTA_CACHE_MAX_AGE_MS, 30 * 60_000);
  assert.equal(isRoutingQuotaUsable(cache(10 * 60_000), now), true);
  assert.equal(isRoutingQuotaUsable(cache(40 * 60_000), now), false);
  assert.equal(isRoutingQuotaUsable({ ...cache(0), schema: 'other' }, now), false);
  assert.equal(isRoutingQuotaUsable(cache(-60_000), now), false);
  assert.equal(isRoutingQuotaUsable(null, now), false);
});
test('routingQuotaWindows returns provider windows or null', () => {
  assert.equal(routingQuotaWindows(cache(60_000), 'codex', now)[0].remainingPercent, 50);
  assert.equal(routingQuotaWindows(cache(60_000), 'claude', now), null);
  assert.equal(routingQuotaWindows(cache(60_000, []), 'codex', now), null);
  assert.equal(routingQuotaWindows(cache(40 * 60_000), 'codex', now), null);
});
test('routingQuotaWindows drops windows whose reset already passed', () => {
  const past = { kind: '5h', remainingPercent: 0, resetsAtIso: new Date(now - 60_000).toISOString() };
  const future = { kind: 'week', remainingPercent: 40, resetsAtIso: new Date(now + 3_600_000).toISOString() };
  assert.deepEqual(routingQuotaWindows(cache(5 * 60_000, [past, future]), 'codex', now), [future]);
  assert.equal(routingQuotaWindows(cache(5 * 60_000, [past]), 'codex', now), null);
  const atNow = { ...past, resetsAtIso: new Date(now).toISOString() };
  assert.equal(routingQuotaWindows(cache(5 * 60_000, [atNow]), 'codex', now), null);
});
