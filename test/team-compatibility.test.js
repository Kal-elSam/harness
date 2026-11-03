// Synthetic AA indices straddle the fixed capability frontier; prices do not classify roles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAiTeam, buildEfficientTeam, cheapestQualifiedAlternative, scoreAvailableModels } from '../src/global/intelligence/model-intelligence.js';
import { buildCompleteCandidateCatalog, buildTeamSelectionPool } from '../src/global/intelligence/model-candidate-catalog.js';
import { providerPriceTiers } from '../src/global/intelligence/price-tier.js';
import { isModelCompatibleWithRole, normalizeRoleDocument } from '../src/global/intelligence/role-registry.js';
import { loadProjectRoleCatalog } from '../src/global/intelligence/role-catalog.js';
import { buildProjectStrategy, qualifiedRolePool, assertCompatibleProjectTeam } from '../src/global/team/project-strategy.js';
import { resolveProjectRoute } from '../src/global/team/project-router.js';
import { harness } from './helpers/setup-harness.js';
import { readTeamRoute, ROUTING_INPUT_CACHE_SCHEMA } from '../src/global/team/routing-input-cache.js';
import { createRoleAptitudeEvidenceStore } from '../src/global/intelligence/role-aptitude-evidence.js';
import { currentProbeForRole } from '../src/global/intelligence/role-aptitude-selection.js';
import { structuralSnapshot } from '../src/global/team/team-recovery.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { runTeamCli } from '../src/global/team/team-cli.js';

const eligibility = { codex: { ok: true }, claude: { ok: true } };
const models = ['codex', 'claude'].flatMap(adapterId => [1, 4, 10].map((price, index) => ({
  adapterId, modelId: `${adapterId}-${index}`, displayName: `${adapterId}-${index}`, accessMode: 'automatic',
  intelligenceIndex: [40, 50, 60][index], codingIndex: 90 + index,
  gpqa: .80 + index * .03, hle: .70 + index * .03,
  priceInputPerMTok: price, priceOutputPerMTok: price
})));
for (let index = 0; index < 4; index++) models.push({ ...models[0], modelId: `low-reference-${index}`, intelligenceIndex: 10 + index, codingIndex: 10 + index });
const requirements = roles => Object.fromEntries(roles.map(role => [role, { required: ['reasoning'] }]));
const build = (mode, rows, roles, options = {}) => mode === 'quality'
  ? buildAiTeam(rows, eligibility, null, requirements(roles), options)
  : buildEfficientTeam(rows, eligibility, null, { roleCapabilities: requirements(roles), ...options });
const active = projectTeam => ({ status: 'active', orchestrator: { source: 'host' }, projectTeam });
const route = (role, team, options = {}) => resolveProjectRoute({ role, strategy: active(team), models, eligibility, ...options });

for (const mode of ['quality', 'efficient']) {
  test(`S3 ${mode}: formation and qualified pools remove incompatible candidates`, () => {
    const labor = ['DevOps', 'Deliverer', 'Documenter', 'Explorer', 'Test Runner', 'Debugger (fix)'];
    const team = build(mode, models, [...labor, 'Architect', 'Security Reviewer', 'Test Designer']);
    const tiers = providerPriceTiers(models);
    for (const entry of team) {
      if (entry.primary) assert.equal(isModelCompatibleWithRole(entry.primary, entry.role, models), true, entry.role);
      if (entry.fallback) assert.equal(isModelCompatibleWithRole(entry.fallback, entry.role, models), true, `${entry.role} fallback`);
    }
    for (const role of [...labor, 'Architect', 'Security Reviewer']) {
      const qualified = qualifiedRolePool({ role, models, eligibility, roleCapabilities: requirements([role]) });
      assert.ok(qualified.pool.length, role);
      for (const model of [...qualified.pool, ...qualified.all]) assert.equal(isModelCompatibleWithRole(model, role, tiers), true, `${role} pool`);
      const alternative = cheapestQualifiedAlternative(models, eligibility, null, {
        role, roleCapabilities: requirements([role]), accept: () => true
      });
      if (alternative) assert.equal(isModelCompatibleWithRole(alternative, role, tiers), true);
    }
    const runtime = route('DevOps', [{ role: 'DevOps', model: models[2] }], { pool: models });
    assert.equal(runtime.decision, 'ROUTED');
    assert.equal(isModelCompatibleWithRole(runtime.model, 'DevOps', tiers), true);
  });
}

