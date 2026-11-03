import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../src/cli.js';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { createConversationService } from '../src/global/team/service.js';
import { readClaudeEntitlementCache, writeClaudeEntitlementCache } from '../src/global/observability/claude-entitlement-store.js';
import { harnessHomePaths } from '../src/global/paths.js';
import { fixture } from './team-route-fixture.test.js';

const NOW = Date.parse('2026-11-02T12:00:00Z');
async function setup({ failure = false, authFailure = false, providers = ['claude', 'codex'], home: suppliedHome, cwd: suppliedCwd } = {}) {
  const homeDir = suppliedHome ?? await mkdtemp(join(tmpdir(), 'verify-access-'));
  const calls = [];
  const service = createConversationService({ homeDir, now: () => NOW,
    resolveRoot: async cwd => cwd, recoverRuns: async () => {},
    inspectExecutionAdapters: () => ['claude', 'codex'].map(id => ({ id, available: true, launchable: true })),
    readClaudeModels: () => ({ models: [{ id: 'claude-a' }, { id: 'claude-b' }] }),
    verifyClaudeSubscriptionAuth: async () => { calls.push('auth'); if (authFailure) throw new Error('auth status timeout'); return { subscriptionType: 'pro' }; },
    probeClaudeModelEntitlements: async ({ modelIds }) => {
      calls.push('claude');
      return modelIds.map((modelId, i) => ({ modelId, status: failure ? 'unverified' : i ? 'denied' : 'allowed',
        reason: failure ? 'claude entitlement probe timed out' : i ? 'requires usage credits' : null,
        probedAt: new Date(NOW).toISOString() }));
    },
    readCodexModels: async () => { calls.push('codex'); return failure
      ? { status: 'unknown', models: [], error: 'codex app-server timeout' }
      : { status: 'measured', models: [{ id: 'codex-a' }], error: null }; }
  });
  async function run(...args) {
    const { options } = parseArgs(['team', 'verify-access', '--cwd', suppliedCwd ?? homeDir, ...args]);
    const lines = [];
    const before = process.exitCode;
    try {
      process.exitCode = 0;
      const result = await runTeamCli(options, { homeDir, resolveRoot: async cwd => cwd,
        getService: () => service, teamProviders: providers, log: line => lines.push(line) });
      return { result, output: lines.join('\n'), exitCode: process.exitCode };
    } finally { process.exitCode = before; }
  }
  return { homeDir, calls, run };
}

// Refresh must expose account access decisions and persist the evidence routing consumes.
test('verify-access --refresh persists and prints allowed and rejected models', async () => {
  const h = await setup();
  const r = await h.run('--refresh');
  assert.equal(r.exitCode, 0);
  assert.match(r.output, /claude-a.*allowed/);
  assert.match(r.output, /claude-b.*denied.*requires usage credits/);
  assert.match(r.output, /codex-a.*allowed/);
  assert.equal((await readClaudeEntitlementCache(h.homeDir)).models['claude-b'].status, 'denied');
  const saved = JSON.parse(await readFile(harnessHomePaths(h.homeDir).codexModelsLastGoodPath, 'utf8'));
  assert.equal(saved.models[0].id, 'codex-a');
  assert.deepEqual(h.calls, ['auth', 'claude', 'codex']);
  h.calls.length = 0;
  const cached = await h.run();
  assert.equal(cached.exitCode, 0);
  assert.match(cached.output, /codex-a.*allowed.*age/);
  assert.deepEqual(h.calls, []);
  const codexOnly = await setup({ providers: ['codex'] });
  assert.equal((await codexOnly.run('--refresh')).exitCode, 0);
  assert.deepEqual(codexOnly.calls, ['codex']);
});

// Cached display must show age and expiration without running any provider probe.
test('verify-access shows cached age and loudly marks expired evidence', async () => {
  const h = await setup();
  await writeClaudeEntitlementCache(h.homeDir, { subscriptionType: 'pro', fetchedAt: new Date(NOW).toISOString(),
    models: { 'claude-a': { status: 'allowed', probedAt: new Date(NOW - 60_000).toISOString() },
      'claude-b': { status: 'allowed', probedAt: new Date(NOW - 8 * 86400_000).toISOString() } } });
  const before = await readClaudeEntitlementCache(h.homeDir);
  const r = await h.run();
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /cached/);
  assert.match(r.output, /claude-a.*allowed.*age/);
  assert.match(r.output, /claude-b.*unverified.*expired.*refresh/);
  assert.match(r.output, /codex.*(?:missing|no cached)/i);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(await readClaudeEntitlementCache(h.homeDir), before);
});

// Failed probes must identify the provider and reason and cannot return success.
test('verify-access --refresh reports failed probes without silent success', async () => {
  const h = await setup({ failure: true });
  const r = await h.run('--refresh');
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /claude-a.*unverified.*timed out/);
  assert.match(r.output, /codex.*app-server timeout/);
  assert.equal(await readClaudeEntitlementCache(h.homeDir), null);
  await writeClaudeEntitlementCache(h.homeDir, { subscriptionType: 'pro', fetchedAt: new Date(NOW).toISOString(),
    models: { 'claude-a': { status: 'allowed', probedAt: new Date(NOW).toISOString() } } });
  const failedRefresh = await h.run('--refresh');
  assert.equal(failedRefresh.exitCode, 1);
  assert.match(failedRefresh.output, /claude-a.*unverified.*timed out/);
  const auth = await setup({ authFailure: true });
  const authResult = await auth.run('--refresh');
  assert.equal(authResult.exitCode, 1);
  assert.match(authResult.output, /claude.*auth status timeout/);
  assert.deepEqual(auth.calls, ['auth', 'codex']);
});

// Adding access verification must preserve existing cached team route output byte-for-byte.
test('team route output is unchanged by verify-access cached display', async t => {
  const f = await fixture(t);
  await f.cache();
  const before = f.cli('--role', 'Builder');
  const h = await setup({ home: f.home, cwd: f.cwd });
  await h.run();
  const after = f.cli('--role', 'Builder');
  assert.equal(before.status, 0);
  assert.deepEqual([after.status, after.stdout, after.stderr], [before.status, before.stdout, before.stderr]);
});

// S7 blocker: the default 13-model Claude catalog must be fully probed by one refresh.
test('verify-access --refresh verifies every model of a catalog larger than the probe cap', async () => {
  const ids = Array.from({ length: 13 }, (_, i) => `claude-${i}`);
  const homeDir = await mkdtemp(join(tmpdir(), 'verify-access-'));
  const service = createConversationService({ homeDir, now: () => NOW, resolveRoot: async cwd => cwd, recoverRuns: async () => {},
    readClaudeModels: () => ({ models: ids.map(id => ({ id })) }),
    verifyClaudeSubscriptionAuth: async () => ({ subscriptionType: 'pro' }),
    probeClaudeModelEntitlements: async ({ modelIds }) => modelIds.map(modelId => ({ modelId, status: 'allowed', probedAt: new Date(NOW).toISOString() })) });
  const result = await service.verifyTeamAccess({ cwd: homeDir, refresh: true, providerIds: ['claude'] });
  assert.equal(result.ok, true);
  assert.equal(result.providers[0].models.length, 13);
  assert.ok(result.providers[0].models.every(model => model.status === 'allowed'));
});
