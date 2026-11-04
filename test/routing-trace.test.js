import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('record-trace persists the decision without private inputs', () => {
  const home = mkdtempSync(join(tmpdir(), 'routing-trace-test-'));
  const payload = { source: 'hook', prompt: 'PRIVATE PROMPT', apiKey: 'sk-secret123456', routingDecision: { kind: 'valid' }, selectedProvider: 'codex', selectedModel: 'gpt-a', effectiveLaunch: { provider: 'claude', model: 'sonnet', agent: 'builder', evidence: 'confirmed' } };
  const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-trace', '--payload', JSON.stringify(payload), '--cwd', process.cwd()], { env: { ...process.env, HOME: home, HARNESS_HOME: home }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, '');
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const file = walk(home).find(path => path.endsWith('/routing-trace.jsonl'));
  const text = readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /PRIVATE PROMPT|sk-secret123456/);
  const row = JSON.parse(text);
  assert.equal(row.fallbackDetected, true);
  assert.equal(row.schema, 'kairo.routing-trace/v2');
  assert.equal(row.effectiveLaunch.evidence, 'confirmed');
  assert.equal(row.role, 'unknown');
  assert.equal(row.observedConsumption, 'unknown');
});

test('Claude model aliases do not count as fallback', () => {
  const home = mkdtempSync(join(tmpdir(), 'routing-trace-alias-'));
  const payload = { selectedProvider: 'claude', selectedModel: 'claude-sonnet-5-5', routingDecision: { kind: 'valid' }, effectiveLaunch: { provider: 'claude', model: 'sonnet', evidence: 'confirmed' } };
  const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-trace', '--payload', JSON.stringify(payload), '--cwd', process.cwd()], { env: { ...process.env, HOME: home, HARNESS_HOME: home }, encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(result.stdout, '');
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  assert.equal(JSON.parse(readFileSync(walk(home).find(p => p.endsWith('/routing-trace.jsonl')), 'utf8')).fallbackDetected, false);
});

test('decision kinds, redaction, and quota use the public trace command', () => {
  const scenarios = [
    [{ kind: 'valid' }, 'codex', 'gpt', 'codex', 'gpt', false, null],
    [{ kind: 'valid' }, 'codex', 'gpt', 'claude', 'sonnet', true, 'Provider differs'],
    [{ kind: 'invalid', reason: 'blocked' }, null, null, 'claude', null, true, 'blocked'],
    [{ kind: 'absent', reason: 'no route' }, null, null, 'claude', null, true, 'no route'],
    [{ kind: 'denied' }, null, null, 'claude', 'sonnet', false, null],
  ];
  for (const [decision, selectedProvider, selectedModel, provider, model, expected, reason] of scenarios) {
    const home = mkdtempSync(join(tmpdir(), 'trace-case-'));
    const payload = { prompt: 'PRIVATE PROMPT', selectedProvider, selectedModel, routingDecision: decision, effectiveLaunch: { provider, model, evidence: 'unknown' }, rejectionReasons: [{ provider: 'codex', model: { modelId: 'gpt' }, reason: 'key sk-abcdefghijk', detail: 'detail' }], candidates: [{ provider: 'codex', model: { modelId: 'gpt' } }], selectionReason: 'Bearer secret-token', quotaSnapshot: { generatedAt: '2026-01-01', stale: true, ignored: 'secret-field', providers: { codex: { tier: 'CONSERVE', ignored: 'secret-field', windows: [{ name: 'week', remainingPercent: 33, resetsAt: 'tomorrow', ignored: 'secret-field' }] } } } };
    const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-trace', '--payload', JSON.stringify(payload), '--cwd', process.cwd()], { env: { ...process.env, HOME: home, HARNESS_HOME: home }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
    const files = walk(home), serialized = readFileSync(files.find(p => p.endsWith('/routing-trace.jsonl')), 'utf8');
    assert.doesNotMatch(serialized, /PRIVATE PROMPT|sk-abcdefghijk|secret-token|secret-field/);
    assert.ok(!files.some(p => /launch-ledger\.jsonl$|project-strategy\.json$/.test(p)));
    const row = JSON.parse(serialized); assert.equal(row.routingDecision.kind, decision.kind); assert.equal(row.fallbackDetected, expected);
    if (reason && decision.kind !== 'valid') assert.match(row.fallbackReason, new RegExp(reason));
    if (decision.kind === 'denied') assert.deepEqual(row.effectiveLaunch, { agent: null, provider: null, model: null, evidence: 'unknown' });
    assert.equal(row.observedConsumption, 'unknown'); assert.equal(row.estimatedConsumption, 'unknown');
    assert.equal(row.rejectionReasons[0].model, 'gpt'); assert.match(row.rejectionReasons[0].reason, /detail/); assert.equal(row.candidates[0].model, 'gpt');
    assert.deepEqual(row.quotaSnapshot, { observedAt: '2026-01-01', stale: true, providers: { codex: { tier: 'CONSERVE', windows: [{ name: 'week', remainingPercent: 33, resetsAt: 'tomorrow' }] } }, attribution: 'none' });
  }
});