test('S3 custom roles inherit Architect and Security Reviewer restrictions through the project catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 't2-catalog-'));
  console.log(`scratch: ${root}`);
  await mkdir(join(root, '.kairo'));
  await writeFile(join(root, '.kairo/roles.json'), JSON.stringify({ roles: [
    { id: 'Custom Architect', description: 'Project architecture', extends: 'Architect' },
    { id: 'Custom Security', description: 'Project security', extends: 'Security Reviewer' }
  ] }));
  const roleCatalog = loadProjectRoleCatalog({ projectRoot: root });
  assert.deepEqual(roleCatalog.warnings, []);
  for (const role of ['Custom Architect', 'Custom Security']) {
    assert.equal(isModelCompatibleWithRole(models[0], role, providerPriceTiers(models), roleCatalog.registry), true);
    assert.equal(isModelCompatibleWithRole(models[2], role, providerPriceTiers(models), roleCatalog.registry), true);
    const pool = qualifiedRolePool({ role, models, eligibility, roleCapabilities: requirements([role]), roleCatalog });
    assert.ok(pool.pool.length);
    assert.ok(pool.pool.every(model => isModelCompatibleWithRole(model, role, null, roleCatalog.registry)));
    const result = route(role, [{ role, model: models[0] }], { roleCatalog, pool: models });
    assert.equal(result.decision, 'ROUTED');
    assert.equal(isModelCompatibleWithRole(result.model, role, models, roleCatalog.registry), true);
  }
});

test('S5 incompatible cross-provider review fails with a typed reason; admission never degrades', () => {
  // Claude's frontier is unscored: Security Reviewer has no compatible executable peer.
  const rows = models.map(model => model.adapterId === 'claude'
    ? { ...model, evidenceStatus: 'unscored', intelligenceIndex: null, codingIndex: null } : model);
  const profile = { fingerprint: 't2', roleRequirements: ['Backend Builder', 'Security Reviewer'].map(role => ({ role, capabilities: ['reasoning'] })) };
  assert.throws(() => buildProjectStrategy(profile, { scoredAll: rows, eligibility }, { model: models[0] }),
    error => error.code === 'reviewer_independence' && /Security Reviewer.*different provider/i.test(error.message));
  const team = [
    { role: 'Backend Builder', model: models[0] }, { role: 'Frontend Builder', model: models[3] },
    { role: 'Reviewer', model: models[2] }
  ];
  const result = route('Reviewer', team, { pool: models, samples: [{ provider: 'codex', role: 'Reviewer', cost: 1 }], ledger: [],
    providerCapacity: { codex: { quotaRemainingPercent: 100 }, claude: { quotaRemainingPercent: 100 } } });
  // S1/S6: unknown Claude quota is not exhaustion, so the independent review is routed instead of waiting; S5 still holds (never the Builder provider).
  // S4: Backend and Frontend Builder merge into one Builder on read, so Claude is the only independent review provider.
  assert.equal(result.decision, 'ROUTED');
  assert.equal(result.assignmentSource, 'independent-review');
  assert.equal(result.provider, 'claude');
  assert.notEqual(result.provider, 'codex');
});

test('S4/S3 migrated frontier Test Repro Runner is reassigned by stored-analysis reform without read writes', async () => {
  const inherited = { ...models[0], modelId: 'legacy-tester', displayName: 'Legacy Tester', intelligenceIndex: 100, codingIndex: 100,
    priceInputPerMTok: null, priceOutputPerMTok: null, costPerTask: .01 };
  const strategy = normalizeRoleDocument({ ...active([{ role: 'Tester', model: inherited }]),
    roleCapabilities: requirements(['Tester']), bootstrapAnalyst: models[2], profileFingerprint: 'fp-1' });
  const h = await harness({ strategy, serviceDeps: { computeProjectProfile: async () => ({ fingerprint: 'fp-1',
    roleRequirements: ['Quality Lead', 'Test Repro Runner'].map(role => ({ role, capabilities: ['reasoning'] })) }) } });
  console.log(`scratch: ${h.root}\nscratch: ${h.home}`);
  Object.assign(h.modelIntelligence, { scoredAll: [...models, inherited], manualSelectionScoredPool: [...models, inherited], eligibility });
  const before = JSON.stringify(h.store.strategy);
  const result = await h.service.rebuildProjectTeam({ cwd: h.root });
  assert.equal(result.applied, false);
  assert.equal(JSON.stringify(h.store.strategy), before);
  const designer = result.roles.find(entry => entry.role === 'Test Repro Runner');
  assert.ok(designer.changed);
  assert.notEqual(designer.new.model, null);
  assert.notEqual(designer.new.model, inherited.displayName);
  assert.notEqual(designer.new.model, inherited.modelId);
});

test('S5 approval rejects stored same-provider review without mutating the team', async () => {
  const strategy = { ...active([{ role: 'Backend Builder', model: models[0] }, { role: 'Reviewer', model: models[2] }]), status: 'suggested' };
  const h = await harness({ strategy });
  console.log(`scratch: ${h.root}\nscratch: ${h.home}`);
  Object.assign(h.modelIntelligence, { scoredAll: models, eligibility });
  const before = JSON.stringify(h.store.strategy);
  const result = await h.service.approveProjectStrategy({ cwd: h.root });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /different provider|independent/i);
  assert.equal(JSON.stringify(h.store.strategy), before);
  assert.equal(h.counts.strategyWrites, 0);
});

test('S5 review independence documentation prohibits same-provider degradation', async () => {
  const doc = await readFile(new URL('../docs/cli-reference.md', import.meta.url), 'utf8');
  assert.match(doc, /Reviewer and Security Reviewer must use a different provider than every Builder/);
  assert.match(doc, /reviewer_independence/);
});

