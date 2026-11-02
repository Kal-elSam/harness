import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as roles from '../src/global/intelligence/role-registry.js';
import { providerPriceTiers } from '../src/global/intelligence/price-tier.js';
import { readProjectStrategy, writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { readPendingTeamProposal, writePendingTeamProposal, strategyHash } from '../src/global/team/pending-team-proposal-store.js';
import { harnessHomePaths } from '../src/global/paths.js';
import { projectKeyForPath } from '../src/global/next/project-key.js';
import { loadProjectRoleCatalog } from '../src/global/intelligence/role-catalog.js';

const classes = {
  analysis: ['Architect', 'Security Reviewer', 'Reviewer', 'Planner', 'Test Designer', 'Debugger (diagnosis)'],
  labor: ['Builder', 'Backend Builder', 'Frontend Builder', 'Refactorer', 'DevOps', 'Test Runner', 'Debugger (fix)', 'Deliverer', 'Documenter', 'Explorer'],
  verification: ['Verifier']
};
for (const [kind, ids] of Object.entries(classes)) for (const id of ids) {
  test(`S3 ${id} has explicit ${kind} class`, () => assert.equal(roles.ROLE_REGISTRY[id]?.class, kind));
}
// S4: the pre-v2 ids stay resolvable with their own profile but no longer staff the default team.
for (const id of ['Test Designer', 'Test Runner', 'Debugger (diagnosis)', 'Debugger (fix)']) {
  test(`S4 ${id} keeps its own profile but is a legacy, non-default role`, () => {
    assert.equal(roles.ROLE_REGISTRY[id]?.profile.role, id);
    assert.equal(roles.ROLE_REGISTRY[id]?.defaultTeam, false);
    assert.equal(roles.ROLE_REGISTRY[id]?.catalog, 'legacy');
  });
}
test('S4 registry removes old single roles and keeps orchestrator host-owned', () => {
  for (const id of ['Tester', 'Debugger', 'Orchestrator']) assert.equal(roles.ROLE_REGISTRY[id], undefined);
});
test('S3/S15 compatibility uses capability, never price or configured peers', () => {
  assert.equal(typeof roles.isModelCompatibleWithRole, 'function');
  const worker = { adapterId: 'provider', modelId: 'worker', intelligenceIndex: 40 };
  const frontier = { adapterId: 'provider', modelId: 'thinker', intelligenceIndex: 58.4 };
  const expensive = { ...worker, priceInputPerMTok: 10, priceOutputPerMTok: 50, intelligenceIndex: 49 };
  for (const [kind, ids] of Object.entries(classes)) for (const id of ids) {
    assert.equal(roles.isModelCompatibleWithRole(frontier, id, new Map()), kind !== 'labor', id);
    assert.equal(roles.isModelCompatibleWithRole(worker, id, new Map()), true, id);
  }
  assert.equal(roles.isModelCompatibleWithRole(expensive, 'Builder', providerPriceTiers([worker, expensive])), true);
  assert.equal(roles.isModelCompatibleWithRole(worker, 'missing'), false);
  assert.equal(roles.isModelCompatibleWithRole(null, 'Explorer'), false);
  roles.withRoleCatalog({ registry: { Custom: { class: 'labor' }, Lead: { class: 'coordination' } } }, () => {
    assert.equal(roles.isModelCompatibleWithRole(frontier, 'Custom'), false);
    assert.equal(roles.isModelCompatibleWithRole(worker, 'Custom'), true);
    assert.equal(roles.isModelCompatibleWithRole(frontier, 'Lead'), true);
  });
});

test('S4 persisted active/suggested strategies and pending proposals expand on read without disk writes', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'kairo-role-split-'));
  console.log(`scratch: ${scratch}`);
  const home = join(scratch, 'home');
  const project = join(scratch, 'project');
  const model = { adapterId: 'codex', modelId: 'worker' };
  const legacy = { roleRequirements: [{ role: 'Tester' }, { role: 'Debugger' }], projectTeam: [{ role: 'Tester', model }, { role: 'Debugger', model }], idealTeam: [{ role: 'Tester', model }], efficientTeam: [{ role: 'Debugger', model }] };
  const expected = ['Test Repro Runner', 'Quality Lead', 'Builder', 'Technical Lead'];
  const dir = join(harnessHomePaths(home).sessionsDir, projectKeyForPath(project));
  for (const status of ['active', 'suggested', 'stale']) {
    await writeProjectStrategy(home, project, { ...legacy, status });
    const file = join(dir, 'project-strategy.json');
    const before = await readFile(file, 'utf8');
    const loaded = await readProjectStrategy(home, project, { teamProviders: ['codex', 'claude'] });
    assert.deepEqual(loaded.projectTeam.map(e => e.role), expected);
    assert.deepEqual(loaded.roleRequirements.map(e => e.role), expected);
    assert.deepEqual(loaded.idealTeam.map(e => e.role), expected.slice(0, 2));
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal(strategyHash(loaded), strategyHash(JSON.parse(before)), 'read migration preserves pending base hash identity');
  }
  await writePendingTeamProposal(home, project, { id: 'existing-id', proposal: { ...legacy, status: 'suggested' }, basedOn: { strategyHash: 'existing-base' } });
  const file = join(dir, 'pending-team-proposal.json');
  const before = await readFile(file, 'utf8');
  const pending = await readPendingTeamProposal(home, project);
  assert.deepEqual(pending.proposal.projectTeam.map(e => e.role), expected);
  assert.equal(pending.id, 'existing-id');
  assert.equal(await readFile(file, 'utf8'), before);
});
test('S4 roles.json legacy ids and extends expand through existing catalog loader without disk writes', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'kairo-role-catalog-split-'));
  console.log(`scratch: ${scratch}`);
  await mkdir(join(scratch, '.kairo'));
  const file = join(scratch, '.kairo/roles.json');
  const before = JSON.stringify({ roles: [{ id: 'Tester', agents: ['old-tester'] }, { id: 'Debugger' }, { id: 'Custom', description: 'Custom runner', extends: 'Tester' }] });
  await writeFile(file, before);
  const catalog = loadProjectRoleCatalog({ projectRoot: scratch });
  assert.deepEqual(catalog.warnings, []);
  assert.deepEqual(catalog.registry['Test Repro Runner'].agents, ['old-tester']);
  assert.deepEqual(catalog.registry['Quality Lead'].agents, ['old-tester']);
  assert.equal(catalog.registry.Custom.class, 'labor');
  assert.equal(catalog.registry.Custom.extendsRole, 'Test Repro Runner');
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal(catalog.registry.Tester, undefined);
});

