import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchLedgerPath } from '../src/global/team/launch-ledger.js';

const prompt = 'Keep `code`, $HOME and <tag> intact.\n';
async function setup(t, result = {}) {
  const home = await mkdtemp(join(tmpdir(), 'team-exec-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const calls = [], output = [], errors = [];
  return { home, calls, output, errors, deps: {
    homeDir: home, resolveRoot: async () => home,
    stdin: Readable.from([prompt]), stdout: { write: x => output.push(String(x)) },
    stderr: { write: x => errors.push(String(x)) },
    isModelExecutable: async () => true,
    readCatalogs: async () => [],
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      queueMicrotask(() => {
        child.stdout.end(result.stdout ?? 'answer\n'); child.stderr.end(result.stderr ?? '');
        child.emit('close', result.code ?? 0, null);
      });
      return child;
    },
  }};
}
for (const [provider, model, command] of [
  ['codex', 'gpt-test', 'codex'], ['claude', 'sonnet-test', 'claude'],
  ['cursor', 'composer-test', 'cursor-agent'], ['opencode', 'vendor/test', 'opencode'],
  ['opencode-go', 'opencode-go/test', 'opencode'], ['pi', 'test', 'pi'],
  ['gemini', 'gemini-test', 'gemini'],
]) test(`exec ${provider} uses adapter argv and per-launch model without a shell`, async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t);
  const code = await runTeamExecCli({ provider, model, cwd: f.home, role: 'odd-worker' }, f.deps);
  assert.equal(code, 0);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.command, command);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.cwd, f.home);
  assert.ok(call.args.includes(model)); assert.ok(call.args.includes(prompt));
  assert.equal(f.output.join(''), 'answer\n');
  const rows = (await readFile(launchLedgerPath(f.home, f.home), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r => r.source), ['launch', 'outcome']);
  assert.ok(rows.every(r => r.adapterId === provider && r.modelId === model && r.role === 'odd-worker'));
  assert.equal(rows[1].status, 'completed');
});
test('exec rejects unknown providers before spawning with one-line error', async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t);
  assert.notEqual(await runTeamExecCli({ provider: 'unknown', model: 'test' }, f.deps), 0);
  assert.equal(f.calls.length, 0); assert.equal(f.errors.join('').trim().split('\n').length, 1);
});
test('exec rejects models not executable for provider before spawning', async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t); f.deps.isModelExecutable = async () => false;
  assert.notEqual(await runTeamExecCli({ provider: 'codex', model: 'not-available' }, f.deps), 0);
  assert.equal(f.calls.length, 0); assert.match(f.errors.join(''), /not executable/);
});
test('exec runs a catalog model without an approved team or routing cache', async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t);
  f.deps.isModelExecutable = async () => false;
  f.deps.readCatalogs = async () => [{ adapterId: 'codex', models: [{ id: 'gpt-test' }] }];
  assert.equal(await runTeamExecCli({ provider: 'codex', model: 'gpt-test' }, f.deps), 0);
  assert.equal(f.calls.length, 1); assert.equal(f.errors.join(''), '');
});
test('exec still refuses a model missing from the catalog before spawning', async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t);
  f.deps.isModelExecutable = async () => false;
  f.deps.readCatalogs = async () => [{ adapterId: 'codex', models: [{ id: 'gpt-test' }] }];
  assert.notEqual(await runTeamExecCli({ provider: 'codex', model: 'gpt-unknown' }, f.deps), 0);
  assert.equal(f.calls.length, 0); assert.match(f.errors.join(''), /not executable/);
});
test('exec streams stderr, preserves child exit code and records exhaustion', async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t, { stdout: 'partial\n', stderr: 'Error: usage_limit_reached\n', code: 17 });
  assert.equal(await runTeamExecCli({ provider: 'codex', model: 'test' }, f.deps), 17);
  assert.equal(f.output.join(''), 'status: blocked\nreason: Error: usage_limit_reached\nfallback: kairo-builder\n'); assert.equal(f.errors.join(''), 'Error: usage_limit_reached\n');
  const rows = (await readFile(launchLedgerPath(f.home, f.home), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows[1].status, 'exhausted'); assert.ok(rows[1].expiresAt);
});
test('exec exhaustion fallback names the Kairo Claude agent of the role', async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t, { stderr: 'Error: usage_limit_reached\n', code: 1 });
  assert.equal(await runTeamExecCli({ provider: 'codex', model: 'test', role: 'Reviewer' }, f.deps), 1);
  assert.match(f.output.join(''), /\nfallback: kairo-reviewer\n$/);
});
test('exec records ordinary child failure without exhaustion', async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t, { stderr: 'ordinary failure\n', code: 3 });
  assert.equal(await runTeamExecCli({ provider: 'codex', model: 'test' }, f.deps), 3);
  const rows = (await readFile(launchLedgerPath(f.home, f.home), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows[1].status, 'failed');
});


