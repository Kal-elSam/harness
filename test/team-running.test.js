import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parseArgs } from '../src/cli.js';
import { launchLedgerPath } from '../src/global/team/launch-ledger.js';
import { runTeamCli } from '../src/global/team/team-cli.js';
const now = Date.parse('2026-10-23T12:00:00Z');
const launch = (minutes, extra = {}) => ({ source: 'launch', role: 'Explorer', agent: 'team-explorer', adapterId: 'claude', modelId: 'claude-haiku-5-5', at: new Date(now - minutes * 60000).toISOString(), ...extra });
async function fixture(t, rows) {
  const home = await mkdtemp(join(tmpdir(), 'team-running-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = launchLedgerPath(home, home);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, rows.map(JSON.stringify).join('\n') + '\n');
  const output = [];
  return { path, output, deps: { homeDir: home, resolveRoot: async () => home, now: () => now, log: line => output.push(line) } };
}
test('running parser accepts watch/json without changing pacing', () => {
  const { options } = parseArgs(['team', 'running', '--watch', '--json']);
  assert.equal(options.teamAction, 'running');
  assert.equal(options.watch, true);
  assert.equal(options.json, true);
  assert.equal(parseArgs(['team', 'pacing', '--json']).options.teamAction, 'pacing');
});
test('running reports unmatched launches and separates abandoned work', async t => {
  const { output, deps } = await fixture(t, [launch(130, { agent: 'old-explorer' }), launch(3), launch(2), launch(1, { source: 'outcome', status: 'completed' })]);
  const result = await runTeamCli({ teamAction: 'running', json: true }, deps);
  assert.equal(result.running.length, 1);
  assert.equal(result.abandoned.length, 1);
  assert.equal(JSON.parse(output[0]).running[0].modelId, 'claude-haiku-5-5');
  await runTeamCli({ teamAction: 'running' }, deps);
  assert.match(output[1], /Explorer - claude-haiku-5-5 - claude \(team-explorer, 2m\)/);
  assert.match(output[1], /possibly abandoned/);
});
test('watch refreshes every two seconds and reports abandoned launches only once', async t => {
  const { output, deps } = await fixture(t, [launch(130, { agent: 'old-explorer' }), launch(2)]);
  const abort = new AbortController(); let ticks = 0;
  await runTeamCli({ teamAction: 'running', watch: true }, { ...deps, signal: abort.signal, sleep: async ms => {
    assert.equal(ms, 2000); if (++ticks === 2) abort.abort();
  } });
  assert.equal(output.length, 2);
  assert.equal(output.filter(line => line.includes('possibly abandoned')).length, 1);
});
test('outcomes match only their own provider/model and cannot finish later launches', async t => {
  const { deps } = await fixture(t, [launch(4, { source: 'outcome', status: 'failed' }), launch(3), launch(2, { source: 'outcome', status: 'completed', adapterId: 'codex' })]);
  const result = await runTeamCli({ teamAction: 'running', json: true }, deps);
  assert.equal(result.running.length, 1);
});


test('watch does not repeat abandoned notices after ledger compaction', async t => {
  const old = launch(9 * 24 * 60, { agent: 'expired-explorer' });
  const abandoned = launch(130, { agent: 'old-explorer' });
  const { path, output, deps } = await fixture(t, [old, abandoned]);
  const controller = new AbortController(); let ticks = 0;
  await runTeamCli({ teamAction: 'running', watch: true, json: true }, { ...deps, signal: controller.signal, sleep: async () => {
    if (++ticks === 1) await writeFile(path, JSON.stringify(abandoned) + '\n');
    else controller.abort();
  } });
  assert.equal(JSON.parse(output[1]).abandoned.length, 0);
});
