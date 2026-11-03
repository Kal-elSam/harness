import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from './team-route-fixture.test.js';
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
  assert.equal(await runTeamExecCli({ provider: 'codex', model: 'test', role: 'Builder' }, f.deps), 17);
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
  const cache = { schema: 'kairo.routing-input-cache/v2', generatedAt: 10000000,
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

for (const [role, fallback] of [['Debugger (fix)', 'kairo-debugger-fix'], ['Backend Builder', 'kairo-backend-builder'], ['Frontend Builder', 'kairo-frontend-builder'], ['Mobile Builder', 'kairo-builder']]) {
  test(`exec exhaustion keeps the role: ${role} falls back to ${fallback}`, async t => {
    const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
    const f = await setup(t, { stderr: 'Error: usage_limit_reached\n', code: 1 });
    assert.equal(await runTeamExecCli({ provider: 'codex', model: 'test', role }, f.deps), 1);
    assert.match(f.output.join(''), new RegExp(`\\nfallback: ${fallback}\\n$`));
  });
}
test('exec exhaustion of an unknown role is blocked with no fallback line', async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t, { stderr: 'Error: usage_limit_reached\n', code: 1 });
  assert.equal(await runTeamExecCli({ provider: 'codex', model: 'test', role: 'Astronomer' }, f.deps), 1);
  assert.equal(f.output.join(''), 'status: blocked\nreason: Error: usage_limit_reached\n');
});

for (const [provider, model, expected] of [
  ['codex', 'gpt-test', ['-c', 'model_reasoning_effort="high"']],
  ['claude', 'sonnet-test', ['--effort', 'high']],
  ['opencode-go', 'opencode-go/test', ['--model', 'opencode-go/test#high']],
]) test(`exec forwards explicit effort to ${provider} without changing task or model identity`, async t => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const f = await setup(t);
  assert.equal(await runTeamExecCli({ provider, model, effort: 'high', noRecord: true }, f.deps), 0);
  const args = f.calls[0].args;
  assert.ok(args.some((arg, i) => arg === expected[0] && args[i + 1] === expected[1]), JSON.stringify(args));
  assert.ok(args.includes(prompt));
  assert.equal(f.output.join(''), 'answer\n');
});

test('exec parses optional effort and refuses unsupported effort instead of silently ignoring it', async t => {
  const { parseArgs } = await import('../src/cli.js');
  assert.equal(parseArgs(['team', 'exec', '--provider', 'codex', '--model', 'test', '--effort', 'high']).options.effort, 'high');
  assert.equal(parseArgs(['team', 'exec', '--provider=codex', '--model=test', '--effort=low']).options.effort, 'low');
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  for (const options of [{ provider: 'cursor', effort: 'high' }, { provider: 'codex', effort: '";bad' }]) {
    const f = await setup(t);
    assert.equal(await runTeamExecCli({ model: 'test', ...options }, f.deps), 1);
    assert.equal(f.calls.length, 0);
    assert.match(f.errors.join(''), /effort/);
  }
});

