import test from 'node:test';
import assert from 'node:assert/strict';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { parseArgs } from '../src/cli.js';
import { PROVIDER_IDS } from '../src/global/provider-connections/allowlist.js';

const provider = (patch = {}) => ({
  providerId: 'codex', installation: { state: 'installed' },
  authentication: { state: 'authenticated' },
  modelAccess: { state: 'unknown', models: [{ modelId: 'gpt-real', state: 'catalogued' }] },
  quota: { state: 'available', remainingPercent: 72 }, ...patch
});

for (const [name, patch, reason] of [
  ['available provider', {}, undefined],
  ['missing CLI', { installation: { state: 'missing' } }, 'not_installed'],
  ['unauthenticated', { authentication: { state: 'unauthenticated' } }, 'not_authenticated'],
  ['no quota data', { quota: { state: 'unknown' } }, 'no_quota_data'],
  ['unknown catalog', { modelAccess: { state: 'unknown' } }, 'catalog_unknown'],
  ['exhausted quota', { quota: { state: 'exhausted', remainingPercent: 0 } }, 'quota_exhausted'],
  ['pool evidence is not a catalog', { modelAccess: { models: [{ modelId: 'cursor_models', scope: 'pool' }] } }, 'catalog_unknown']
]) {
  test(`providers JSON: ${name}`, async () => {
    const { runTeamProvidersCli } = await import('../src/global/team/providers-cli.js');
    const lines = [];
    const result = await runTeamProvidersCli({ json: true, cwd: '/project' }, {
      teamProviders: ['codex'],
      status: async input => {
        assert.deepEqual(input.providerIds, [...PROVIDER_IDS]);
        return { providers: [provider(patch)] };
      }, log: line => lines.push(line)
    });
    const row = JSON.parse(lines[0]).providers[0];
    assert.deepEqual(result, { providers: [row] });
    assert.equal(row.providerId, 'codex');
    assert.equal(row.installed, patch.installation ? false : true);
    assert.equal(row.authenticated, patch.authentication ? false : true);
    assert.deepEqual(row.models, reason === 'catalog_unknown' ? 'unknown' : ['gpt-real']);
    assert.equal(row.remainingPercent, reason === 'no_quota_data' ? 'unknown' : (patch.quota?.remainingPercent ?? 72));
    assert.equal(row.available, reason === undefined);
    assert.equal(row.reason, reason);
  });
}

test('providers dispatch and text: one line per provider, no project strategy needed', async () => {
  const lines = [];
  await runTeamCli({ teamAction: 'providers', cwd: '/not-a-project' }, {
    teamProviders: ['codex', 'opencode-go'],
    status: async () => ({ providers: [provider(), provider({ providerId: 'opencode-go', modelAccess: {} })] }),
    log: line => lines.push(line)
  });
  assert.equal(lines.join('\n').split('\n').length, 2);
  assert.match(lines[0], /codex.*installed=true.*authenticated=true.*models=gpt-real.*quota=72%.*available=true/);
  assert.match(lines.join('\n'), /opencode-go.*models=unknown.*available=false.*catalog_unknown/);
});

test('providers parser accepts JSON and cwd; route parser stays unchanged', () => {
  assert.deepEqual(parseArgs(['team', 'providers', '--json', '--cwd', '/project']).options.teamAction, 'providers');
  const route = parseArgs(['team', 'route', '--role', 'builder', '--json']);
  assert.equal(route.options.role, 'builder');
  assert.equal(route.options.json, true);
});