test('exec CLI parses provider/model/cwd/role while preserving route arguments', async () => {
  const { parseArgs } = await import('../src/cli.js');
  const exec = parseArgs(['team', 'exec', '--provider', 'codex', '--model=gpt-test', '--cwd', '/tmp/project', '--role', 'odd-worker']);
  assert.equal(exec.options.teamAction, 'exec');
  assert.equal(exec.options.provider, 'codex'); assert.equal(exec.options.model, 'gpt-test');
  assert.equal(exec.options.role, 'odd-worker'); assert.equal(exec.options.cwd, '/tmp/project');
  const route = parseArgs(['team', 'route', '--role', 'Builder', '--json']);
  assert.equal(route.command, 'team'); assert.equal(route.options.role, 'Builder'); assert.equal(route.options.json, true);
});

test('cached executability checks exact provider/model, freshness, access and entitlement', async t => {
  const { isTeamModelExecutable } = await import('../src/global/team/team-exec.js');
  const { routingInputCachePath } = await import('../src/global/team/routing-input-cache.js');
  const f = await setup(t);
  const path = routingInputCachePath(f.home, f.home);
  await mkdir(join(path, '..'), { recursive: true });
  const input = { homeDir: f.home, projectRoot: f.home, provider: 'codex', model: 'gpt-test', now: () => 10000000 };
  const cache = { schema: 'kairo.routing-input-cache/v1', generatedAt: 10000000,
    models: [{ adapterId: 'codex', modelId: 'gpt-test', accessMode: 'automatic' }], eligibility: { codex: { ok: true } } };
  for (const [change, expected] of [
    [{}, true], [{ generatedAt: 0 }, false], [{ generatedAt: 10000001 }, false],
    [{ models: [{ adapterId: 'claude', modelId: 'gpt-test', accessMode: 'automatic' }] }, false],
    [{ models: [{ adapterId: 'codex', modelId: 'gpt-test', accessMode: 'manual' }] }, false],
    [{ eligibility: { codex: { ok: false } } }, false],
    [{ modelEntitlement: { codex: { 'gpt-test': { status: 'denied' } } } }, false],
    [{ modelEntitlement: { codex: { 'gpt-test': { status: 'allowed' } } } }, true],
  ]) {
    await writeFile(path, JSON.stringify({ ...cache, ...change }));
    assert.equal(await isTeamModelExecutable(input), expected, JSON.stringify(change));
  }
});

test('exec spawn error closes recorded launch as failed', async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t);
  f.deps.spawn = () => { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    queueMicrotask(() => child.emit('error', new Error('not installed'))); return child; };
  assert.equal(await runTeamExecCli({ provider: 'codex', model: 'test' }, f.deps), 1);
  const rows = (await readFile(launchLedgerPath(f.home, f.home), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows[1].status, 'failed');
});

test('exec with noRecord leaves the ledger to the router: no launch or outcome rows', async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t);
  const rows = [];
  f.deps.appendLaunchRecord = async (...args) => rows.push(['launch', args]);
  f.deps.appendOutcomeRecord = async (...args) => rows.push(['outcome', args]);
  assert.equal(await runTeamExecCli({ provider: 'codex', model: 'gpt-test', cwd: f.home, noRecord: true }, f.deps), 0);
  assert.deepEqual(rows, []);
  assert.equal(await runTeamExecCli({ provider: 'codex', model: 'gpt-test', cwd: f.home }, { ...f.deps, stdin: Readable.from(['again']) }), 0);
  assert.deepEqual(rows.map(r => r[0]), ['launch', 'outcome']);
});