test('malformed input fails without a trace', () => {
  const home = mkdtempSync(join(tmpdir(), 'trace-bad-'));
  const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-trace', '--payload', '{', '--cwd', process.cwd()], { env: { ...process.env, HOME: home, HARNESS_HOME: home }, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.deepEqual(readdirSync(home), []);
});

test('team exec records caller selection and survives trace failure', async () => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const { EventEmitter } = await import('node:events');
  const { PassThrough, Readable } = await import('node:stream');
  for (const fail of [false, true]) {
    const home = mkdtempSync(join(tmpdir(), 'trace-exec-')); const output = [], errors = [], rows = [];
    const code = await runTeamExecCli({ provider: 'codex', model: 'gpt-test', role: 'Builder' }, {
      homeDir: home, resolveRoot: async () => home, stdin: Readable.from(['task']), stdout: { write: x => output.push(String(x)) }, stderr: { write: x => errors.push(String(x)) }, isModelExecutable: async () => true, readCatalogs: async () => [],
      appendRoutingTrace: async (...args) => { if (fail) throw new Error('trace unavailable'); const { appendRoutingTrace } = await import('../src/global/team/routing-trace.js'); rows.push(await appendRoutingTrace(...args)); },
      spawn: () => { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); queueMicrotask(() => { child.stdout.end('answer\n'); child.stderr.end(); child.emit('close', 0, null); }); return child; },
    });
    assert.equal(code, 0); assert.equal(output.join(''), 'answer\n');
    if (fail) assert.match(errors.join(''), /trace unavailable/); else { assert.equal(errors.join(''), ''); assert.equal(rows[0].routingDecision.kind, 'caller_selected'); assert.equal(rows[0].fallbackDetected, false); }
  }
});


test('record-trace preserves legacy launch ledger bytes and readable rows', async () => {
  const { launchLedgerPath, readLaunchLedger } = await import('../src/global/team/launch-ledger.js');
  const home = mkdtempSync(join(tmpdir(), 'trace-legacy-'));
  const root = process.cwd(), path = launchLedgerPath(home, root);
  const row = { at: '2020-01-01T00:00:00.000Z', role: 'Builder', agent: 'team-builder', adapterId: 'codex', modelId: 'legacy', source: 'launch' };
  const original = Buffer.from(JSON.stringify(row) + '\n');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, original);
  const payload = { routingDecision: { kind: 'valid' }, selectedProvider: 'codex', selectedModel: 'gpt', effectiveLaunch: { provider: 'codex', model: 'gpt' } };
  const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-trace', '--payload', JSON.stringify(payload), '--cwd', root], { env: { ...process.env, HOME: home, HARNESS_HOME: home }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(path), original);
  assert.deepEqual(await readLaunchLedger(home, root, 'Builder'), [{ adapterId: 'codex', modelId: 'legacy', role: 'Builder', status: 'completed', at: Date.parse(row.at) }]);
});

test('team exec traces the switched capacity fallback against the previous model', async () => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const { appendRoutingTrace } = await import('../src/global/team/routing-trace.js');
  const { EventEmitter } = await import('node:events');
  const { PassThrough, Readable } = await import('node:stream');
  const home = mkdtempSync(join(tmpdir(), 'trace-switch-')), rows = [];
  let launches = 0;
  const code = await runTeamExecCli({ provider: 'codex', model: 'first', role: 'Builder' }, {
    homeDir: home, resolveRoot: async () => home, stdin: Readable.from(['task']), stdout: { write() {} }, stderr: { write() {} },
    isModelExecutable: async () => true, appendLaunchRecord: async () => {}, appendOutcomeRecord: async () => {},
    nextExecRoute: async () => ({ provider: 'claude', model: { modelId: 'next' } }),
    appendRoutingTrace: async (...args) => rows.push(await appendRoutingTrace(...args)),
    spawn: () => {
      const child = new EventEmitter(), first = launches++ === 0;
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      queueMicrotask(() => { child.stdout.end(first ? '' : 'answer\n'); child.stderr.end(first ? 'ERROR: Selected model is at capacity. Please try a different model.\n' : ''); child.emit('close', first ? 17 : 0, null); });
      return child;
    },
  });
  assert.equal(code, 0);
  assert.equal(launches, 2);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.attempts), [1, 2]);
  assert.deepEqual(rows.map(row => row.outcome), ['failed', 'completed']);
  assert.equal(rows[1].fallbackDetected, true);
  assert.equal(rows[1].selectedProvider, 'codex');
  assert.equal(rows[1].selectedModel, 'first');
  assert.equal(rows[1].effectiveLaunch.provider, 'claude');
  assert.equal(rows[1].effectiveLaunch.model, 'next');
});

