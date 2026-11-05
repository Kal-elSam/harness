import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mod = () => import('../src/global/team/codex-provider-evidence.js');
const THREAD = '019e0000-aaaa-7bbb-8ccc-0123456789ab';
const OTHER_THREAD = '019e0000-aaaa-7bbb-8ccc-ffffffffffff';
const MODEL = 'gpt-test';
const ARGS = ['exec', '--json', '--approve-for-me', '--model', MODEL, '--', 'the task'];
const TURN = '019e0000-aaaa-7bbb-8ccc-00000000turn'.replace('turn', '0001');
const GOOD_READ = () => ({
  config: { model_provider: 'openai', openai_base_url: null, oss_provider: null, profile: null, model_providers: {}, chatgpt_base_url: 'https://chatgpt.com/backend-api/' },
  layers: [{ name: { type: 'user' } }, { name: { type: 'system' } }], requirements: null,
});
const good = (overrides = {}) => ({
  version: 'codex-cli 0.166.0\n', strict: 0, proxy: 'HTTPEnable : 0\n', procs: [{ pid: 1, comm: '/bin/zsh', args: '/bin/zsh -l' }], read: GOOD_READ(), ...overrides,
});

/** Fake process layer keyed by command; counts config reads so tests can prove the app-server stayed down. */
function makeDeps(spec) {
  const state = { reads: 0, psArgs: [], codesign: [], order: [] };
  const deps = {
    platform: 'darwin', state,
    exec: async (command, args) => {
      if (args[0] === '--version') return { code: 0, stdout: spec.version, stderr: '' };
      if (command.endsWith('codesign')) {
        state.codesign.push({ command, args });
        if (spec.codesignError) throw spec.codesignError;
        return { code: spec.strict, stdout: '', stderr: '' };
      }
      if (command.endsWith('scutil')) return { code: 0, stdout: spec.proxy, stderr: '' };
      if (command.endsWith('ps')) {
        state.psArgs.push(args);
        state.order.push('ps');
        if (spec.psError) throw spec.psError;
        if (spec.psCode) return { code: spec.psCode, stdout: '', stderr: 'ps failed' };
        return { code: 0, stdout: spec.procs.map(row => `  ${row.pid} ${row.comm}`).join('\n') + '\n', stderr: '' };
      }
      throw new Error('unexpected command');
    },
    readConfig: async ({ args }) => { state.order.push('config'); state.reads++; state.flags = args; if (spec.readError) throw spec.readError; return spec.read; },
  };
  return deps;
}

