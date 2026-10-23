import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parseArgs } from '../src/cli.js';
import { runTeamExecCli } from '../src/global/team/team-exec.js';
import { launchLedgerPath } from '../src/global/team/launch-ledger.js';
import { runTeamCli } from '../src/global/team/team-cli.js';
import claude from '../src/global/hosts/claude-code.js';

async function exec(t, { stdout = '', stderr = '', code = 0, provider = 'codex' } = {}) {
  const home = await mkdtemp(join(tmpdir(), 't33-exec-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const output = [];
  const code_ = await runTeamExecCli({ provider, model: 'gpt-test', cwd: home, noRecord: true }, {
    homeDir: home, resolveRoot: async () => home, stdin: Readable.from(['task']),
    stdout: { write: x => output.push(String(x)) }, stderr: { write: () => {} },
    isModelExecutable: async () => true,
    spawn: () => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      queueMicrotask(() => { child.stdout.end(stdout); child.stderr.end(stderr); child.emit('close', code, null); });
      return child;
    },
  });
  return { code: code_, out: output.join('') };
}
const jsonl = (...texts) => texts.flatMap(text => [
  { type: 'thread.started', thread_id: 'x' },
  { type: 'item.completed', item: { type: 'command_execution', command: 'ls' } },
  { type: 'item.completed', item: { type: 'agent_message', text } },
]).map(JSON.stringify).join('\n') + '\n';

test('T33.1 codex wrapper returns only the final assistant message, not raw JSONL', async t => {
  const r = await exec(t, { stdout: jsonl('working on it', 'final answer') });
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), 'final answer');
});

test('T33.2 usage limit prints status blocked, reason and fallback for re-delegation', async t => {
  const r = await exec(t, { stdout: jsonl('partial'), stderr: 'Error: usage_limit_reached\n', code: 1 });
  assert.match(r.out, /^status: blocked$/m);
  assert.match(r.out, /^reason: .*usage_limit_reached/m);
  assert.match(r.out, /^fallback: kairo-builder$/m);
});

test('T33.3 wrapper text documents final-message and blocked contract and passes the chosen model', () => {
  const { content } = claude.renderWrapperAgent('codex');
  assert.match(content, /--model "\$model"/);
  assert.match(content, /status: blocked/);
  assert.match(content, /fallback: kairo-ROLE/);
});

const row = (modelId, adapterId, at, extra = {}) => ({ source: 'launch', role: 'Builder', agent: 'a', adapterId, modelId, at: new Date(at).toISOString(), ...extra });
test('T33.5 running --summary prints launches per model and provider for today and 7 days', async t => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const home = await mkdtemp(join(tmpdir(), 't33-sum-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = launchLedgerPath(home, home);
  await mkdir(dirname(path), { recursive: true });
  const rows = [...Array(2).fill(row('gpt-6.1-sol', 'codex', now)), row('gpt-6-astra', 'codex', now),
    row('claude-sonnet-5-5', 'claude', now - 2 * 86400000), row('gpt-6.1-sol', 'codex', now - 3 * 86400000),
    row('claude-sonnet-5-5', 'claude', now - 3 * 86400000, { source: 'outcome', status: 'completed' })];
  await writeFile(path, rows.map(JSON.stringify).join('\n') + '\n');
  const lines = [];
  const deps = { homeDir: home, resolveRoot: async () => home, now: () => now, log: l => lines.push(l) };
  assert.equal(parseArgs(['team', 'running', '--summary', '--json']).options.summary, true);
  const result = await runTeamCli({ teamAction: 'running', summary: true, json: true }, deps);
  assert.deepEqual(result.today, [{ modelId: 'gpt-6.1-sol', adapterId: 'codex', launches: 2 }, { modelId: 'gpt-6-astra', adapterId: 'codex', launches: 1 }]);
  assert.equal(result.last7Days.find(r => r.modelId === 'gpt-6.1-sol').launches, 3);
  assert.equal(result.last7Days.find(r => r.modelId === 'claude-sonnet-5-5').launches, 1);
  assert.deepEqual(JSON.parse(lines[0]), result);
  await runTeamCli({ teamAction: 'running', summary: true }, deps);
  assert.match(lines[1], /Today: gpt-6\.1-sol \(codex\) 2, gpt-6-astra \(codex\) 1/);
  assert.match(lines[1], /Last 7 days: gpt-6\.1-sol \(codex\) 3, gpt-6-astra \(codex\) 1, claude-sonnet-5-5 \(claude\) 1/);
});

test('T33.6 kairo-router plugin version is at least 0.3.0', async () => {
  const plugin = JSON.parse(await readFile(new URL('../integrations/claude-code/kairo-router/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  // Every plugin change bumps the version, so pin a floor, not an exact value.
  const [major, minor] = plugin.version.split('.').map(Number);
  assert.ok(major > 0 || minor >= 3, plugin.version);
});