test('trace drops null entries and distinguishes Claude full model versions', () => {
  const home = mkdtempSync(join(tmpdir(), 'trace-null-'));
  const payload = { routingDecision: { kind: 'valid' }, selectedProvider: 'claude', selectedModel: 'claude-sonnet-4', effectiveLaunch: { provider: 'claude', model: 'claude-sonnet-5-5' }, candidates: [null, { provider: 'claude', model: 'sonnet' }], rejectionReasons: [null, { reason: 'quota' }], quotaSnapshot: { providers: { claude: { windows: [null, { name: 'week' }] } } } };
  const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-trace', '--payload', JSON.stringify(payload), '--cwd', process.cwd()], { env: { ...process.env, HOME: home, HARNESS_HOME: home }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const row = JSON.parse(readFileSync(walk(home).find(p => p.endsWith('/routing-trace.jsonl')), 'utf8'));
  assert.equal(row.fallbackDetected, true);
  assert.equal(row.candidates.length, 1); assert.equal(row.rejectionReasons.length, 1); assert.equal(row.quotaSnapshot.providers.claude.windows.length, 1);
});


test('trace lock is bounded and busy writes no row', async () => {
  const { routingTracePath } = await import('../src/global/team/routing-trace.js');
  const home = mkdtempSync(join(tmpdir(), 'trace-lock-'));
  const path = routingTracePath(home, process.cwd());
  mkdirSync(path + '.lock', { recursive: true });
  const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-trace', '--payload', '{}', '--cwd', process.cwd()], { env: { ...process.env, HOME: home, HARNESS_HOME: home }, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Routing trace is busy/);
  assert.equal(result.stdout, '');
  assert.throws(() => readFileSync(path));
});

test('invalid evidence and empty role remain unknown', async () => {
  const { runRecordTraceCli, routingTracePath } = await import('../src/global/team/routing-trace.js');
  const home = mkdtempSync(join(tmpdir(), 'trace-evidence-'));
  await runRecordTraceCli({ payload: JSON.stringify({ role: '', effectiveLaunch: { evidence: 'bogus' } }) }, { homeDir: home, resolveRoot: async () => home });
  const row = JSON.parse(readFileSync(routingTracePath(home, home), 'utf8'));
  assert.equal(row.role, 'unknown'); assert.equal(row.effectiveLaunch.evidence, 'unknown');
});

test('exec records only after close and preserves failures', async () => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const { EventEmitter } = await import('node:events');
  const { PassThrough, Readable } = await import('node:stream');
  for (const mode of ['success', 'failure', 'spawn', 'trace', 'validation']) {
    const home = mkdtempSync(join(tmpdir(), 'trace-exec-evidence-')), rows = [], out = [], err = [];
    let closed = false, spawned = false;
    const code = await runTeamExecCli({ provider: 'codex', model: mode === 'validation' ? '' : 'gpt-test', noRecord: true }, {
      homeDir: home, resolveRoot: async () => home, stdin: Readable.from(['task']), stdout: { write: x => out.push(String(x)) }, stderr: { write: x => err.push(String(x)) }, isModelExecutable: async () => true,
      appendRoutingTrace: async (_h, _r, row) => { assert.ok(closed || mode === 'spawn'); rows.push(row); if (mode === 'trace') throw new Error('trace unavailable'); },
      spawn: () => { spawned = true; if (mode === 'spawn') throw new Error('spawn failed'); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); queueMicrotask(() => { child.stdout.end('answer\n'); child.stderr.end(); closed = true; child.emit('close', mode === 'failure' ? 3 : 0, null); }); return child; },
    });
    if (mode === 'validation') { assert.equal(spawned, false); assert.equal(rows.length, 0); continue; }
    assert.equal(spawned, true); assert.equal(code, mode === 'failure' ? 3 : mode === 'spawn' ? 1 : 0);
    assert.equal(out.join(''), mode === 'spawn' ? '' : 'answer\n');
    assert.equal(rows[0].effectiveLaunch.evidence, mode === 'spawn' ? 'requested' : mode === 'failure' ? 'dispatched' : 'confirmed');
    assert.equal(rows[0].outcome, mode === 'failure' || mode === 'spawn' ? 'failed' : 'completed');
    assert.equal(rows[0].attempts, 1);
    if (mode === 'trace') assert.match(err.join(''), /Routing trace recording failed: trace unavailable/);
  }
});

