import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { approveProjectTeam } from '../src/global/host/project-team-sidecar.js';
import { createConversationService } from '../src/global/team/service.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROLE_REGISTRY, isModelCompatibleWithRole } from '../src/global/intelligence/role-registry.js';
import { buildAiTeam, buildEfficientTeam, scoreAvailableModels } from '../src/global/intelligence/model-intelligence.js';
import { resolveProjectRoute } from '../src/global/team/project-router.js';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { routeSeat, renderTeamRoutesTree } from '../src/global/team/team-routes-view.js';
import { writeProjectStrategy, writeTeamReform, readTeamReform } from '../src/global/team/project-strategy-store.js';
import { harnessHomePaths } from '../src/global/paths.js';
import { projectKeyForPath } from '../src/global/next/project-key.js';
import { assertCompatibleProjectTeam } from '../src/global/team/project-strategy.js';

const frontier = { adapterId: 'codex', modelId: 'astra', displayName: 'Astra', intelligenceIndex: 60, codingIndex: 95, gpqa: .98, hle: .95, accessMode: 'automatic' };
const ordinary = { ...frontier, adapterId: 'claude', modelId: 'sonnet', displayName: 'Sonnet', intelligenceIndex: 54.2 };
const eligibility = { codex: { ok: true }, claude: { ok: true } };
const routeArgs = { role: 'Technical Lead', strategy: { status: 'active', approvedAt: '2026-11-01T00:00:00Z', projectTeam: [{ role: 'Technical Lead', model: frontier }] }, models: [frontier, ordinary], eligibility, roleCapabilities: { 'Technical Lead': { required: ['reasoning'], optional: [] } } };

// Observable: cell leads and labor refuse frontier, and authority refuses ordinary models.
test('S21 frontier never holds a cell lead or labor seat; authority holds it', () => {
  for (const role of ['Technical Lead', 'Execution Coordinator', 'Quality Lead', 'Builder', 'Delivery Coordinator']) {
    assert.equal(isModelCompatibleWithRole(frontier, role), false, role);
    assert.equal(isModelCompatibleWithRole(ordinary, role), true, role);
  }
  assert.equal(isModelCompatibleWithRole(frontier, 'Frontier Authority'), true);
  assert.equal(isModelCompatibleWithRole(ordinary, 'Frontier Authority'), false);
  assert.equal(ROLE_REGISTRY['Frontier Authority'].permission, 'read-only');
  assert.equal(ROLE_REGISTRY['Frontier Authority'].escalationOnly, true);
  assert.ok(!ROLE_REGISTRY['Frontier Authority'].profile.allowedActionIds.includes('repo.search'));
});

const models = () => scoreAvailableModels([
  { adapterId: 'codex', models: [{ id: 'astra' }, { id: 'terra' }] },
  { adapterId: 'claude', models: [{ id: 'sonnet' }, { id: 'haiku' }] }
], [frontier, ordinary, { ...ordinary, modelId: 'terra', intelligenceIndex: 54.1 }, { ...ordinary, modelId: 'haiku', intelligenceIndex: 53.9 }]
  .map(row => ({ ...row, slug: row.modelId, name: row.modelId })));

// Observable: both public formation policies populate the authority and never spend frontier on routine seats.
test('S21 mixed catalog formation separates authority from routine work', () => {
  const capabilities = Object.fromEntries(['Technical Lead', 'Reviewer', 'Builder', 'Quality Lead', 'Delivery Coordinator', 'Frontier Authority']
    .map(role => [role, { required: ['reasoning'], optional: [] }]));
  for (const build of [pool => buildAiTeam(pool, eligibility, null, capabilities), pool => buildEfficientTeam(pool, eligibility, null, { roleCapabilities: capabilities })]) {
    const team = build(models());
    assert.equal(team.find(row => row.role === 'Frontier Authority')?.primary?.modelId, 'astra');
    for (const row of team.filter(row => !['Frontier Authority', 'Reviewer'].includes(row.role))) {
      assert.ok(row.primary, `${row.role}: ${row.reason}`);
      assert.notEqual(row.primary.modelId, 'astra', row.role);
      assert.notEqual(row.fallback?.modelId, 'astra', row.role);
    }
    assert.equal(team.length, Object.keys(capabilities).length);
  }
});

// Observable: missing qualified tiers remain visible as null assignments with a reason.
test('S21 no qualified seat is hidden or filled with the wrong tier', () => {
  for (const [role, pool] of [['Technical Lead', [frontier]], ['Frontier Authority', [ordinary]]]) {
    const caps = { [role]: { required: ['reasoning'], optional: [] } };
    for (const team of [buildAiTeam(pool, eligibility, null, caps), buildEfficientTeam(pool, eligibility, null, { roleCapabilities: caps })]) {
      assert.equal(team.length, 1);
      assert.equal(team[0].primary, null);
      assert.match(team[0].reason, /qualified|frontier|tier/i);
    }
  }
});

// Observable: approved Astra keeps the same routed decision/provider while the existing migration notice names its replacement.
test('S21 approved frontier lead keeps routing pending explicit re-approval', () => {
  const routed = resolveProjectRoute(routeArgs);
  assert.equal(routed.decision, 'ROUTED');
  assert.equal(routed.provider, 'codex');
  assert.equal(routed.model.modelId, 'astra');
  assert.equal(routed.reapprovalRequired, true);
  assert.match(routed.why, /re-approval/);
  assert.match(routed.why, /Astra.*recommendation: Sonnet/);
  assert.equal(routed.migration.role, 'Technical Lead');
  assert.equal(routed.migration.model, 'Astra');
  assert.match(routed.migration.recommendation, /sonnet/i);
  assert.throws(() => assertCompatibleProjectTeam(routeArgs.strategy, routeArgs.models), /compatible/);
});

