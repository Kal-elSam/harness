// S4 persist new role ids with explicit re-approval (T6/U3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeProjectStrategy, readProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { harnessHomePaths } from '../src/global/paths.js';
import { projectKeyForPath } from '../src/global/next/project-key.js';
import { approveProjectTeam } from '../src/global/host/project-team-sidecar.js';
import { createConversationService } from '../src/global/team/service.js';
import { resolveProjectRoute } from '../src/global/team/project-router.js';

const strategyPath = (home, root) => join(harnessHomePaths(home).sessionsDir, projectKeyForPath(root), 'project-strategy.json');
const dirs = [];
test.after(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });

const OPUS = { adapterId: 'claude', modelId: 'opus', displayName: 'Opus' };
const GPT = { adapterId: 'codex', modelId: 'gpt-x', displayName: 'GPT X' };
const APPROVED_AT = '2026-11-01T00:00:00.000Z';
const migrating = [
  { role: 'Architect', model: OPUS },
  { role: 'Planner', model: GPT },
  { role: 'Builder', model: GPT }
];
const modern = [
  { role: 'Technical Lead', model: OPUS },
  { role: 'Builder', model: GPT }
];

async function fixture(projectTeam = migrating) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'kairo-reapproval-home-')));
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kairo-reapproval-root-')));
  dirs.push(home, root);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  await writeProjectStrategy(home, root, { status: 'active', approvedAt: APPROVED_AT, projectTeam });
  const file = strategyPath(home, root);
  const env = { ...process.env, HOME: home, HARNESS_HOME: home, XDG_CONFIG_HOME: join(home, '.config') };
  const cli = (...args) => spawnSync(process.execPath, [resolve('bin/kairo.js'), ...args], { encoding: 'utf8', cwd: root, env });
  return { home, root, file, cli, env };
}

test('S4 team show prints a visible re-approval notice naming the seat, old ids, model and approve command', async () => {
  const h = await fixture();
  const before = await readFile(h.file);
  const shown = h.cli('team', 'show');
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /re-approval/i);
  assert.match(shown.stdout, /Technical Lead/);
  assert.match(shown.stdout, /Architect, Planner/);
  assert.match(shown.stdout, /Opus/);
  assert.match(shown.stdout, /kairo team approve --yes/);
  assert.deepEqual(await readFile(h.file), before, 'no read path rewrites stored bytes');
  assert.match(before.toString(), /"Architect"/, 'stored file keeps the legacy ids until approval');
});

test('S4 team show --json reports the re-approval requirement without printing the notice', async () => {
  const h = await fixture();
  const shown = h.cli('team', 'show', '--json');
  assert.equal(shown.status, 0, shown.stderr);
  const parsed = JSON.parse(shown.stdout);
  assert.equal(parsed.reapproval.required, true);
  assert.deepEqual(parsed.reapproval.seats, [{ role: 'Technical Lead', from: ['Architect', 'Planner'], model: 'Opus' }]);
});

test('S4 team approve preview writes nothing, --yes persists v2 ids and strips both markers', async () => {
  const h = await fixture();
  const before = await readFile(h.file);
  const preview = h.cli('team', 'approve');
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Technical Lead/);
  assert.deepEqual(await readFile(h.file), before, 'preview writes nothing');

  const approved = h.cli('team', 'approve', '--yes');
  assert.equal(approved.status, 0, approved.stderr);
  const stored = JSON.parse(await readFile(h.file, 'utf8'));
  assert.deepEqual(stored.projectTeam.map(row => row.role), ['Technical Lead', 'Builder']);
  assert.deepEqual(stored.projectTeam[0].model, OPUS, 'the seat keeps the model it ran on');
  assert.equal(stored.reapprovalRequired, undefined);
  assert.ok(!JSON.stringify(stored).includes('assignmentChanged'));
  assert.ok(!JSON.stringify(stored).includes('"migration"'));
  assert.equal(stored.status, 'active');
  assert.equal(stored.approvedAt, APPROVED_AT, 'routing caches stay bound to the approval');
  assert.ok(Date.parse(stored.reapprovedAt) > Date.parse(APPROVED_AT));

  const after = h.cli('team', 'show');
  assert.equal(after.status, 0, after.stderr);
  assert.doesNotMatch(after.stdout, /re-approval/i);
  assert.deepEqual(JSON.parse(h.cli('team', 'show', '--json').stdout).reapproval, undefined);
});