for (const teamAction of ['analyze', 'approve', 'routes', 'show']) {
  test(`compatible team preserves kairo team ${teamAction}${teamAction === 'analyze' ? ' preview' : ''}`, async () => {
    const strategy = { ...active([{ role: 'Explorer', model: models[0] }]), status: teamAction === 'approve' ? 'suggested' : 'active' };
    const h = await harness({ git: true, strategy, serviceDeps: { recoverRuns: async () => {} } });
    console.log(`scratch: ${h.root}\nscratch: ${h.home}`);
    Object.assign(h.modelIntelligence, { scoredAll: models, manualSelectionScoredPool: models, eligibility });
    await writeProjectStrategy(h.home, h.root, strategy);
    const before = JSON.stringify(h.store.strategy);
    const output = [];
    const oldExit = process.exitCode;
    let result;
    try {
      process.exitCode = 0;
      result = await runTeamCli({ teamAction, cwd: h.root, ...(teamAction === 'approve' ? { yes: true } : {}), ...(teamAction === 'analyze' ? { analyst: 'codex-2' } : {}) },
        { homeDir: h.home, env: {}, getService: () => h.service, log: line => output.push(line) });
      assert.equal(process.exitCode, 0, output.join('\n'));
    } finally { process.exitCode = oldExit; }
    assert.ok(result);
    assert.ok(output.length);
    assert.equal(h.counts.analyze, 0);
    assert.equal(h.counts.startRun, 0);
    if (teamAction === 'approve') assert.equal(h.store.strategy.status, 'active');
    else assert.equal(JSON.stringify(h.store.strategy), before);
  });
}

for (const role of ['Reviewer', 'Security Reviewer']) {
  test(`S5 ${role}: quota, manual picks, phases and fallbacks cannot select a Builder provider`, () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    const capacity = remaining => ({ quotaRemainingPercent: remaining, quotaWindows: [
      { kind: '5h', remainingPercent: remaining, resetsAt: new Date(now + 3600000).toISOString() },
      { kind: 'weekly', remainingPercent: remaining, resetsAt: new Date(now + 86400000).toISOString() }
    ] });
    const strategy = { ...active([
      { role: 'Backend Builder', model: models[0] },
      { role, model: models[5], fallback: models[2] }
    ]), phasePlan: { phases: [] } };
    const result = resolveProjectRoute({ role, strategy, models, eligibility, pool: [models[2], models[5]],
      samples: [{ provider: 'claude' }], ledger: [], now,
      manualPick: { adapterId: 'codex', model: models[2].modelId },
      providerCapacity: { codex: capacity(100), claude: capacity(0) } });
    assert.equal(result.decision, 'WAIT_FOR_PROJECT_TEAM');
    assert.equal(result.model, null);
    assert.ok(result.admission.candidates.every(candidate => candidate.provider !== 'codex'));
  });
}

test('S3 routing permits qualified non-frontier Technical Leads across providers', () => {
  const result = route('Technical Lead', [{ role: 'Technical Lead', model: models[2] }], {
    roleCapabilities: requirements(['Technical Lead']),
    providerCapacity: { codex: { quotaRemainingPercent: 0 }, claude: { quotaRemainingPercent: 100 } }
  });
  assert.equal(result.decision, 'ROUTED');
  assert.equal(result.model.modelId, models[3].modelId);
});

test('S5 automatic reform cannot carry an old same-provider review override into activation', async () => {
  const strategy = { ...active([
    { role: 'Backend Builder', model: models[0], assignmentSource: 'override', overrideEvidence: models[0] },
    { role: 'Reviewer', model: models[2], assignmentSource: 'override', overrideEvidence: models[2] }
  ]), approvedAt: '2026-10-29T12:00:00.000Z', roleCapabilities: requirements(['Backend Builder','Reviewer']),
    bootstrapAnalyst: models[2], profileFingerprint: 'fp-1',
    structure: structuralSnapshot({ roles: ['Backend Builder','Reviewer'], teamProviders: ['codex'], eligibility, models: models.slice(0,3) }) };
  const h = await harness({ strategy });
  console.log(`scratch: ${h.root}\nscratch: ${h.home}`);
  Object.assign(h.modelIntelligence, { scoredAll: models, manualSelectionScoredPool: models, eligibility });
  const before = JSON.stringify(h.store.strategy);
  await assert.rejects(() => h.service.reformTeamOnStructuralChange({ projectRoot: h.root }),
    error => error.code === 'reviewer_independence');
  assert.equal(JSON.stringify(h.store.strategy), before);
  assert.equal(h.counts.strategyWrites, 0);
});

for (const role of ['Architect', 'Security Reviewer', 'Explorer', 'DevOps', 'Documenter', 'Deliverer']) {
  test(`routes preserve compatible ${role} explanation without unrelated build warnings`, () => {
    const model = ['Architect', 'Security Reviewer'].includes(role) ? models[2] : models[0];
    const result = route(role, [{ role, model }]);
    assert.equal(result.decision, 'ROUTED');
    assert.equal(result.model.modelId, model.modelId);
    assert.doesNotMatch(result.why, /Build roles exclude/);
  });
}