async function world(t, { rollouts = [{ id: THREAD }], stdoutLines, code = 0, spec = good(), args = ARGS, extraDeps = {}, prepare } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codex-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'), cwd = join(root, 'work'), codexHome = join(root, 'home');
  await mkdir(bin); await mkdir(cwd);
  await writeFile(join(bin, 'codex'), '#!/bin/sh\n'); await chmod(join(bin, 'codex'), 0o755);
  let n = 0;
  for (const rollout of rollouts) {
    const dir = join(codexHome, 'sessions', '2026', '11', String(5 + (n++ % 2)).padStart(2, '0'));
    await mkdir(dir, { recursive: true });
    const meta = { id: rollout.id, originator: 'codex_exec', source: 'exec', model_provider: 'openai', cwd, cli_version: '0.166.0', ...rollout.meta };
    const turn = rollout.turn ?? TURN;
    const complete = { type: 'event_msg', payload: { type: 'task_complete', turn_id: rollout.completeTurn ?? turn, root_turn_id: turn, last_agent_message: 'done', started_at: 1, completed_at: 2, duration_ms: 1000, time_to_first_token_ms: 10 } };
    const records = rollout.records ?? [{ type: 'session_meta', payload: meta }, { type: 'turn_context', payload: { turn_id: turn, model: rollout.model ?? MODEL } }, ...(rollout.noComplete ? [] : [complete]), ...(rollout.extra ?? [])];
    await writeFile(join(dir, `rollout-2026-11-05T10-00-00-${rollout.fileId ?? rollout.id}.jsonl`),
      records.map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n');
  }
  const sourceEnv = { PATH: bin, HOME: root, CODEX_HOME: codexHome };
  const deps = { ...makeDeps(spec), ...extraDeps };
  const { prepareVerifiedCodexLaunch, classifyCodexExecution } = await mod();
  const launch = await prepareVerifiedCodexLaunch({ args, cwd, model: MODEL, sourceEnv }, deps);
  const lines = stdoutLines ?? [{ type: 'thread.started', thread_id: THREAD }, { type: 'turn.completed' }];
  const evidence = await classifyCodexExecution({ preflight: launch.preflight, requestedModel: MODEL, executionId: 'exec-0001-abcd', cwd, codexHome,
    result: { code, stdout: lines.map(line => JSON.stringify(line)).join('\n') + '\n' } }, deps);
  return { evidence, launch, deps, cwd, root, codexHome };
}

test('R2b closure a fully clean run keeps provenance but gives no provider credit', async t => {
  const { evidence, launch, cwd } = await world(t);
  assert.equal(evidence.status, 'none-detected');
  assert.equal(evidence.providerVerified, false);
  assert.equal(evidence.rolloutLinked, true);
  assert.equal(evidence.threadId, THREAD);
  assert.equal(evidence.executionId, 'exec-0001-abcd');
  assert.equal(evidence.servedModelId, null);
  assert.equal(evidence.modelVerified, false);
  assert.deepEqual(evidence.reasons, ['provider-credit-disabled']);
  assert.equal(evidence.provider, 'codex');
  assert.equal(evidence.source, 'runtime-rollout');
  assert.equal(evidence.requestedModelId, MODEL);
  assert.equal(evidence.servedModelId, null);
  assert.equal(evidence.modelVerified, false);
  assert.equal(evidence.threadId, THREAD);
  assert.equal(evidence.executionId, 'exec-0001-abcd');
  assert.ok(Object.isFrozen(evidence));
  assert.ok(launch.executable.endsWith('/bin/codex') && launch.executable.startsWith('/'));
});

for (const [label, read, reason] of [
  ['openai_base_url', { ...GOOD_READ(), config: { ...GOOD_READ().config, openai_base_url: 'http://127.0.0.1:9/v1' } }, 'config-disallowed'],
  ['custom model_provider', { ...GOOD_READ(), config: { ...GOOD_READ().config, model_provider: 'evil' } }, 'config-disallowed'],
  ['model_providers entries', { ...GOOD_READ(), config: { ...GOOD_READ().config, model_providers: { evil: { base_url: 'http://x' } } } }, 'config-disallowed'],
  ['profile', { ...GOOD_READ(), config: { ...GOOD_READ().config, profile: 'p' } }, 'config-disallowed'],
  ['unknown layer', { ...GOOD_READ(), layers: [{ name: { type: 'user' } }, { name: { type: 'project' } }] }, 'layer-unknown'],
]) test(`A1 ${label} makes the execution untrusted and never verified`, async t => {
  const { evidence } = await world(t, { spec: good({ read }) });
  assert.equal(evidence.status, 'untrusted');
  assert.equal(evidence.providerVerified, false);
  assert.ok(evidence.reasons.includes(reason));
  assert.equal(evidence.servedModelId, null);
});

test('A1 non-null requirements, an enabled proxy and a failed signature requirement are untrusted', async t => {
  for (const [spec, reason] of [
    [good({ read: { ...GOOD_READ(), requirements: { allowed: [] } } }), 'requirements-present'],
    [good({ proxy: 'HTTPSEnable : 1\n' }), 'proxy-enabled'],
    [good({ strict: 3 }), 'signature-invalid'],
  ]) {
    const { evidence } = await world(t, { spec });
    assert.equal(evidence.status, 'untrusted', reason);
    assert.equal(evidence.providerVerified, false);
    assert.ok(evidence.reasons.includes(reason));
  }
});

const C = '/usr/local/bin/codex';
const proc = (comm, pid = 4242) => ({ pid, comm });
const PS_ARGV = ['-axww', '-o', 'pid=', '-o', 'comm='];

test('R3 ps output with no rows fails closed and the one ps read uses separate -o options and no args column', async t => {
  const { evidence, deps } = await world(t, { spec: good({ procs: [] }) });
  assert.equal(evidence.status, 'none-detected');
  assert.deepEqual(evidence.reasons, ['check-unavailable']);
  assert.equal(evidence.providerVerified, false);
  assert.deepEqual(deps.state.psArgs, [PS_ARGV]);
});

test('R2b a foreign codex process, whatever its arguments, gives none-detected with other-codex-process and config inspection still runs', async t => {
  for (const row of [proc(C), proc('/Users/me/My Tools/codex'), proc('(codex)'), proc('codex'), proc('/opt/x/(codex)'), proc(C, 1)]) {
    const { evidence, deps } = await world(t, { spec: good({ procs: [row] }), extraDeps: { pid: 99 } });
    assert.equal(evidence.status, 'none-detected', row.comm);
    assert.deepEqual(evidence.reasons, ['other-codex-process'], row.comm);
    assert.equal(evidence.providerVerified, false);
    assert.equal(deps.state.reads, 1);
    assert.deepEqual(deps.state.psArgs, [PS_ARGV]);
  }
});

test('R2b look-alike process names have no effect and the success path reaches controlled', async t => {
  for (const row of [proc('/usr/bin/grep'), proc('/path/to/codex-helper'), proc('codex.md'), proc('/usr/bin/vim'), proc('/usr/local/bin/node'), proc('/bin/zsh'), proc('(codex-helper)')]) {
    const { evidence } = await world(t, { spec: good({ procs: [row] }), extraDeps: { pid: 99 } });
    assert.equal(evidence.status, 'none-detected', row.comm);
    assert.equal(evidence.providerVerified, false);
    assert.deepEqual(evidence.reasons, ['provider-credit-disabled']);
  }
});

test('R2b the Kairo process row is excluded, any other pid is foreign', async t => {
  const own = await world(t, { spec: good({ procs: [proc(C, 4242), proc('/bin/zsh', 1)] }), extraDeps: { pid: 4242 } });
  assert.deepEqual(own.evidence.reasons, ['provider-credit-disabled']);
  const both = await world(t, { spec: good({ procs: [proc(C, 4242), proc(C, 4243)] }), extraDeps: { pid: 4242 } });
  assert.deepEqual(both.evidence.reasons, ['other-codex-process']);
  const { runCodexPreflight } = await mod();
  const dflt = await runCodexPreflight({ executable: C, args: ARGS, env: {}, cwd: '/', model: MODEL },
    { ...makeDeps(good({ procs: [proc(C, process.pid)] })) });
  assert.ok(!dflt.unavailable.includes('other-codex-process'));
});

test('R2b ps non-zero exit, a timeout, a launch failure and unparseable output give no credit and are never read as absence', async t => {
  const timeout = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
  for (const [spec, reason] of [
    [good({ psCode: 1 }), 'check-unavailable'], [good({ psError: timeout }), 'check-timeout'],
    [good({ psError: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }), 'check-unavailable'], [good({ procs: [] }), 'check-unavailable'],
  ]) {
    const { evidence } = await world(t, { spec });
    assert.equal(evidence.status, 'none-detected', reason);
    assert.deepEqual(evidence.reasons, [reason]);
    assert.equal(evidence.providerVerified, false);
  }
});

test('R2b the process check runs before our own app-server spawn, so ours is never counted', async t => {
  const { deps } = await world(t);
  assert.deepEqual(deps.state.order, ['ps', 'config']);
});

test('A1 argv outside the default team exec set is untrusted', async t => {
  for (const extra of [['--oss'], ['--local-provider', 'ollama'], ['-p', 'x'], ['--profile', 'x'], ['-c', 'openai_base_url="http://x"'], ['--ignore-user-config']]) {
    const args = [...extra, ...ARGS];
    const { evidence } = await world(t, { args });
    assert.equal(evidence.status, 'untrusted', extra.join(' '));
    assert.ok(evidence.reasons.includes('argv-disallowed'));
    assert.equal(evidence.providerVerified, false);
  }
});

test('A1 verified argv must separate the task with -- so a task cannot be parsed as an option', async t => {
  const { evidence } = await world(t, { args: ['exec', '--json', '--approve-for-me', '--model', MODEL, '--config=openai_base_url="http://x"'] });
  assert.equal(evidence.status, 'untrusted');
  assert.ok(evidence.reasons.includes('argv-disallowed'));
});

test('A1 the effort override is the only allowed -c and reaches the app-server flags', async t => {
  const args = ['exec', '--json', '--approve-for-me', '--model', MODEL, '-c', 'model_reasoning_effort="high"', '--', 'the task'];
  const { evidence, deps } = await world(t, { args });
  assert.deepEqual(evidence.reasons, ['provider-credit-disabled']);
  assert.deepEqual(deps.state.flags, ['-c', 'model_reasoning_effort="high"']);
});

test('A1 unavailable checks, a version outside the pin and an unsupported platform give none-detected, never controlled', async t => {
  for (const [spec, reason] of [
    [good({ readError: new Error('boom') }), 'check-unavailable'],
    [good({ readError: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }) }), 'check-timeout'],
    [good({ version: 'codex-cli 0.167.0\n' }), 'version-unpinned'],
  ]) {
    const { evidence } = await world(t, { spec });
    assert.equal(evidence.status, 'none-detected', reason);
    assert.equal(evidence.providerVerified, false);
    assert.deepEqual(evidence.reasons, [reason]);
  }
  const { classifyCodexExecution, runCodexPreflight } = await mod();
  const preflight = await runCodexPreflight({ executable: '/x/codex', args: ARGS, env: {}, cwd: '/x', model: MODEL }, { ...makeDeps(good()), platform: 'linux' });
  const evidence = await classifyCodexExecution({ preflight, requestedModel: MODEL, executionId: 'e', cwd: '/x', codexHome: '/nonexistent', result: { code: 0, stdout: '' } });
  assert.equal(evidence.status, 'none-detected');
  assert.ok(evidence.reasons.includes('unsupported-platform'));
});

