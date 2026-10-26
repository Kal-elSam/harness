import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resolveProjectRoute } from '../src/global/team/project-router.js';
import { readTeamRoute } from '../src/global/team/routing-input-cache.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { fixture, tree } from './team-route-fixture.test.js';
import { resolveActiveHost } from '../src/global/hosts/active-host.js';
import { createToolHandlers } from '../src/global/mcp/kairo-mcp.js';
import { createConversationDelegateHandlers } from '../src/global/mcp/conversation-delegate-tools.js';
import { collectRolePicks } from '../src/global/hosts/picks.js';
import { createConversationService } from '../src/global/team/service.js';
import { getHost } from '../src/global/hosts/registry.js';
import { applyRoleFiles, retireRoleFiles } from '../src/global/hosts/plan.js';

const codex = { adapterId: 'codex', modelId: 'gpt-a', accessMode: 'automatic', utility: 1 };
const claude = { adapterId: 'claude', modelId: 'son-a', accessMode: 'automatic', utility: 5 };
const strategy = { status: 'active', profileFingerprint: 'fp', projectTeam: [{ role: 'Builder', model: claude }] };
const inputs = { role: 'Builder', strategy, eligibility: { claude: { ok: true }, codex: { ok: true } },
  models: [claude, codex], pool: [claude, codex], ledger: [], providerCapacity: {
    claude: { quotaRemainingPercent: 80 }, codex: { quotaRemainingPercent: 80 }
  } };

test('S1/S3: Codex host excludes Claude without mutating the shared approved team', () => {
  const before = JSON.stringify(inputs);
  const route = resolveProjectRoute({ ...inputs, activeHost: 'codex' });
  assert.equal(route.decision, 'ROUTED');
  assert.equal(route.provider, 'codex');
  assert.equal(route.host.id, 'codex');
  assert.equal(route.host.model, null);
  assert.equal(JSON.stringify(inputs), before);
});

test('S2/S3: no compatible or entitled model waits rather than launching Claude', () => {
  for (const extra of [{ pool: [claude] }, { modelEntitlement: { codex: { 'gpt-a': { status: 'denied' } } } },
    { eligibility: { claude: { ok: true }, codex: { ok: false, reason: 'no quota' } } }]) {
    const route = resolveProjectRoute({ ...inputs, ...extra, activeHost: 'codex' });
    assert.equal(route.decision, 'WAIT_FOR_PROJECT_TEAM');
    assert.equal(route.provider, null);
    assert.equal(route.suggestedAlternative, null);
  }
});

test('S1/S2: Claude bridges and host-neutral routes retain prior behavior', () => {
  const original = resolveProjectRoute(inputs);
  assert.equal(original.provider, 'claude');
  const hostRoute = resolveProjectRoute({ ...inputs, activeHost: 'claude-code' });
  assert.equal(hostRoute.provider, original.provider);
  assert.equal(hostRoute.model.modelId, original.model.modelId);
  const bridge = resolveProjectRoute({ ...inputs, pool: [codex], activeHost: 'claude-code' });
  assert.equal(bridge.provider, 'codex');
});

test('S1: OpenCode retains existing eligibility gates, not installed-provider assumptions', () => {
  const native = { adapterId: 'opencode-go', modelId: 'glm-a', accessMode: 'automatic', utility: 1 };
  const world = { ...inputs, pool: [...inputs.pool, native], models: [...inputs.models, native],
    eligibility: { ...inputs.eligibility, 'opencode-go': { ok: true } },
    providerCapacity: { ...inputs.providerCapacity, 'opencode-go': { quotaRemainingPercent: 80 } } };
  const route = resolveProjectRoute({ ...world, activeHost: 'opencode' });
  assert.equal(route.host.id, 'opencode');
  assert.equal(route.provider, 'opencode-go');
  const blocked = resolveProjectRoute({ ...world, activeHost: 'opencode',
    eligibility: { ...world.eligibility, 'opencode-go': { ok: false } } });
  assert.equal(blocked.decision, 'WAIT_FOR_PROJECT_TEAM');
});