test('S3 Debugger (fix) never executes its stored frontier assignment', () => {
  const result = route('Debugger (fix)', [{ role: 'Debugger (fix)', model: models[2] }], { pool: [models[2]], samples: [{provider: 'codex'}], ledger: [] });
  // S6: a compatible non-frontier alternative is admissible, so there is no WAIT; S3 still holds: the frontier assignment is never executed.
  assert.equal(result.decision, 'ROUTED');
  assert.notEqual(result.model.modelId, models[2].modelId);
  assert.equal(isModelCompatibleWithRole(result.model, 'Debugger (fix)', providerPriceTiers(models)), true);
});

test('S15 unpriced capable models qualify without cost evidence', () => {
  const rows = models.slice(0, 3).map(m => ({ ...m, priceInputPerMTok: null, priceOutputPerMTok: null }));
  const pool = qualifiedRolePool({ role: 'Architect', models: rows, eligibility, roleCapabilities: requirements(['Architect']) });
  assert.ok(pool.all.some(m => m.modelId === rows[2].modelId));
  assert.equal(build('quality', rows, ['Architect'])[0]?.primary?.modelId, rows[2].modelId);
});

test('S3 single-price provider can fill Architect on capability', () => {
  const rows = [models[2]];
  assert.equal(build('quality', rows, ['Architect'])[0]?.primary?.modelId, rows[0].modelId);
});

test('S15 AA-unmatched models remain visible with capability_unverified warning', () => {
  const catalogs = [{ adapterId: 'codex', models: [{ id: 'not-in-aa' }] }];
  const rows = buildTeamSelectionPool(scoreAvailableModels(catalogs, []), buildCompleteCandidateCatalog(catalogs, []));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].evidenceStatus, 'unscored');
  assert.ok(rows[0].warnings.includes('capability_unverified'));
  assert.equal(rows[0].intelligenceIndex, null);
  assert.equal(build('quality', rows, ['Architect']).some(r => r.primary?.available), false);
});

test('S5 approval rejects split Builder providers even without a review assignment', () => {
  assert.throws(() => assertCompatibleProjectTeam(active([
    { role: 'Backend Builder', model: models[0] },
    { role: 'Frontend Builder', model: models[3] }
  ]), models), error => error.code === 'reviewer_independence' && /all Builders.*one provider/i.test(error.message));
});