test('A3 an absent rollout and a same-minute unrelated rollout are never credited', async t => {
  const absent = await world(t, { rollouts: [] });
  assert.equal(absent.evidence.status, 'none-detected');
  assert.deepEqual(absent.evidence.reasons, ['no-rollout']);
  assert.equal(absent.evidence.providerVerified, false);
  const unrelated = await world(t, { rollouts: [{ id: OTHER_THREAD }] });
  assert.equal(unrelated.evidence.status, 'none-detected');
  assert.deepEqual(unrelated.evidence.reasons, ['no-rollout']);
  assert.equal(unrelated.evidence.providerVerified, false);
});

test('A3 duplicate rollouts for one thread are untrusted', async t => {
  const { evidence } = await world(t, { rollouts: [{ id: THREAD }, { id: THREAD }] });
  assert.equal(evidence.status, 'untrusted');
  assert.deepEqual(evidence.reasons, ['rollout-multiple']);
  assert.equal(evidence.providerVerified, false);
});

test('A3 any mismatched rollout field is untrusted', async t => {
  for (const rollout of [
    { id: THREAD, fileId: THREAD, meta: { id: OTHER_THREAD } }, { id: THREAD, meta: { originator: 'codex_cli_rs' } }, { id: THREAD, meta: { source: 'cli' } },
    { id: THREAD, meta: { model_provider: 'evil' } }, { id: THREAD, meta: { cwd: '/elsewhere' } }, { id: THREAD, meta: { cli_version: '0.165.0' } },
    { id: THREAD, model: 'other-model' },
  ]) {
    const { evidence } = await world(t, { rollouts: [rollout] });
    assert.equal(evidence.status, 'untrusted', JSON.stringify(rollout.meta ?? rollout.model));
    assert.deepEqual(evidence.reasons, ['rollout-mismatch']);
    assert.equal(evidence.providerVerified, false);
  }
});