test('S1/S3: cached CLI honors explicit and runtime Codex host identity without writes', async t => {
  const f = await fixture(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Builder', model: claude }] });
  await f.cache();
  const before = await tree(f.home);
  const result = f.cli('--role', 'Builder', '--host', 'codex');
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.equal(route.provider, 'codex');
  assert.equal(route.host.id, 'codex');
  assert.deepEqual(await tree(f.home), before);
  const forced = f.cli('--role', 'Builder', '--host', 'codex', '--provider', 'claude');
  assert.notEqual(forced.status, 0);
  assert.equal(JSON.parse(forced.stdout).code, 'host_provider_unavailable');
  assert.deepEqual(await tree(f.home), before);
});

test('S2/S3: public Codex route waits at zero quota instead of keeping an exhausted native model', async t => {
  const f = await fixture(t);
  f.inputs.providerCapacity.codex.quotaRemainingPercent = 0;
  await f.cache();
  const before = await tree(f.home);
  const result = f.cli('--role', 'Builder', '--host', 'codex');
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.equal(route.decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.equal(route.provider, null);
  assert.equal(route.model, null);
  assert.deepEqual(await tree(f.home), before);
});

test('S1/S3: explicit role-sync host and all override ambiguous inherited runtime markers', async t => {
  const f = await fixture(t);
  await f.cache();
  const before = await tree(f.home);
  for (const host of ['codex', 'all']) {
    const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'roles', 'sync', '--host', host, '--cwd', f.cwd, '--json'], {
      env: { ...process.env, HARNESS_HOME: f.home, CLAUDECODE: '1', CODEX_THREAD_ID: 'nested-session' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout);
    const doc = JSON.parse(result.stdout);
    assert.equal(doc.applied, false);
    assert.equal(host === 'codex' ? doc.hosts.every(row => row.host === 'codex') : doc.hosts.length > 1, true);
  }
  assert.deepEqual(await tree(f.home), before);
});

test('S1/S3: host-incompatible stale assignments are not presented as executable picks', async t => {
  const f = await fixture(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Builder', model: claude }] });
  const before = await readFile(f.path.replace('routing-input-cache.json', 'project-strategy.json'), 'utf8');
  const route = await readTeamRoute({ role: 'Builder', cwd: f.cwd, homeDir: f.home, activeHost: 'codex' });
  assert.equal(route.decision, 'STALE');
  assert.equal(route.model, null);
  assert.equal(route.provider, null);
  assert.equal(await readFile(f.path.replace('routing-input-cache.json', 'project-strategy.json'), 'utf8'), before);
});

test('S3: team show projects the active host without changing approved assignments', async t => {
  const f = await fixture(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Builder', model: claude }] });
  await f.cache();
  const before = await tree(f.home);
  const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'show', '--host', 'codex', '--cwd', f.cwd, '--json'], {
    env: { ...process.env, HARNESS_HOME: f.home }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const doc = JSON.parse(result.stdout);
  assert.equal(doc.host.id, 'codex');
  assert.equal(doc.team.find(row => row.role === 'Builder').provider, 'codex');
  assert.deepEqual(await tree(f.home), before);
});

test('S1: identity uses explicit bindings or session evidence, never configured directories/models', () => {
  assert.equal(resolveActiveHost({ env: { CODEX_THREAD_ID: 'session' } }).id, 'codex');
  assert.equal(resolveActiveHost({ env: { CLAUDECODE: '1' } }).id, 'claude-code');
  assert.equal(resolveActiveHost({ env: { KAIRO_HOST: 'opencode', CODEX_THREAD_ID: 'parent' } }).id, 'opencode');
  assert.equal(resolveActiveHost({ host: 'claude-code', env: { KAIRO_HOST: 'codex' } }).id, 'claude-code');
  assert.equal(resolveActiveHost({ env: { HOME: '/has-all-clis', MODEL: 'sol' } }).id, null);
  assert.throws(() => resolveActiveHost({ env: { CLAUDECODE: '1', CODEX_THREAD_ID: 'parent' } }), { code: 'ambiguous_host' });
  assert.equal(resolveActiveHost({ env: {} }).model, null);
  assert.throws(() => resolveActiveHost({ host: 'invalid' }), { code: 'unsupported_host' });
});

test('S1/S3: runtime Codex marker and MCP server binding constrain cached routes', async t => {
  const f = await fixture(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Builder', model: claude }] });
  await f.cache();
  const env = { ...process.env, HARNESS_HOME: f.home, CODEX_THREAD_ID: 'session', CLAUDECODE: '', KAIRO_HOST: '' };
  delete env.KAIRO_HOST;
  const cli = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'route', '--role', 'Builder', '--cwd', f.cwd, '--json'], { env, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const routed = JSON.parse(cli.stdout);
  assert.equal(routed.provider, 'codex');
  assert.equal(routed.host.source, 'runtime');
  const handlers = createToolHandlers({ homeDir: f.home, cwd: f.cwd, cwdExplicit: true, env: { KAIRO_HOST: 'codex' } });
  const mcp = await handlers.kairo_team_route({ role: 'Builder' });
  assert.equal(mcp.structuredContent.provider, 'codex');
  assert.equal(mcp.structuredContent.host.id, 'codex');
});

test('S3: MCP previews carry server-owned host context, not caller-supplied identity', async () => {
  let received;
  const handlers = createConversationDelegateHandlers({ binding: { writable: true, cwd: '/project' },
    activeHost: resolveActiveHost({ host: 'codex' }),
    getService: () => ({ planExecution: async args => { received = args; return { decision: 'WAIT_FOR_PROJECT_TEAM' }; } }),
    mcpResult: result => result });
  await handlers.kairo_plan_execution({ taskId: 'task', role: 'Builder', activeHost: 'claude-code' });
  assert.equal(received.activeHost.id, 'codex');
});

test('S3: role generation asks for picks constrained to its target host', async () => {
  const calls = [];
  const result = await collectRolePicks({ catalog: { registry: { Builder: {} } }, projectRoot: '/project', homeDir: '/home', host: 'codex',
    readRoute: async args => { calls.push(args); return { decision: 'ROUTED', provider: 'codex', model: codex }; } });
  assert.equal(calls[0].activeHost, 'codex');
  assert.equal(result.picks.Builder.adapterId, 'codex');
});

test('S3: effective team view in Codex does not present Claude assignments as runnable', async t => {
  const f = await fixture(t);
  const shared = { ...f.strategy, projectTeam: [{ role: 'Builder', model: claude }] };
  await writeProjectStrategy(f.home, f.cwd, shared);
  await f.cache();
  const service = createConversationService({ homeDir: f.home, activeHost: 'codex',
    inspectExecutionAdapters: () => ['claude', 'codex'].map(id => ({ id, available: true, launchable: true })) });
  service.snapshot = async () => ({ projectRoot: f.cwd, projectStrategy: shared, modelIntelligence: {
    eligibility: f.inputs.eligibility, providerCapacity: f.inputs.providerCapacity
  }, timeline: [] });
  const before = await tree(f.home);
  const team = await service.readTeam({ cwd: f.cwd });
  assert.equal(team.host.id, 'codex');
  assert.equal(team.roles.find(row => row.role === 'Builder').provider, 'codex');
  assert.deepEqual(await tree(f.home), before);
});

test('S3: generated instructions bind each supported host without inventing tools', () => {
  for (const id of ['claude-code', 'codex', 'opencode']) {
    const pick = { adapterId: id === 'claude-code' ? 'claude' : 'codex', model: 'model-a' };
    const file = getHost(id).renderRoleFile({ id: 'Builder' }, pick);
    assert.match(file.content, new RegExp(`team route --host ${id}`));
    assert.match(file.content, /orchestrator remains the current session model/);
  }
});

test('S1/S3: OpenCode role sync installs a scoped host binding and retires only owned files', async t => {
  const f = await fixture(t);
  const args = { host: 'opencode', projectRoot: f.cwd, catalog: { registry: {} }, picks: {}, yes: true };
  await applyRoleFiles(args);
  const path = `${f.cwd}/.opencode/plugins/kairo-host.js`;
  const text = await readFile(path, 'utf8');
  const plugin = await import(`data:text/javascript,${encodeURIComponent(text)}`);
  const hooks = await plugin.KairoHost();
  const output = { env: { UNRELATED: 'preserved' } };
  await hooks['shell.env']({}, output);
  assert.deepEqual(output.env, { UNRELATED: 'preserved', KAIRO_HOST: 'opencode' });
  assert.equal(resolveActiveHost({ env: { ...output.env, CODEX_THREAD_ID: 'parent' } }).id, 'opencode');
  await retireRoleFiles({ host: 'opencode', projectRoot: f.cwd, yes: true });
  await assert.rejects(readFile(path), { code: 'ENOENT' });
  await mkdir(`${f.cwd}/.opencode/plugins`, { recursive: true });
  await writeFile(path, '// foreign plugin');
  await applyRoleFiles(args);
  await retireRoleFiles({ host: 'opencode', projectRoot: f.cwd, yes: true });
  assert.equal(await readFile(path, 'utf8'), '// foreign plugin');
});