test('exec starts before a busy trace lock and preserves its result', async () => {
  const { runTeamExecCli } = await import('../src/global/team/team-exec.js');
  const { routingTracePath } = await import('../src/global/team/routing-trace.js');
  const { EventEmitter } = await import('node:events');
  const { PassThrough, Readable } = await import('node:stream');
  const home = mkdtempSync(join(tmpdir(), 'trace-exec-lock-'));
  mkdirSync(routingTracePath(home, home) + '.lock', { recursive: true });
  const output = [], errors = []; let closed = false;
  const code = await runTeamExecCli({ provider: 'codex', model: 'gpt-test', noRecord: true }, {
    homeDir: home, resolveRoot: async () => home, stdin: Readable.from(['task']), stdout: { write: x => output.push(String(x)) }, stderr: { write: x => errors.push(String(x)) }, isModelExecutable: async () => true,
    spawn: () => { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); queueMicrotask(() => { child.stdout.end('answer\n'); child.stderr.end(); closed = true; child.emit('close', 0, null); }); return child; },
  });
  assert.equal(closed, true); assert.equal(code, 0); assert.equal(output.join(''), 'answer\n');
  assert.match(errors.join(''), /Routing trace recording failed: Routing trace is busy/);
  assert.throws(() => readFileSync(routingTracePath(home, home)));
});


test('stale trace locks are recovered or fail bounded through CLI', async t => {
  const { routingTracePath } = await import('../src/global/team/routing-trace.js');
  for (const blocked of [true, false]) {
    const home = mkdtempSync(join(tmpdir(), 'trace-stale-'));
    const path = routingTracePath(home, process.cwd()), lock = path + '.lock';
    mkdirSync(lock, { recursive: true });
    if (blocked) writeFileSync(join(lock, 'held'), 'held');
    utimesSync(lock, new Date(0), new Date(0));
    const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-trace', '--payload', '{}', '--cwd', process.cwd()], { env: { ...process.env, HOME: home, HARNESS_HOME: home }, encoding: 'utf8' });
    if (blocked) { assert.notEqual(result.status, 0); assert.match(result.stderr, /Routing trace is busy/); assert.throws(() => readFileSync(path)); }
    else { assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(readFileSync(path, 'utf8')).schema, 'kairo.routing-trace/v2'); }
  }
});

test('exec returns child output and status when stale trace lock cannot be removed', async t => {
  const { fixture } = await import('./team-route-fixture.test.js');
  const { routingTracePath } = await import('../src/global/team/routing-trace.js');
  const f = await fixture(t), lock = routingTracePath(f.home, f.cwd) + '.lock';
  await f.cache();
  mkdirSync(lock, { recursive: true }); writeFileSync(join(lock, 'held'), 'held'); utimesSync(lock, new Date(0), new Date(0));
  const bin = join(f.home, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\necho \'{"type":"item.completed","item":{"type":"agent_message","text":"child-output"}}\'\nexit 7\n', { mode: 0o755 });
  const env = { ...process.env, HOME: f.home, HARNESS_HOME: f.home, PATH: bin + ':' + process.env.PATH };
  for (const key of ['KAIRO_HOST', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDECODE', 'OPENCODE_CLIENT']) delete env[key];
  const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'exec', '--cwd', f.cwd, '--provider', 'codex', '--model', 'gpt-a', '--no-record'], { env, input: 'task', encoding: 'utf8' });
  assert.equal(result.status, 7, result.stderr); assert.equal(result.stdout, 'child-output\n'); assert.match(result.stderr, /Routing trace is busy/);
  assert.throws(() => readFileSync(routingTracePath(f.home, f.cwd)));
});