test('S4 design and diagnosis probes are read-only and independently validated', async () => {
  const { listRoleAptitudeProbes } = await import('../src/global/intelligence/role-aptitude-probes.js');
  const { validateProbeAttempt } = await import('../src/global/intelligence/role-aptitude-validators.js');
  for (const role of ['Test Designer', 'Debugger (diagnosis)']) {
    const probe = listRoleAptitudeProbes().find(p => p.role === role);
    assert.ok(probe, role);
    assert.deepEqual(probe.editablePaths, []);
    const empty = await validateProbeAttempt({ probe, structured: {}, expected: {}, snapshotPaths: { changed: [] } });
    assert.equal(empty.ok, false);
  }
});
test('S4 migration is idempotent, preserves explicit modern entries and hashes edits honestly', () => {
  const model = { modelId: 'legacy' };
  const doc = { projectTeam: [{ role: 'Tester', model }, { role: 'Test Repro Runner', model: { modelId: 'explicit' } }] };
  const next = roles.normalizeRoleDocument(doc);
  assert.deepEqual(next.projectTeam.map(e => e.role), ['Quality Lead', 'Test Repro Runner']);
  assert.equal(next.projectTeam[1].model.modelId, 'explicit');
  assert.deepEqual(roles.normalizeRoleDocument(next), next);
  assert.equal(strategyHash(next), strategyHash(doc));
  next.projectTeam[0].model.modelId = 'changed';
  assert.notEqual(strategyHash(next), strategyHash(doc));
});

test('S4 routing accepts legacy singular requests and cache role keys without rewriting either file', async () => {
  const { readRoutingInputCache } = await import('../src/global/team/routing-input-cache.js');
  const { resolveProjectRoute } = await import('../src/global/team/project-router.js');
  const scratch = await mkdtemp(join(tmpdir(), 'kairo-role-route-split-'));
  console.log(`scratch: ${scratch}`);
  const project = join(scratch, 'project');
  const dir = join(harnessHomePaths(scratch).sessionsDir, projectKeyForPath(project));
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'routing-input-cache.json');
  const before = JSON.stringify({ roles: { Tester: { pool: [] }, Debugger: { pool: [] } } });
  await writeFile(file, before);
  assert.deepEqual(Object.keys((await readRoutingInputCache(scratch, project)).roles), ['Test Repro Runner', 'Quality Lead', 'Builder', 'Technical Lead']);
  const model = { adapterId: 'codex', modelId: 'worker', priceInputPerMTok: 1, priceOutputPerMTok: 1 };
  for (const [legacy, modern] of [['Tester', 'Test Repro Runner'], ['Debugger', 'Builder']]) {
    const route = resolveProjectRoute({ role: legacy, strategy: { status: 'active', projectTeam: [{ role: legacy, model }] }, eligibility: { codex: { ok: true } }, activeHost: 'codex' });
    assert.equal(route.role, modern);
    assert.equal(route.model?.modelId, 'worker');
  }
  assert.equal(await readFile(file, 'utf8'), before);
});