test('S11 Debugger fix WAIT names capability compatibility, not admission cost', () => {
  // S6: with no compatible alternative in the catalog the WAIT remains, and S11 requires it to name compatibility.
  const result = route('Debugger (fix)', [{ role: 'Debugger (fix)', model: models[2] }], {
    models: [models[2]], pool: [models[2]], samples: [{ provider: 'codex' }], ledger: []
  });
  assert.equal(result.decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.match(result.why, /frontier|role.compatib/i);
  assert.doesNotMatch(result.why, /cannot fund/);
});

for (const mode of ['quality', 'efficient']) test(`S5 ${mode}: two providers keep all Builders together and review independent`, () => {
  const team = build(mode, models, ['Backend Builder', 'Frontend Builder', 'Reviewer'], { strictModelCap: true });
  const builders = team.filter(row => row.role.endsWith('Builder')).map(row => row.primary?.adapterId);
  assert.equal(builders.length, 2);
  assert.ok(builders.every(Boolean));
  assert.equal(new Set(builders).size, 1);
  const review = team.find(row => row.role === 'Reviewer');
  assert.ok(review.primary?.available);
  assert.notEqual(review.primary.adapterId, builders[0]);
});

// S5: every labor role that writes code counts as a Builder, so they share one provider and review uses the other.
for (const mode of ['quality', 'efficient']) test(`S5 ${mode}: Refactorer, Debugger (fix) and the split Builders share one provider; review goes to the other`, () => {
  const writers = ['Refactorer', 'Debugger (fix)', 'Frontend Builder', 'Backend Builder'];
  const team = build(mode, models, [...writers, 'Reviewer'], { strictModelCap: true });
  const providers = writers.map(role => team.find(row => row.role === role).primary?.adapterId);
  assert.ok(providers.every(Boolean), JSON.stringify(providers));
  assert.equal(new Set(providers).size, 1, JSON.stringify(providers));
  const review = team.find(row => row.role === 'Reviewer');
  assert.ok(review.primary?.available);
  assert.notEqual(review.primary.adapterId, providers[0]);
});
test('S5 isBuildRole and the registry builder flag agree for every code-writing labor role', async () => {
  const { ROLE_REGISTRY, isBuildRole } = await import('../src/global/intelligence/role-registry.js');
  for (const role of ['Builder', 'Frontend Builder', 'Backend Builder', 'Debugger (fix)', 'Refactorer']) {
    assert.equal(ROLE_REGISTRY[role].builder, true, role);
    assert.equal(isBuildRole(role), true, role);
  }
  for (const [role, entry] of Object.entries(ROLE_REGISTRY)) if (entry.builder) assert.equal(isBuildRole(role), true, role);
});

test('S15 a price peer below the absolute floor is not rescued into the pool', () => {
  const rows = [
    { adapterId: 'codex', modelId: 'weak', intelligenceIndex: 40, codingIndex: 40, priceInputPerMTok: 2, priceOutputPerMTok: 10 },
    { adapterId: 'codex', modelId: 'strong', intelligenceIndex: 58.4, codingIndex: 90, priceInputPerMTok: 10, priceOutputPerMTok: 50 }
  ];
  const pool = qualifiedRolePool({ role: 'Backend Builder', models: rows, eligibility, roleCapabilities: requirements(['Backend Builder']) });
  assert.deepEqual(pool.pool, []);
  assert.deepEqual(pool.all, []);
});

test('S15 a validated local role probe qualifies an AA-unmatched model in the shared pool', () => {
  const model = { adapterId: 'codex', modelId: 'local', evidenceStatus: 'unscored', intelligenceIndex: null };
  const store = createRoleAptitudeEvidenceStore();
  const probe = currentProbeForRole('Explorer');
  store.recordAttempt({ adapterId: 'codex', modelId: 'local', accountKey: 'default', role: 'Explorer',
    probeId: probe.probeId, probeVersion: probe.probeVersion, validatorId: probe.validatorId,
    validatorVersion: probe.validatorVersion, verdict: 'pass', origin: 'operational', executionKind: 'real-bridge' });
  const options = { role: 'Explorer', models: [model], eligibility, roleCapabilities: requirements(['Explorer']) };
  assert.deepEqual(qualifiedRolePool(options).pool, []);
  assert.equal(qualifiedRolePool({ ...options, ownedEvidenceStore: store }).pool[0]?.modelId, 'local');
});

// Valid local-probe assignment: approval accepts it, so live AND cached routing must too (account-bound, legacy-shape safe).
const localModel = { adapterId: 'codex', modelId: 'local', accessMode: 'automatic', utility: 1, evidenceStatus: 'unscored', intelligenceIndex: null };
const probeAttempt = account => { const probe = currentProbeForRole('Explorer');
  return { adapterId: 'codex', modelId: 'local', accountKey: account, role: 'Explorer', probeId: probe.probeId, probeVersion: probe.probeVersion,
    validatorId: probe.validatorId, validatorVersion: probe.validatorVersion, verdict: 'pass', origin: 'operational', executionKind: 'real-bridge' }; };
const embedded = (shape, account) => { const { adapterId, modelId, executionKind, role, ...rest } = probeAttempt(account);
  return shape === 'baseline' ? { ...rest, cost: null, durationMs: null } : { ...rest, adapterId, modelId, executionKind, cost: null, durationMs: null }; };
const persistEvidence = async (home, attempt) => {
  const { createPersistentRoleAptitudeEvidenceStore } = await import('../src/global/intelligence/role-aptitude-evidence.js');
  const store = await createPersistentRoleAptitudeEvidenceStore({ homeDir: home });
  store.recordAttempt(attempt);
  await store.flush();
};
const probeCases = [['default-account control', 'current', 'default'], ['non-default account', 'current', 'acct-a'], ['baseline persisted shape', 'baseline', 'default'], ['baseline shape, non-default account', 'baseline', 'acct-a']];
for (const [name, shape, account] of probeCases) {
  const strategyFor = approvedAt => ({ status: 'active', approvedAt, profileFingerprint: 'fp', roleCapabilities: requirements(['Explorer']),
    projectTeam: [{ role: 'Explorer', model: localModel, assignmentSource: 'recommended', decisionEvidence: { ownedEvidence: embedded(shape, account) } }] });
  test(`S15 live routing keeps a valid local-probe assignment: ${name}`, async () => {
    const { createConversationService } = await import('../src/global/team/service.js');
    const store = createRoleAptitudeEvidenceStore();
    store.recordAttempt(probeAttempt(account));
    const strategy = strategyFor(new Date().toISOString());
    const service = createConversationService({ homeDir: '/unused', resolveRoot: async () => '/repo', readProjectStrategy: async () => strategy,
      listRunRecords: async () => [], ownedEvidenceStore: store, ownedEvidenceAccountKey: account });
    service.snapshot = async () => ({ modelIntelligence: { eligibility, scoredAll: [localModel], providerCapacity: {} } });
    const route = await service.routeProjectExecution('Explorer', '/repo');
    assert.equal(route.decision, 'ROUTED', JSON.stringify(route));
    assert.equal(route.model.modelId, 'local');
  });
  test(`S15 cached routing keeps a valid local-probe assignment: ${name}`, async () => {
    const h = await harness();
    const now = Date.now();
    const strategy = strategyFor(new Date(now).toISOString());
    await persistEvidence(h.home, probeAttempt(account));
    const cache = { schema: ROUTING_INPUT_CACHE_SCHEMA, generatedAt: now, approvedAt: strategy.approvedAt, models: [localModel],
      roles: { Explorer: { pool: [localModel] } }, eligibility, modelEntitlement: {}, providerCapacity: {} };
    const result = await readTeamRoute({ role: 'Explorer', homeDir: h.home, cwd: h.root, activeHost: 'codex' }, {
      now: () => now, readUsageSamples: async () => [], readManualPicks: async () => ({}), ownedEvidenceAccountKey: account,
      snapshot: { projectRoot: h.root, strategy, cache, teamProviders: ['codex', 'claude'], records: [], launches: [] }
    });
    assert.equal(result.decision, 'ROUTED', JSON.stringify(result));
    assert.equal(result.model.modelId, 'local');
  });
}

const legacyStrategy = approvedAt => ({ status: 'active', approvedAt, profileFingerprint: 'fp', roleCapabilities: requirements(['Explorer']),
  projectTeam: [{ role: 'Explorer', model: localModel, assignmentSource: 'recommended', decisionEvidence: { ownedEvidence: embedded('baseline', 'default') } }] });
const cachedExplorer = async (h, strategy, now, account, extraDeps = {}) => {
  const cache = { schema: ROUTING_INPUT_CACHE_SCHEMA, generatedAt: now, approvedAt: strategy.approvedAt, models: [localModel],
    roles: { Explorer: { pool: [localModel] } }, eligibility, modelEntitlement: {}, providerCapacity: {} };
  return readTeamRoute({ role: 'Explorer', homeDir: h.home, cwd: h.root, activeHost: 'codex' }, {
    now: () => now, readUsageSamples: async () => [], readManualPicks: async () => ({}), ownedEvidenceAccountKey: account, ...extraDeps,
    snapshot: { projectRoot: h.root, strategy, cache, teamProviders: ['codex', 'claude'], records: [], launches: [] } });
};
test('S15 a legacy-shaped embedded approval with an empty store and the default account still routes (baseline acceptance)', async () => {
  const h = await harness(); const now = Date.now();
  const strategy = legacyStrategy(new Date(now).toISOString());
  assert.equal((await cachedExplorer(h, strategy, now, 'default')).decision, 'ROUTED');
  const { createConversationService } = await import('../src/global/team/service.js');
  const service = createConversationService({ homeDir: '/unused', resolveRoot: async () => '/repo', readProjectStrategy: async () => strategy, listRunRecords: async () => [] });
  service.snapshot = async () => ({ modelIntelligence: { eligibility, scoredAll: [localModel], providerCapacity: {} } });
  assert.equal((await service.routeProjectExecution('Explorer', '/repo')).decision, 'ROUTED');
});
test('S15 legacy-shaped embedded evidence stays rejected when forged synthetic or bound to another account', async () => {
  for (const patch of [{ origin: 'synthetic' }, { accountKey: 'other-account' }, { verdict: 'fail' }]) {
    const h = await harness(); const now = Date.now();
    const strategy = legacyStrategy(new Date(now).toISOString());
    strategy.projectTeam[0].decisionEvidence.ownedEvidence = { ...strategy.projectTeam[0].decisionEvidence.ownedEvidence, ...patch };
    assert.equal((await cachedExplorer(h, strategy, now, 'default')).decision, 'WAIT_FOR_PROJECT_TEAM', JSON.stringify(patch));
  }
});
test('S15 cached routing never routes on evidence of another account than the live one', async () => {
  const h = await harness(); const now = Date.now();
  const strategy = legacyStrategy(new Date(now).toISOString());
  strategy.projectTeam[0].decisionEvidence.ownedEvidence = embedded('current', 'acct-a');
  await persistEvidence(h.home, probeAttempt('acct-a'));
  assert.equal((await cachedExplorer(h, strategy, now, 'acct-a')).decision, 'ROUTED');
  assert.equal((await cachedExplorer(h, strategy, now, 'acct-b')).decision, 'WAIT_FOR_PROJECT_TEAM');
});
test('S15 cached routing cannot resurrect a below-floor price peer', async () => {
  const h = await harness();
  console.log(`scratch: ${h.root}\nscratch: ${h.home}`);
  const now = Date.now();
  const strategy = { ...active([{ role: 'Builder', model: models[2] }]), approvedAt: new Date(now).toISOString(),
    roleCapabilities: requirements(['Builder']) };
  const weak = { ...models[0], gpqa: null, hle: null, intelligenceIndex: 30, codingIndex: 30 };
  const cache = { schema: ROUTING_INPUT_CACHE_SCHEMA, generatedAt: now, approvedAt: strategy.approvedAt,
    models: [weak, models[2]], roles: { Builder: { pool: [] } }, eligibility,
    modelEntitlement: {}, providerCapacity: {} };
  const result = await readTeamRoute({ role: 'Builder', homeDir: h.home, cwd: h.root, activeHost: 'codex' }, {
    now: () => now, readUsageSamples: async () => [], readManualPicks: async () => ({}),
    snapshot: { projectRoot: h.root, strategy, cache, teamProviders: ['codex','claude'], records: [], launches: [] }
  });
  assert.equal(result.decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.equal(result.model, null);
  const before = JSON.stringify({ strategy, cache });
  await assert.rejects(() => readTeamRoute({ role: 'Builder', provider: 'codex', homeDir: h.home, cwd: h.root, activeHost: 'codex' }, {
    now: () => now, readUsageSamples: async () => [], readManualPicks: async () => ({}),
    snapshot: { projectRoot: h.root, strategy, cache, teamProviders: ['codex', 'claude'], records: [], launches: [] }
  }), error => error.code === 'unqualified_provider');
  assert.equal(JSON.stringify({ strategy, cache }), before);
});

test('S5 Builder quota substitution cannot cross onto the approved review provider', () => {
  const now = Date.now();
  const capacity = remaining => ({ quotaRemainingPercent: remaining, quotaWindows: [
    { kind: '5h', remainingPercent: remaining, resetsAt: new Date(now + 3600000).toISOString() },
    { kind: 'weekly', remainingPercent: remaining, resetsAt: new Date(now + 86400000).toISOString() }
  ] });
  const result = route('Backend Builder', [
    { role: 'Backend Builder', model: models[0] }, { role: 'Frontend Builder', model: models[1] },
    { role: 'Reviewer', model: models[5] }
  ], { pool: [models[0], models[3]], samples: [{ provider: 'codex' }], ledger: [], now,
    providerCapacity: { codex: capacity(0), claude: capacity(100) } });
  assert.equal(result.decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.equal(result.model, null);
  assert.match(result.why, /Builder|independen/i);
});

test('S15 approval cannot qualify an AA-unmatched assignment without a validated role probe', () => {
  const model = { adapterId: 'codex', modelId: 'not-in-aa', evidenceStatus: 'unscored' };
  assert.throws(() => assertCompatibleProjectTeam(active([{ role: 'Explorer', model }]), [model]),
    error => error.code === 'capability_unverified');
});

test('S15 approval joins catalog-only AA-unmatched identities before validation', async () => {
  const model = { adapterId: 'codex', modelId: 'catalog-only', accessMode: 'automatic' };
  const h = await harness({ strategy: { ...active([{ role: 'Explorer', model }]), status: 'suggested' } });
  console.log(`scratch: ${h.root}\nscratch: ${h.home}`);
  Object.assign(h.modelIntelligence, { scoredAll: [], unscoredModels: [model], eligibility });
  const before = JSON.stringify(h.store.strategy);
  const result = await h.service.approveProjectStrategy({ cwd: h.root });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /capability_unverified/);
  assert.equal(JSON.stringify(h.store.strategy), before);
});


for (const mode of ['quality', 'efficient']) test(`S5 ${mode}: a single configured provider may build and review`, () => {
  const rows = models.filter(model => model.adapterId === 'codex');
  const team = build(mode, rows, ['Backend Builder', 'Reviewer'], { teamProviders: ['codex'] });
  for (const role of ['Backend Builder', 'Reviewer']) {
    assert.equal(team.find(entry => entry.role === role)?.primary?.adapterId, 'codex', role);
  }
});

test('S5 single-provider project formation does not require cross-provider review', () => {
  const profile = { fingerprint: 'single-provider', roleRequirements: ['Backend Builder', 'Reviewer'].map(role => ({ role, capabilities: ['reasoning'] })) };
  const strategy = buildProjectStrategy(profile, { scoredAll: models, eligibility, teamProviders: ['codex'] }, { model: models[0] });
  assert.equal(strategy.projectTeam.find(entry => entry.role === 'Reviewer')?.model?.adapterId, 'codex');
});

test('S5 single-provider approval permits same-provider review', () => {
  const team = active([{ role: 'Backend Builder', model: models[0] }, { role: 'Reviewer', model: models[2] }]);
  assert.doesNotThrow(() => assertCompatibleProjectTeam(team, models, null, null, 'default', ['codex']));
});

test('S5 single-provider routing permits same-provider review', () => {
  const rows = models.filter(model => model.adapterId === 'codex');
  const result = route('Reviewer', [{ role: 'Backend Builder', model: rows[0] }, { role: 'Reviewer', model: rows[2] }], { models: rows, pool: rows, teamProviders: ['codex'] });
  assert.equal(result.decision, 'ROUTED');
  assert.equal(result.model?.adapterId, 'codex');
});


test('S5 two configured providers still require independence when one has no catalog models', () => {
  const rows = models.filter(model => model.adapterId === 'codex');
  const team = [{ role: 'Backend Builder', model: rows[0] }, { role: 'Reviewer', model: rows[2] }];
  assert.throws(() => assertCompatibleProjectTeam(active(team), rows, null, null, 'default', ['codex', 'claude']), error => error.code === 'reviewer_independence');
  const result = route('Reviewer', team, { models: rows, pool: rows, teamProviders: ['codex', 'claude'] });
  assert.equal(result.decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.equal(result.model, null);
  for (const mode of ['quality', 'efficient']) {
    assert.equal(build(mode, rows, ['Backend Builder', 'Reviewer'], { teamProviders: ['codex', 'claude'] }).find(entry => entry.role === 'Reviewer')?.failureCode, 'reviewer_independence');
  }
});


for (const teamProviders of [['codex'], ['codex', 'claude']]) {
  test(`S5 service and cached routing honor configured providers: ${teamProviders.join(',')}`, async () => {
    const rows = models.filter(model => model.adapterId === 'codex');
    const strategy = { ...active([{ role: 'Backend Builder', model: models[0] }, { role: 'Reviewer', model: models[2] }]),
      status: 'suggested', roleCapabilities: requirements(['Backend Builder', 'Reviewer']) };
    const h = await harness({ strategy, serviceDeps: { teamProviders, env: {} } });
    console.log(`scratch: ${h.root}\nscratch: ${h.home}`);
    Object.assign(h.modelIntelligence, { scoredAll: rows, manualSelectionScoredPool: rows, eligibility });
    const before = JSON.stringify(h.store.strategy);
    const approval = await h.service.approveProjectStrategy({ cwd: h.root });
    const singleProvider = teamProviders.length === 1;
    assert.equal(approval.ok, singleProvider, JSON.stringify(approval));
    if (!singleProvider) {
      assert.equal(JSON.stringify(h.store.strategy), before);
      assert.equal(h.counts.strategyWrites, 0);
    }
    h.store.strategy = { ...strategy, status: 'active', approvedAt: new Date().toISOString() };
    const expected = singleProvider ? 'ROUTED' : 'WAIT_FOR_PROJECT_TEAM';
    const live = await h.service.routeProjectExecution('Reviewer', h.root);
    assert.equal(live.decision, expected, JSON.stringify(live));
    const now = Date.now();
    const cache = { schema: ROUTING_INPUT_CACHE_SCHEMA, generatedAt: now, approvedAt: h.store.strategy.approvedAt,
      models: rows, roles: { Reviewer: { pool: rows } }, eligibility, modelEntitlement: {}, providerCapacity: {} };
    const cached = await readTeamRoute({ role: 'Reviewer', homeDir: h.home, cwd: h.root, activeHost: 'codex' }, {
      now: () => now, readUsageSamples: async () => [], readManualPicks: async () => ({}),
      snapshot: { projectRoot: h.root, strategy: h.store.strategy, cache, teamProviders, records: [], launches: [] }
    });
    assert.equal(cached.decision, expected, JSON.stringify(cached));
    assert.equal(live.model?.adapterId ?? null, singleProvider ? 'codex' : null);
    assert.equal(cached.model?.adapterId ?? null, singleProvider ? 'codex' : null);
  });
}


test('S5 a forced cached route cannot move the sole Builder onto the approved review provider', async () => {
  const h = await harness();
  console.log(`scratch: ${h.root}\nscratch: ${h.home}`);
  const now = Date.now();
  const strategy = { ...active([{ role: 'Builder', model: models[0] }, { role: 'Reviewer', model: models[5] }]),
    approvedAt: new Date(now).toISOString(), roleCapabilities: requirements(['Builder', 'Reviewer']) };
  const cache = { schema: ROUTING_INPUT_CACHE_SCHEMA, generatedAt: now, approvedAt: strategy.approvedAt,
    models, roles: { Builder: { pool: [models[2]] } }, eligibility, modelEntitlement: {}, providerCapacity: {} };
  const before = JSON.stringify({ strategy, cache });
  await assert.rejects(() => readTeamRoute({ role: 'Builder', provider: 'claude', homeDir: h.home, cwd: h.root }, {
    now: () => now, readUsageSamples: async () => [], readManualPicks: async () => ({}),
    snapshot: { projectRoot: h.root, strategy, cache, teamProviders: ['codex', 'claude'], records: [], launches: [] }
  }), error => error.code === 'provider_unavailable');
  assert.equal(JSON.stringify({ strategy, cache }), before);
});


test('S4 leader and bounded worker qualify for their own responsibilities without borrowed scores', () => {
  const worker = { adapterId: 'claude', modelId: 'bounded-worker', intelligenceIndex: 40,
    codingIndex: 60, terminalBenchV2: .60, agenticIndex: 60, gpqa: .05, hle: .05 };
  const leader = { adapterId: 'codex', modelId: 'diagnosis-lead', intelligenceIndex: 60,
    codingIndex: 90, terminalBenchV2: .90, agenticIndex: 90, gpqa: .90, hle: .90 };
  const rows = [worker, leader];
  const fixPool = qualifiedRolePool({ role: 'Debugger (fix)', models: rows, eligibility }).pool;
  const diagnosisPool = qualifiedRolePool({ role: 'Debugger (diagnosis)', models: rows, eligibility }).pool;
  assert.ok(fixPool.some(model => model.modelId === worker.modelId));
  assert.ok(!fixPool.some(model => model.modelId === leader.modelId), 'frontier lead must not become the labor worker');
  assert.ok(diagnosisPool.some(model => model.modelId === leader.modelId));
  assert.ok(!diagnosisPool.some(model => model.modelId === worker.modelId), 'leader evidence cannot qualify the worker for diagnosis');
});