async function execBinaryFixture(t, { provider = 'codex', error = '', alternatives = true, sameProvider = false, retryError = '', structured = false } = {}) {
  const f = await fixture(t);
  const first = { ...f.model, adapterId: provider, modelId: 'first' };
  const next = { ...first, adapterId: sameProvider ? provider : provider === 'codex' ? 'claude' : 'codex', modelId: 'next' };
  const models = [first, ...(alternatives ? [next] : [])];
  if (sameProvider) models.push({ ...next, adapterId: 'claude', modelId: 'cross-provider' });
  const { writeProjectStrategy } = await import('../src/global/team/project-strategy-store.js');
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Builder', model: first }] });
  await f.cache({ models, roles: { Builder: { pool: models } } });
  const bin = join(f.home, 'bin'), trace = join(f.home, 'calls.jsonl');
  await mkdir(bin);
  for (const name of ['codex', 'claude']) {
    await writeFile(join(bin, name), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2), model = args[args.indexOf('--model') + 1];
fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ provider: ${JSON.stringify(name)}, model, args }) + '\\n');
const error = model === 'first' ? ${JSON.stringify(error)} : ${JSON.stringify(retryError)};
if (error) { (${JSON.stringify(structured)} ? process.stdout : process.stderr).write(error + '\\n'); process.exit(17); }
process.stdout.write(${JSON.stringify(name === 'codex' ? '{"type":"item.completed","item":{"type":"agent_message","text":"answer"}}\n' : 'answer\n')});
`, { mode: 0o755 });
  }
  const env = { ...process.env, HOME: f.home, HARNESS_HOME: f.home, PATH: bin + ':' + process.env.PATH };
  for (const key of ['KAIRO_HOST', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDECODE', 'OPENCODE_CLIENT']) delete env[key];
  const cacheBefore = await readFile(f.path, 'utf8');
  const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'exec', '--cwd', f.cwd,
    '--role', 'Builder', '--provider', provider, '--model', 'first', '--effort', 'high'], { env, input: prompt, encoding: 'utf8' });
  const calls = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
  const rows = (await readFile(launchLedgerPath(f.home, f.cwd), 'utf8')).trim().split('\n').map(JSON.parse);
  return { ...f, result, calls, rows, first, next, cacheBefore };
}

// Capacity and rate-limit failures switch once, prefer the same provider, and leave an auditable ledger.
test('exec CLI retries provider capacity and rate-limit errors with the next routed model', async t => {
  for (const scenario of [
    { error: 'ERROR: Selected model is at capacity. Please try a different model.', sameProvider: true },
    { error: 'ERROR: Selected model is at capacity. Please try a different model.' },
    { error: 'ERROR: rate_limit_exceeded' },
    { error: JSON.stringify({ type: 'error', message: 'Selected model is at capacity. Please try a different model.' }), structured: true },
    { error: JSON.stringify({ type: 'turn.failed', error: { message: 'Selected model is at capacity. Please try a different model.' } }), structured: true },
    { provider: 'claude', error: JSON.stringify({ type: 'result', is_error: true, result: 'API Error: 429 rate_limit_error' }), structured: true },
    { provider: 'claude', error: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' },
    { provider: 'claude', error: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limit reached"}}' },
    { error: 'ERROR: Selected model is at capacity. Please try a different model.', retryError: 'ERROR: Selected model is at capacity. Please try a different model.' },
  ]) {
    const f = await execBinaryFixture(t, scenario);
    assert.equal(f.result.status, scenario.retryError ? 17 : 0, f.result.stderr);
    assert.deepEqual(f.calls.map(({ provider, model }) => [provider, model]), [[f.first.adapterId, 'first'], [f.next.adapterId, 'next']]);
    assert.ok(f.calls.every(row => row.args.includes(prompt)));
    assert.equal((f.result.stderr.match(/Switched /g) ?? []).length, 1);
    assert.deepEqual(f.rows.map(row => row.source), ['launch', 'outcome', 'launch', 'outcome']);
    assert.deepEqual(f.rows[2].switchedFrom, { adapterId: f.first.adapterId, modelId: 'first' });
    assert.ok(f.rows[2].reason.includes(scenario.error));
    assert.equal(f.rows[3].status, scenario.retryError ? 'failed' : 'completed');
    assert.ok(!f.calls[1].args.includes('high') && !f.calls[1].args.includes('model_reasoning_effort="high"'), 'replacement effort comes from routing, not the failed launch');
    assert.equal(await readFile(f.path, 'utf8'), f.cacheBefore, 'retry rejection must not change cached entitlement');
  }
});

// Without a qualified alternative, exec preserves the original diagnostic and exit code.
test('exec CLI reports no alternative and preserves the original capacity error', async t => {
  const error = 'ERROR: Selected model is at capacity. Please try a different model.';
  const f = await execBinaryFixture(t, { error, alternatives: false });
  assert.equal(f.result.status, 17);
  assert.ok(f.result.stderr.includes(error));
  assert.match(f.result.stderr, /No in-band alternative/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.rows.at(-1).status, 'failed');
});

// Task failures, including quoted capacity text in task output, never trigger another launch.
test('exec CLI leaves ordinary task failures unchanged', async t => {
  const error = 'Error: Test failed: expected "Selected model is at capacity. Please try a different model."';
  const f = await execBinaryFixture(t, { error });
  assert.equal(f.result.status, 17);
  assert.equal(f.result.stderr, error + '\n');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.rows.map(row => row.status ?? row.source), ['launch', 'failed']);
});

// Successful exec retains output, effort, prompt and exactly one launch/outcome pair.
test('exec CLI successful run is unchanged', async t => {
  const f = await execBinaryFixture(t);
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.result.stdout, 'answer\n');
  assert.equal(f.result.stderr, '');
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].args.includes('model_reasoning_effort="high"'));
  assert.deepEqual(f.rows.map(row => row.status ?? row.source), ['launch', 'completed']);
});