test('hook pacing shape is persisted with unattributed provider windows', () => {
  const home = mkdtempSync(join(tmpdir(), 'trace-pacing-'));
  const quotaSnapshot = { ok: true, generatedAt: '2026-10-23T12:00:00Z', preferredProvider: 'codex', nextWriter: 'team-builder-codex', writerCounts: { claude: 3, codex: 1 }, providers: { claude: { tier: 'CONSERVE', expectedDeadTimeMs: 7200000, windows: [{ name: 'weekly', remainingPercent: 10, resetsAt: '2026-10-24T12:00:00Z', expectedDeadTimeMs: 7200000 }] }, codex: { tier: 'WATCH', expectedDeadTimeMs: 0, windows: [{ name: '5h', remainingPercent: 60, resetsAt: '2026-10-23T14:00:00Z', expectedDeadTimeMs: 0 }] } } };
  const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-trace', '--payload', JSON.stringify({ quotaSnapshot }), '--cwd', process.cwd()], { env: { ...process.env, HOME: home, HARNESS_HOME: home }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const snapshot = JSON.parse(readFileSync(walk(home).find(p => p.endsWith('/routing-trace.jsonl')), 'utf8')).quotaSnapshot;
  assert.equal(snapshot.attribution, 'none'); assert.equal(snapshot.providers.claude.windows[0].remainingPercent, 10); assert.equal(snapshot.providers.codex.windows[0].remainingPercent, 60);
});


test('retention uses injected time and preserves malformed lines in order', async () => {
  const { appendRoutingTrace, routingTracePath } = await import('../src/global/team/routing-trace.js');
  const home = mkdtempSync(join(tmpdir(), 'trace-retention-')), now = 1_800_000_000_000;
  const path = routingTracePath(home, home);
  mkdirSync(dirname(path), { recursive: true });
  const expired = JSON.stringify({ at: new Date(now - 9 * 86400000).toISOString() });
  const recent = JSON.stringify({ at: new Date(now - 86400000).toISOString() });
  writeFileSync(path, [expired, recent, 'malformed', ''].join('\n'));
  const row = await appendRoutingTrace(home, home, {}, { now: () => now });
  assert.deepEqual(readFileSync(path, 'utf8').trimEnd().split('\n'), [recent, 'malformed', JSON.stringify(row)]);
  assert.equal(row.at, new Date(now).toISOString());
});

test('lock retries use bounded fake time and recover removable stale locks', async () => {
  const { appendRoutingTrace, routingTracePath } = await import('../src/global/team/routing-trace.js');
  for (const mode of ['live', 'blocked', 'removable']) {
    const home = mkdtempSync(join(tmpdir(), 'trace-fake-lock-')), path = routingTracePath(home, home), lock = path + '.lock';
    mkdirSync(lock, { recursive: true });
    if (mode === 'blocked') writeFileSync(join(lock, 'held'), 'held');
    const fixedNow = 1_800_000_000_000;
    utimesSync(lock, new Date(mode === 'live' ? fixedNow : 0), new Date(mode === 'live' ? fixedNow : 0));
    let now = fixedNow, delays = 0;
    const start = now, deps = { now: () => now, delay: async ms => { delays++; assert.ok(delays <= 10); now += ms; } };
    if (mode === 'removable') {
      const row = await appendRoutingTrace(home, home, {}, deps);
      assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), row);
      assert.equal(delays, 0);
    } else {
      await assert.rejects(appendRoutingTrace(home, home, {}, deps), /Routing trace is busy/);
      assert.equal(now - start, 200);
      assert.equal(delays, 10);
      assert.throws(() => readFileSync(path));
    }
  }
});

test('hook-emitted trace payload persists its routed metadata', async () => {
  const { appendRoutingTrace, routingTracePath } = await import('../src/global/team/routing-trace.js');
  const home = mkdtempSync(join(tmpdir(), 'trace-hook-integration-'));
  const result = spawnSync('claude', ['plugin', 'test', 'integrations/claude-code/kairo-router'], { env: { ...process.env, HOME: home, HARNESS_HOME: home }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const line = (result.stdout + '\n' + result.stderr).split('\n').find(value => value.startsWith('KAIRO_TRACE_PAYLOAD='));
  assert.ok(line, 'hook test must emit its exact trace payload');
  const payload = JSON.parse(line.slice('KAIRO_TRACE_PAYLOAD='.length));
  await appendRoutingTrace(home, home, payload);
  const row = JSON.parse(readFileSync(routingTracePath(home, home), 'utf8'));
  assert.deepEqual(row.candidates, [{ provider: 'claude', model: 'sonnet' }, { provider: 'codex', model: 'gpt-a' }]);
  assert.deepEqual(row.rejectionReasons, [{ provider: 'codex', model: 'gpt-a', reason: 'quota' }]);
  assert.equal(row.selectionReason, 'selected');
  assert.equal(row.policyVersion.strategyFingerprint, 'strategy-1');
});