test('A3 duplicate or conflicting thread ids are untrusted and a thread id that could traverse paths is rejected', async t => {
  const conflict = await world(t, { stdoutLines: [{ type: 'thread.started', thread_id: THREAD }, { type: 'thread.started', thread_id: OTHER_THREAD }, { type: 'turn.completed' }] });
  assert.equal(conflict.evidence.status, 'untrusted');
  assert.ok(conflict.evidence.reasons.includes('thread-id-conflict'));
  const traversal = await world(t, { stdoutLines: [{ type: 'thread.started', thread_id: '../../etc/passwd' }, { type: 'turn.completed' }] });
  assert.equal(traversal.evidence.status, 'untrusted');
  assert.ok(traversal.evidence.reasons.includes('thread-id-invalid'));
  assert.equal(traversal.evidence.threadId, null);
  assert.equal(traversal.evidence.providerVerified, false);
});

test('A3 a failed run or a run without turn.completed is not verified even with a linked rollout', async t => {
  const failed = await world(t, { code: 1 });
  assert.equal(failed.evidence.status, 'none-detected');
  assert.deepEqual(failed.evidence.reasons, ['exit-nonzero']);
  assert.equal(failed.evidence.providerVerified, false);
  const incomplete = await world(t, { stdoutLines: [{ type: 'thread.started', thread_id: THREAD }] });
  assert.equal(incomplete.evidence.status, 'none-detected');
  assert.deepEqual(incomplete.evidence.reasons, ['no-turn-completed']);
  const noThread = await world(t, { stdoutLines: [{ type: 'turn.completed' }] });
  assert.deepEqual(noThread.evidence.reasons, ['no-thread-id']);
});