test('S4 migration leaves model IDs and arbitrary user data unchanged', () => {
  const doc = { models: [{ id: 'Tester' }, { id: 'Debugger' }], tags: ['Tester'], metadata: { Tester: 'a model label' } };
  assert.deepEqual(roles.normalizeRoleDocument(doc), doc);
  for (const id of ['toString', '__proto__']) assert.deepEqual(roles.roleIdsOnRead(id), [id]);
});
test('S4 explicit approve accepts a legacy pending base and only then persists split roles', async () => {
  const { proposalWorld } = await import('./helpers/team-proposal-world.js');
  const { clearPendingTeamProposal } = await import('../src/global/team/pending-team-proposal-store.js');
  const scratch = await mkdtemp(join(tmpdir(), 'kairo-role-approve-split-'));
  console.log(`scratch: ${scratch}`);
  const model = { adapterId: 'codex', modelId: 'worker' };
  const original = await writeProjectStrategy(scratch, scratch, { status: 'active', projectTeam: [{ role: 'Tester', model }, { role: 'Debugger', model }] });
  await writePendingTeamProposal(scratch, scratch, { id: 'old-proposal', basedOn: { hash: strategyHash(original) }, proposal: { ...original, status: 'suggested' } });
  const file = join(harnessHomePaths(scratch).sessionsDir, projectKeyForPath(scratch), 'project-strategy.json');
  const before = await readFile(file, 'utf8');
  const pending = await readPendingTeamProposal(scratch, scratch);
  const service = proposalWorld().createService({
    readProjectStrategy: () => readProjectStrategy(scratch, scratch),
    writeProjectStrategy: (_home, _project, doc) => writeProjectStrategy(scratch, scratch, doc),
    clearPendingTeamProposal: () => clearPendingTeamProposal(scratch, scratch)
  });
  service.activationBlockers = async () => [];
  assert.equal(await readFile(file, 'utf8'), before);
  const result = await service.approvePendingTeamProposal({ projectRoot: scratch, pending });
  assert.equal(result.outcome, 'approved');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).projectTeam.map(e => e.role), ['Test Repro Runner', 'Quality Lead', 'Builder', 'Technical Lead']);
  assert.equal(await readPendingTeamProposal(scratch, scratch), null);
});

test('S4 normalization preserves reference identity for modern strategies and unchanged model references', () => {
  const model = { adapterId: 'codex', modelId: 'worker' };
  const modern = { projectTeam: [{ role: 'Builder', model }] };
  assert.equal(roles.normalizeRoleDocument(modern), modern);
  const legacy = roles.normalizeRoleDocument({ projectTeam: [{ role: 'Tester', model }] });
  assert.equal(legacy.projectTeam[0].model, model);
  assert.equal(legacy.projectTeam[1].model, model);
});


test('S4 fix execution reuses Builder qualification without weakening diagnosis', async () => {
  const registry = roles.ROLE_REGISTRY;
  const fix = registry['Debugger (fix)'];
  const builder = registry.Builder;
  const diagnosis = registry['Debugger (diagnosis)'];
  assert.deepEqual(fix.capabilities, builder.capabilities);
  assert.deepEqual(fix.metricWeights, builder.metricWeights);
  assert.equal(fix.tier, builder.tier);
  assert.equal(fix.nearEquivalenceBand, builder.nearEquivalenceBand);
  assert.equal(fix.assessmentRaised, builder.assessmentRaised);
  assert.equal(fix.builder, true);
  assert.deepEqual(fix.profile.dependencies, { dependsOn: ['Debugger (diagnosis)'], independentOf: [] });
  assert.equal(diagnosis.tier, 'demanding');
  assert.equal(diagnosis.assessmentRaised, false, 'S4: the raise moved to Technical Lead, which merges diagnosis');
  assert.equal(registry['Technical Lead'].assessmentRaised, true);
  assert.notEqual(diagnosis.builder, true);
  assert.deepEqual(diagnosis.capabilities.required, ['reasoning', 'coding']);
  assert.ok(!diagnosis.profile.allowedActionIds.includes('repo.write'));
  assert.ok(!diagnosis.profile.dependencies.dependsOn.includes('Debugger (diagnosis)'));
  const { roleDemandFloor } = await import('../src/global/intelligence/role-demand.js');
  assert.equal(roleDemandFloor('Debugger (fix)'), roleDemandFloor('Builder'));
  assert.equal(roleDemandFloor('Debugger (diagnosis)'), .60);
});


test('S4 project analysis raises stay with the Technical Lead (diagnosis) instead of the bounded executor', async () => {
  const { roleDemandFloor, projectDemand } = await import('../src/global/intelligence/role-demand.js');
  const demand = projectDemand({ demandAssessment: { categories: { money: { level: 5 } } } });
  assert.equal(roleDemandFloor('Debugger (fix)', demand), roleDemandFloor('Builder', demand));
  assert.equal(demand.floors['Debugger (fix)'], undefined);
  assert.equal(roleDemandFloor('Technical Lead', demand), .65);
});


test('S4 split Builders replace only generic Builder and retain the bounded fix worker', () => {
  const generic = { role: 'Builder', capabilities: ['coding'] };
  const fix = { role: 'Debugger (fix)', capabilities: ['coding'] };
  const frontend = { role: 'Frontend Builder', capabilities: ['coding'] };
  const input = [generic, fix, frontend];
  assert.deepEqual(roles.normalizeBuilderRoles(input), [fix, frontend]);
  assert.deepEqual(input, [generic, fix, frontend]);
});