test('S4 the sidecar approve path persists v2 ids and strips both markers', async () => {
  const h = await fixture();
  const previous = { HOME: process.env.HOME, HARNESS_HOME: process.env.HARNESS_HOME };
  process.env.HOME = h.home; process.env.HARNESS_HOME = h.home;
  try {
    const summary = await approveProjectTeam({ cwd: h.root });
    assert.equal(summary.state, 'active');
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  const stored = JSON.parse(await readFile(h.file, 'utf8'));
  assert.deepEqual(stored.projectTeam.map(row => row.role), ['Technical Lead', 'Builder']);
  assert.equal(stored.reapprovalRequired, undefined);
  assert.ok(!JSON.stringify(stored).includes('assignmentChanged'));
});

test('S4 routing never blocks on reapprovalRequired', async () => {
  const h = await fixture();
  const strategy = await readProjectStrategy(h.home, h.root);
  assert.equal(strategy.reapprovalRequired, true);
  const route = resolveProjectRoute({
    role: 'Technical Lead', strategy,
    eligibility: { claude: { ok: true }, codex: { ok: true } },
    models: [{ ...OPUS, intelligenceIndex: 40 }]
  });
  assert.notEqual(route.decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.equal(route.model?.modelId, 'opus', 'the seat runs on the highest-demand old pick');
});

test('S4 unmigrated teams print no notice and keep refusing approval as before', async () => {
  const h = await fixture(modern);
  const shown = h.cli('team', 'show');
  assert.equal(shown.status, 0, shown.stderr);
  assert.doesNotMatch(shown.stdout, /re-approval/i);
  const before = await readFile(h.file);
  const approve = h.cli('team', 'approve', '--yes');
  assert.equal(approve.status, 1);
  assert.match(approve.stdout, /Team is not a draft/);
  assert.deepEqual(await readFile(h.file), before);
});

test('S4 service.approveProjectStrategy persists an approved draft without reapproval or migration markers', async () => {
  const model = { adapterId: 'codex', modelId: 'gpt-6-terra', displayName: 'GPT-6 Terra', accessMode: 'automatic' };
  let stored = {
    schema: 'kairo.project-strategy/v1', status: 'suggested', profileFingerprint: 'fp-1', bootstrapAnalyst: model, orchestrator: model,
    reapprovalRequired: true,
    projectTeam: [{ role: 'Technical Lead', model, assignmentState: 'ready', assignmentSource: 'recommended', migration: { from: ['Architect', 'Planner'], assignmentChanged: true } }]
  };
  let written = null;
  const service = createConversationService({
    resolveRoot: async () => '/repo', homeDir: '/home/test',
    readProjectStrategy: async () => stored,
    writeProjectStrategy: async (homeDir, projectRoot, strategy) => { written = JSON.parse(JSON.stringify(strategy)); stored = strategy; return strategy; }
  });
  const approved = await service.approveProjectStrategy({ cwd: '/repo' });
  assert.equal(approved.ok, true);
  assert.equal(approved.status, 'active');
  assert.equal(written.reapprovalRequired, undefined);
  assert.ok(!JSON.stringify(written).includes('assignmentChanged'));
  assert.equal(written.projectTeam[0].role, 'Technical Lead');
  assert.equal(approved.reapprovalRequired, undefined);
});

const sha = async file => createHash('sha256').update(await readFile(file)).digest('hex');

test('S4 team route --role never rewrites a migrated legacy strategy file', async () => {
  const h = await fixture();
  const before = await sha(h.file);
  for (const role of ['Technical Lead', 'Builder', 'Architect', 'Quality Lead']) {
    h.cli('team', 'route', '--role', role);
    assert.equal(await sha(h.file), before, `route --role ${role} must not write the stored strategy`);
  }
  assert.match(await readFile(h.file, 'utf8'), /"Architect"/, 'legacy ids stay stored until approval');
});

test('S4 a second team approve --yes refuses and leaves the file untouched', async () => {
  const h = await fixture();
  const first = h.cli('team', 'approve', '--yes');
  assert.equal(first.status, 0, first.stderr);
  const afterFirst = await sha(h.file);
  const second = h.cli('team', 'approve', '--yes');
  assert.equal(second.status, 1);
  assert.match(`${second.stdout}${second.stderr}`, /Team is not a draft\. Run kairo team show\./);
  assert.equal(await sha(h.file), afterFirst);
});

test('S4 a five-seat legacy team re-approves into four v2 seats keeping each model', async () => {
  const REVIEW = { adapterId: 'claude', modelId: 'sonnet', displayName: 'Sonnet' };
  const RUNNER = { adapterId: 'codex', modelId: 'gpt-mini', displayName: 'GPT Mini' };
  const h = await fixture([
    { role: 'Architect', model: OPUS },
    { role: 'Planner', model: GPT },
    { role: 'Builder', model: GPT },
    { role: 'Test Runner', model: RUNNER },
    { role: 'Verifier', model: REVIEW }
  ]);
  const approved = h.cli('team', 'approve', '--yes');
  assert.equal(approved.status, 0, approved.stderr);
  const stored = JSON.parse(await readFile(h.file, 'utf8'));
  assert.deepEqual(stored.projectTeam.map(row => row.role), ['Technical Lead', 'Builder', 'Test Repro Runner', 'Quality Lead']);
  const byRole = Object.fromEntries(stored.projectTeam.map(row => [row.role, row.model]));
  assert.deepEqual(byRole['Technical Lead'], OPUS);
  assert.deepEqual(byRole.Builder, GPT);
  assert.deepEqual(byRole['Test Repro Runner'], RUNNER);
  assert.deepEqual(byRole['Quality Lead'], REVIEW);
  assert.equal(stored.approvedAt, APPROVED_AT);
  assert.ok(Date.parse(stored.reapprovedAt) > Date.parse(APPROVED_AT));
  assert.equal(stored.reapprovalRequired, undefined);
  assert.ok(!JSON.stringify(stored).includes('assignmentChanged'));
  assert.ok(!JSON.stringify(stored).includes('"migration"'));
});