// Regression: tier grandfathering never bypasses entitlement or provider availability.
test('S21 entitlement-denied approved frontier assignment still falls back or blocks', () => {
  const denied = { codex: { astra: { status: 'denied' } } };
  const routed = resolveProjectRoute({ ...routeArgs, modelEntitlement: denied });
  assert.equal(routed.decision, 'ROUTED');
  assert.equal(routed.provider, 'claude');
  assert.equal(routed.model.modelId, 'sonnet');
  assert.equal(resolveProjectRoute({ ...routeArgs, models: [frontier], modelEntitlement: denied }).decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.equal(resolveProjectRoute({ ...routeArgs, eligibility: { codex: { ok: false }, claude: { ok: true } } }).provider, 'claude');
});

// Observable: show is advisory, preserves session ownership and stored bytes, and reuses re-approval presentation.
test('S22 team show suggests a non-frontier coordinator without writing assignments', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kairo-tier-home-'));
  const root = await mkdtemp(join(tmpdir(), 'kairo-tier-root-'));
  await writeProjectStrategy(home, root, routeArgs.strategy);
  const file = join(harnessHomePaths(home).sessionsDir, projectKeyForPath(root), 'project-strategy.json');
  const before = await readFile(file);
  await writeTeamReform(home, root, { entries: [{ at: '2026-11-01T00:00:00Z', reasons: [], before: [], after: ['Technical Lead'] }] });
  const reformBefore = await readTeamReform(home, root);
  const deps = { homeDir: home, env: {}, resolveRoot: async () => root,
    getService: async () => ({ pendingTeamProposal: async () => null, snapshot: async () => ({ modelIntelligence: { scoredAll: models(), eligibility } }) }) };
  const logs = [];
  const shown = await runTeamCli({ teamAction: 'show', json: true, cwd: root }, { ...deps, log: line => logs.push(line) });
  assert.equal(shown.ok, true, JSON.stringify(shown));
  assert.equal(shown.suggestedMasterOrchestrator.advisory, true);
  assert.ok(shown.suggestedMasterOrchestrator.model);
  assert.notEqual(shown.suggestedMasterOrchestrator.model.modelId, 'astra');
  assert.equal(shown.reapproval.required, true);
  assert.match(shown.reapproval.seats[0].recommendation, /sonnet|terra|haiku/i);
  assert.deepEqual(await readTeamReform(home, root), reformBefore, 'JSON suggestion writes nothing');
  logs.length = 0;
  await runTeamCli({ teamAction: 'show', cwd: root }, { ...deps, log: line => logs.push(line) });
  assert.match(logs.join('\n'), /advisory.*suggestion|suggestion.*advisory/i);
  assert.match(logs.join('\n'), /re-approval.*|Astra.*recommend/i);
  assert.deepEqual(await readFile(file), before);
  const acknowledged = { ...reformBefore, announcedAt: reformBefore.entries.at(-1).at };
  assert.deepEqual(await readTeamReform(home, root), acknowledged, 'text suggestion only performs the existing acknowledgement');
  const reformFile = join(harnessHomePaths(home).sessionsDir, projectKeyForPath(root), 'team-reform.json');
  const reformBytes = await readFile(reformFile);
  await runTeamCli({ teamAction: 'show', cwd: root }, { ...deps, log: () => {} });
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await readFile(reformFile), reformBytes, 'acknowledged suggestion adds no writes');
  console.log(`Scratch retained: ${home}, ${root}`);
});

// Observable: authority is outside cells, while Delivery has its own lead.
test('S21 routes tree gives authority its own group and Delivery its coordinator', () => {
  const rows = ['Frontier Authority', 'Deliverer', 'Delivery Coordinator'].map(role => ({ role, modelId: 'model', provider: 'codex', decision: 'ROUTED', ...routeSeat(role) }));
  const tree = renderTeamRoutesTree({ orchestrator: { role: 'Master Orchestrator', model: 'session model' }, rows });
  assert.match(tree, /\nFrontier Authority\n/);
  assert.ok(tree.indexOf('Delivery Coordinator') < tree.indexOf('  Deliverer'));
  assert.equal(rows[0].cell, null);
});

// Regression: sidecar re-approval cannot bypass the service's frontier tier gate.
test('S21 sidecar refuses a migrated frontier lead without changing stored strategy', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'kairo-tier-sidecar-home-')));
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kairo-tier-sidecar-root-')));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  await writeProjectStrategy(home, root, { ...routeArgs.strategy, orchestrator: { source: 'host' },
    projectTeam: [{ role: 'Architect', model: frontier }, { role: 'Planner', model: ordinary }] });
  const file = join(harnessHomePaths(home).sessionsDir, projectKeyForPath(root), 'project-strategy.json');
  const before = await readFile(file);
  const previous = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = home;
  try {
    const service = createConversationService({ homeDir: home, resolveRoot: async () => root });
    service.snapshot = async () => ({ modelIntelligence: { scoredAll: models(), eligibility } });
    const result = await approveProjectTeam({ cwd: root, createConversationService: () => service });
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some(reason => /Technical Lead.*not compatible/.test(reason)), JSON.stringify(result));
    assert.deepEqual(await readFile(file), before, 'rejected re-approval preserves stored bytes');
  } finally {
    if (previous === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previous;
  }
  console.log(`Scratch retained: ${home}, ${root}`);
});