test('untrusted wins over none-detected', async t => {
  const { evidence } = await world(t, { code: 1, spec: good({ proxy: 'HTTPEnable : 1\n' }) });
  assert.equal(evidence.status, 'untrusted');
  assert.deepEqual(evidence.reasons, ['proxy-enabled', 'exit-nonzero']);
});

test('A5 the verified env is the exact allowlist and drops overrides, proxies, certificates and unknown variables', async () => {
  const { buildVerifiedCodexEnv } = await mod();
  const source = {
    PATH: '/bin', HOME: '/h', USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', LANG: 'C', LC_ALL: 'C', LC_CTYPE: 'C', TMPDIR: '/t', TERM: 'xterm',
    CODEX_HOME: '/codex', OPENAI_BASE_URL: 'http://evil', CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'x', CODEX_EXEC_SERVER_URL: 'ws://evil',
    CODEX_API_KEY: 'sk-secret', HTTPS_PROXY: 'http://p', SSL_CERT_FILE: '/c', SOMETHING_ELSE: '1', OPENAI_API_KEY: 'sk-other',
  };
  const env = buildVerifiedCodexEnv(source, '/codex');
  assert.equal(Object.getPrototypeOf(env), null);
  assert.deepEqual(Object.keys(env).sort(), ['CODEX_HOME', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'TMPDIR', 'USER']);
  for (const key of ['OPENAI_BASE_URL', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE', 'CODEX_EXEC_SERVER_URL', 'CODEX_API_KEY', 'HTTPS_PROXY', 'SSL_CERT_FILE', 'SOMETHING_ELSE', 'OPENAI_API_KEY']) assert.equal(key in env, false);
  assert.equal(env.CODEX_HOME, '/codex');
});

test('A2 more than one thread.started event is untrusted even when the ids are identical', async t => {
  const { evidence } = await world(t, { stdoutLines: [{ type: 'thread.started', thread_id: THREAD }, { type: 'thread.started', thread_id: THREAD }, { type: 'turn.completed' }] });
  assert.equal(evidence.status, 'untrusted');
  assert.ok(evidence.reasons.includes('thread-id-conflict'));
  assert.equal(evidence.providerVerified, false);
});

test('B1 a rollout without its own task_complete is none-detected and a completion for another turn is untrusted', async t => {
  const missing = await world(t, { rollouts: [{ id: THREAD, noComplete: true }] });
  assert.equal(missing.evidence.status, 'none-detected');
  assert.deepEqual(missing.evidence.reasons, ['rollout-incomplete']);
  assert.equal(missing.evidence.providerVerified, false);
  const other = await world(t, { rollouts: [{ id: THREAD, completeTurn: 'other-turn' }] });
  assert.equal(other.evidence.status, 'untrusted');
  assert.deepEqual(other.evidence.reasons, ['rollout-mismatch']);
});

test('B2 a malformed rollout line is none-detected', async t => {
  const w = await world(t, { rollouts: [] });
  const dir = join(w.codexHome, 'sessions', '2026', '11', '05');
  await mkdir(dir, { recursive: true });
  const rows = [{ type: 'session_meta', payload: { id: THREAD, originator: 'codex_exec', source: 'exec', model_provider: 'openai', cwd: w.cwd, cli_version: '0.166.0' } },
    { type: 'turn_context', payload: { turn_id: TURN, model: MODEL } }, { type: 'event_msg', payload: { type: 'task_complete', turn_id: TURN } }];
  await writeFile(join(dir, `rollout-x-${THREAD}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n{not json\n');
  const { classifyCodexExecution } = await mod();
  const evidence = await classifyCodexExecution({ preflight: w.launch.preflight, requestedModel: MODEL, executionId: 'exec-0001-abcd', cwd: w.cwd, codexHome: w.codexHome,
    result: { code: 0, stdout: `${JSON.stringify({ type: 'thread.started', thread_id: THREAD })}\n${JSON.stringify({ type: 'turn.completed' })}\n` } });
  assert.equal(evidence.status, 'none-detected');
  assert.deepEqual(evidence.reasons, ['rollout-unparseable']);
  assert.equal(evidence.providerVerified, false);
});

test('B2 a session_meta count other than one, or a second completion, is untrusted', async t => {
  const meta = cwd => ({ type: 'session_meta', payload: { id: THREAD, originator: 'codex_exec', source: 'exec', model_provider: 'openai', cwd, cli_version: '0.166.0' } });
  const ctx = { type: 'turn_context', payload: { turn_id: TURN, model: MODEL } };
  const done = { type: 'event_msg', payload: { type: 'task_complete', turn_id: TURN } };
  for (const make of [() => [ctx, done], cwd => [meta(cwd), meta(cwd), ctx, done], cwd => [meta(cwd), ctx, done, done]]) {
    const w = await world(t, { rollouts: [] });
    const dir = join(w.codexHome, 'sessions', '2026', '11', '05');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `rollout-x-${THREAD}.jsonl`), make(w.cwd).map(row => JSON.stringify(row)).join('\n') + '\n');
    const { classifyCodexExecution } = await mod();
    const evidence = await classifyCodexExecution({ preflight: w.launch.preflight, requestedModel: MODEL, executionId: 'exec-0001-abcd', cwd: w.cwd, codexHome: w.codexHome,
      result: { code: 0, stdout: `${JSON.stringify({ type: 'thread.started', thread_id: THREAD })}\n${JSON.stringify({ type: 'turn.completed' })}\n` } });
    assert.equal(evidence.status, 'untrusted');
    assert.ok(evidence.reasons.includes('rollout-mismatch'));
    assert.equal(evidence.providerVerified, false);
  }
});

async function classifyAgainst(w, extra = {}) {
  const { classifyCodexExecution } = await mod();
  return classifyCodexExecution({ preflight: w.launch.preflight, requestedModel: MODEL, executionId: 'exec-0001-abcd', cwd: w.cwd, codexHome: w.codexHome,
    result: { code: 0, stdout: `${JSON.stringify({ type: 'thread.started', thread_id: THREAD })}\n${JSON.stringify({ type: 'turn.completed' })}\n` } }, extra);
}

test('B3 a FIFO, a symlink and an oversized file in place of the rollout never stall or get credit', async t => {
  const w = await world(t, { rollouts: [] });
  const dir = join(w.codexHome, 'sessions', '2026', '11', '05');
  await mkdir(dir, { recursive: true });
  const target = join(dir, `rollout-x-${THREAD}.jsonl`);
  assert.equal(spawnSync('mkfifo', [target]).status, 0);
  const started = Date.now();
  const fifo = await classifyAgainst(w, { evidenceTimeoutMs: 1500 });
  assert.ok(Date.now() - started < 1500, 'FIFO read must return within the deadline');
  assert.equal(fifo.status, 'untrusted');
  assert.ok(fifo.reasons.includes('rollout-not-regular'));
  assert.equal(fifo.providerVerified, false);
  await rm(target);
  const real = join(w.root, 'real.jsonl'); await writeFile(real, '');
  await symlink(real, target);
  const link = await classifyAgainst(w, { evidenceTimeoutMs: 1500 });
  assert.equal(link.status, 'untrusted');
  assert.ok(link.reasons.includes('rollout-not-regular'));
  await rm(target);
  const handle = await open(target, 'w'); await handle.truncate(64 * 1024 * 1024 + 1); await handle.close();
  const big = await classifyAgainst(w, { evidenceTimeoutMs: 1500 });
  assert.equal(big.status, 'none-detected');
  assert.ok(big.reasons.includes('rollout-too-large'));
  assert.equal(big.providerVerified, false);
});

test('B3 a stalled evidence read returns by the overall deadline with evidence-timeout', async t => {
  const w = await world(t);
  const started = Date.now();
  const evidence = await classifyAgainst(w, { evidenceTimeoutMs: 200, readdir: () => new Promise(() => {}) });
  assert.ok(Date.now() - started < 2000);
  assert.equal(evidence.status, 'none-detected');
  assert.ok(evidence.reasons.includes('evidence-timeout'));
  assert.equal(evidence.providerVerified, false);
});

async function fixtureBinary(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'fixture-codex');
  await writeFile(bin, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(process.env.FIXTURE_PID, String(process.pid));
const mode = process.env.FIXTURE_MODE;
const send = m => process.stdout.write(JSON.stringify(m) + '\\n');
let buf = '';
process.stdin.on('data', chunk => {
  buf += chunk; let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (mode === 'hang') continue;
    if (m.method === 'initialize') send(mode === 'error' ? { id: m.id, error: { code: -1, message: 'no' } } : { id: m.id, result: {} });
    if (m.method === 'config/read') send({ id: m.id, result: { config: { model_provider: 'openai' }, layers: [{ name: { type: 'user' } }] } });
    if (m.method === 'configRequirements/read') send({ id: m.id, result: { requirements: null } });
  }
});
`);
  await chmod(bin, 0o755);
  return { bin, pidFile: join(root, 'pid') };
}
const dead = async pid => { for (let i = 0; i < 40; i++) { try { process.kill(pid, 0); } catch { return true; } await new Promise(r => setTimeout(r, 50)); } return false; };

test('A3 the app-server reader handles success, a JSON-RPC error and a hang, and leaves no process behind', async t => {
  const { readCodexEffectiveConfig } = await mod();
  const fx = await fixtureBinary(t);
  const run = (mode, timeoutMs) => readCodexEffectiveConfig({ executable: fx.bin, args: ['-c', 'x=1'], env: { FIXTURE_MODE: mode, FIXTURE_PID: fx.pidFile, PATH: process.env.PATH }, cwd: tmpdir(), timeoutMs });
  const ok = await run('ok', 5000);
  assert.deepEqual(ok, { config: { model_provider: 'openai' }, layers: [{ name: { type: 'user' } }], requirements: null });
  assert.ok(await dead(Number(await readFile(fx.pidFile, 'utf8'))));
  await assert.rejects(run('error', 5000), /app-server error/);
  assert.ok(await dead(Number(await readFile(fx.pidFile, 'utf8'))));
  const started = Date.now();
  await assert.rejects(run('hang', 300), { code: 'ETIMEDOUT' });
  assert.ok(Date.now() - started < 2000);
  assert.ok(await dead(Number(await readFile(fx.pidFile, 'utf8'))));
});

const dirent = (name, dir) => ({ name, isDirectory: () => dir, isFile: () => !dir });

test('B3 traversal stops at the deadline: the directory read count does not rise after the call returns', async t => {
  const w = await world(t);
  let reads = 0;
  const readdir = async () => { reads++; await new Promise(r => setTimeout(r, 120)); return [dirent('a', true), dirent('b', true), dirent('c', true)]; };
  const evidence = await classifyAgainst(w, { evidenceTimeoutMs: 40, readdir });
  assert.deepEqual(evidence.reasons, ['evidence-timeout']);
  assert.equal(evidence.status, 'none-detected');
  const atReturn = reads;
  await new Promise(r => setTimeout(r, 700));
  assert.equal(reads, atReturn);
});

test('B3 a pending rollout read is released by closing the handle exactly once, without unhandled rejections', async t => {
  const w = await world(t);
  const rejections = []; const onRejection = error => rejections.push(error);
  process.on('unhandledRejection', onRejection); t.after(() => process.off('unhandledRejection', onRejection));
  let closes = 0, rejectRead;
  const handle = { stat: async () => ({ isFile: () => true, size: 10 }),
    read: () => new Promise((_, reject) => { rejectRead = reject; }),
    close: async () => { closes++; rejectRead?.(new Error('closed')); } };
  const readdir = async () => [dirent(`rollout-x-${THREAD}.jsonl`, false)];
  const evidence = await classifyAgainst(w, { evidenceTimeoutMs: 100, readdir, open: async () => handle });
  assert.equal(evidence.status, 'none-detected');
  assert.deepEqual(evidence.reasons, ['evidence-timeout']);
  assert.equal(evidence.providerVerified, false);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(closes, 1);
  assert.deepEqual(rejections, []);
});

// --- Remediation items 1-4 (REMEDIATION_APPROVED_BEFORE_CANARY) ---
const REQUIREMENT = '-R=anchor apple generic and certificate leaf[subject.OU] = "2DC432GLL2"';

test('R2 signature check is one codesign --verify --strict with the Team ID requirement on the exact launch path', async t => {
  const { world: w } = { world: await world(t) };
  assert.deepEqual(w.evidence.reasons, ['provider-credit-disabled']);
  assert.deepEqual(w.deps.state.codesign.map(call => call.args), [['--verify', '--strict', REQUIREMENT, w.launch.executable]]);
  assert.equal(w.deps.state.codesign[0].command, '/usr/bin/codesign');
  assert.ok(w.launch.executable.startsWith('/'));
});

test('R2 a non-zero requirement result is untrusted and an unavailable or timed-out codesign is none-detected', async t => {
  const failed = await world(t, { spec: good({ strict: 3 }) });
  assert.equal(failed.evidence.status, 'untrusted');
  assert.ok(failed.evidence.reasons.includes('signature-invalid'));
  assert.equal(failed.evidence.providerVerified, false);
  for (const [error, reason] of [[Object.assign(new Error('ENOENT'), { code: 'ENOENT' }), 'check-unavailable'], [Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), 'check-timeout']]) {
    const { evidence } = await world(t, { spec: good({ codesignError: error }) });
    assert.equal(evidence.status, 'none-detected', reason);
    assert.ok(evidence.reasons.includes(reason));
    assert.ok(!evidence.reasons.includes('signature-invalid'));
    assert.equal(evidence.providerVerified, false);
  }
});

test('R1 only a classifier result passes the provenance predicate; a forged copy or look-alike does not', async t => {
  const { isClassifiedCodexEvidence } = await mod();
  const { evidence } = await world(t);
  assert.equal(isClassifiedCodexEvidence(evidence), true);
  assert.equal(isClassifiedCodexEvidence({ ...evidence }), false);
  assert.equal(isClassifiedCodexEvidence(JSON.parse(JSON.stringify(evidence))), false);
  assert.equal(isClassifiedCodexEvidence(Object.freeze({ ...evidence })), false);
  for (const value of [null, undefined, 'x', 1, [], {}]) assert.equal(isClassifiedCodexEvidence(value), false);
});

test('R4 prepare reports an unresolved executable or CODEX_HOME failure and builds no empty env', async t => {
  const { prepareVerifiedCodexLaunch } = await mod();
  const root = await mkdtemp(join(tmpdir(), 'codex-prep-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const missing = await prepareVerifiedCodexLaunch({ args: ARGS, cwd: root, model: MODEL, sourceEnv: { PATH: join(root, 'none'), CODEX_HOME: join(root, 'h') } }, makeDeps(good()));
  assert.equal(missing.failure, 'executable');
  const broken = await prepareVerifiedCodexLaunch({ args: ARGS, cwd: root, model: MODEL, sourceEnv: { PATH: root } }, { ...makeDeps(good()), resolveCodexHome: () => { throw new Error('no home'); } });
  assert.equal(broken.failure, 'env');
  assert.equal(broken.executable, null);
  const ok = (await world(t)).launch;
  assert.equal(ok.failure, undefined);
});

test('R7 a verified argv must start with exec, so it can never read as an ambiguous option-first process', async () => {
  const { checkCodexArgv } = await mod();
  assert.equal(checkCodexArgv(ARGS, MODEL), true);
  assert.equal(checkCodexArgv(['exec', '--json', '--approve-for-me', '--model', MODEL, '-c', 'model_reasoning_effort="low"', '--', 'task'], MODEL), true);
  for (const args of [['--model', MODEL, 'exec', '--json', '--approve-for-me', '--', 'task'], ['--json', 'exec', '--approve-for-me', '--model', MODEL, '--', 'task'],
    ['-c', 'model_reasoning_effort="low"', 'exec', '--json', '--approve-for-me', '--model', MODEL, '--', 'task']]) assert.equal(checkCodexArgv(args, MODEL), false, args.join(' '));
});

test('R2b closure a run without a rollout is not linked and never controlled', async t => {
  const { evidence } = await world(t, { rollouts: [] });
  assert.equal(evidence.rolloutLinked, false);
  assert.equal(evidence.providerVerified, false);
  assert.notEqual(evidence.status, 'controlled');
});

test('R2b closure no classifier path emits controlled or providerVerified true', async t => {
  const { CODEX_EVIDENCE_STATES } = await mod();
  assert.equal(CODEX_EVIDENCE_STATES.includes('controlled'), false);
  for (const opts of [{}, { code: 1 }, { spec: good({ procs: [proc(C, 9)] }), extraDeps: { pid: 9 } }, { args: ['exec', '--json', '--approve-for-me', '--model', MODEL, '--', 'x'] }]) {
    const { evidence } = await world(t, opts);
    assert.notEqual(evidence.status, 'controlled');
    assert.equal(evidence.providerVerified, false);
  }
});
