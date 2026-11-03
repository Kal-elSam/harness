import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './team-route-fixture.test.js';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { runTeamRouteCli } from '../src/global/team/routing-input-cache.js';
import { readTeamReform, writeTeamReform, markReformAnnounced, unannouncedReform, TEAM_REFORM_SCHEMA } from '../src/global/team/project-strategy-store.js';

const ENTRY = {
  at: '2026-10-26T21:00:00.000Z',
  reasons: [{ kind: 'role_activated', role: 'Deliverer' }],
  before: ['Builder'], after: ['Builder', 'Deliverer']
};

async function withReform(t) {
  const f = await fixture(t);
  await writeTeamReform(f.home, f.cwd, { entries: [ENTRY] });
  const lines = [];
  return { f, lines, log: line => lines.push(line) };
}

test('team show prints one line for a re-form once, then stays quiet; --json exposes the log read-only', async t => {
  const { f, lines, log } = await withReform(t);
  await runTeamCli({ teamAction: 'show', cwd: f.cwd }, { homeDir: f.home, log });
  const notice = lines[0].split('\n').filter(line => /re-formed/i.test(line));
  assert.equal(notice.length, 1);
  assert.match(notice[0], /Deliverer/);
  assert.match(notice[0], /2026-10-26/);
  lines.length = 0;
  await runTeamCli({ teamAction: 'show', cwd: f.cwd }, { homeDir: f.home, log });
  assert.doesNotMatch(lines[0], /re-formed/i);

  lines.length = 0;
  const json = await runTeamCli({ teamAction: 'show', cwd: f.cwd, json: true }, { homeDir: f.home, log });
  assert.deepEqual(json.reform.entries, [ENTRY]);
  assert.deepEqual(JSON.parse(lines[0]).reform.latest, ENTRY);
  assert.equal(lines[0].includes('re-formed'), false, 'json output stays machine readable');
});

test('team route prints the re-form line once on the next call and --json never marks it announced', async t => {
  const { f, lines, log } = await withReform(t);
  await f.cache();
  await runTeamRouteCli({ role: 'Builder', cwd: f.cwd, json: true }, { homeDir: f.home, log });
  assert.equal((await readTeamReform(f.home, f.cwd)).announcedAt, null);
  assert.equal(JSON.parse(lines[0]).reform.at, ENTRY.at);

  lines.length = 0;
  await runTeamRouteCli({ role: 'Builder', cwd: f.cwd }, { homeDir: f.home, log });
  assert.equal(lines.filter(line => /re-formed/i.test(line)).length, 1);
  assert.ok((await readTeamReform(f.home, f.cwd)).announcedAt);

  lines.length = 0;
  await runTeamRouteCli({ role: 'Builder', cwd: f.cwd }, { homeDir: f.home, log });
  assert.equal(lines.filter(line => /re-formed/i.test(line)).length, 0);
});

test('a newer reform remains unannounced when written during notice output', async t => {
  const { f, lines } = await withReform(t);
  const newer = { ...ENTRY, at: '2026-10-26T21:01:00.000Z' };
  let write;
  await runTeamCli({ teamAction: 'show', cwd: f.cwd }, { homeDir: f.home, log: line => {
    lines.push(line);
    write = writeTeamReform(f.home, f.cwd, { entries: [ENTRY, newer] });
  }});
  await write;
  assert.equal((await readTeamReform(f.home, f.cwd)).announcedAt, ENTRY.at);
  const stored = await readTeamReform(f.home, f.cwd);
  assert.deepEqual(stored.entries, [ENTRY, newer]);
  assert.deepEqual(unannouncedReform(stored), newer);
});

test('reform acknowledgement cannot overwrite an in-flight newer reform', async t => {
  const { f } = await withReform(t);
  const newer = { ...ENTRY, at: '2026-10-26T21:01:00.000Z' };
  let stored = { schema: TEAM_REFORM_SCHEMA, entries: [ENTRY], announcedAt: null };
  let releaseWrite;
  const gate = new Promise(resolve => { releaseWrite = resolve; });
  let startedWrite;
  const started = new Promise(resolve => { startedWrite = resolve; });
  const publish = async (_path, doc) => { stored = doc; };
  const writing = writeTeamReform(f.home, f.cwd, { entries: [ENTRY, newer] }, {
    mkdir: async () => { startedWrite(); await gate; }, writeAtomicJson: publish
  });
  await started;
  // The acknowledgement starts while publication is held, not after a timer.
  const marking = markReformAnnounced(f.home, f.cwd, ENTRY, {
    readFile: async () => JSON.stringify(stored), mkdir: async () => {}, writeAtomicJson: publish
  });
  releaseWrite();
  await Promise.all([writing, marking]);
  assert.equal(stored.announcedAt, ENTRY.at);
  assert.deepEqual(stored.entries, [ENTRY, newer]);
  assert.deepEqual(unannouncedReform(stored), newer);
});
