import test from 'node:test';
import assert from 'node:assert/strict';
import { proposalWorld } from './helpers/team-proposal-world.js';
import { loadProjectRoleCatalog } from '../src/global/intelligence/role-catalog.js';

const roles = ['Explorer', 'Architect', 'Debugger (fix)', 'Test Author', 'Docs Writer', 'Refactorer', 'Reviewer', 'Security Reviewer'];
const models = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'claude-sonnet-5-5'].map((modelId, index) => ({
  adapterId: index === 3 ? 'claude' : 'codex', modelId, displayName: modelId,
  intelligenceIndex: 90 - index * 6, codingIndex: 90 - index * 6,
  priceInputPerMTok: [10, 2, 1, .5][index], priceOutputPerMTok: [10, 2, 1, .5][index], accessMode: 'automatic'
}));
const analyst = { model: models[3], selectionSource: 'manual' };

async function analyze({ demandAssessment, catalog, modelRows = models } = {}) {
  const world = proposalWorld({ strategy: null });
  const profile = {
    projectName: 'cap-fixture', fingerprint: 'cap-fixture', stack: ['Node.js'],
    architecture: {}, quality: {}, hotspots: [], workflowCapabilities: [], risks: [],
    roleRequirements: roles.map(role => ({ role, capabilities: ['reasoning', 'coding'], reason: 'fixture' }))
  };
  let calls = 0;
  const service = world.createService({
    now: () => Date.parse('2026-10-23T12:00:00Z'),
    computeProjectProfile: async () => profile,
    probeGentle: async () => ({ state: 'available' }),
    ...(catalog ? { loadProjectRoleCatalog: () => catalog } : {}),
    buildSanitizedSnapshot: async () => ({
      snapshotRoot: '/tmp/offline-cap-snapshot', filesCopied: 1, secretsRedacted: 0,
      copiedFiles: ['src/index.js'], excludedPrivatePaths: [], cleanup: async () => {}
    }),
    createBootstrapAnalyzerAdapter: () => ({
      checkEligibility: async () => ({ eligible: true, isolation: 'verified' }),
      analyze: async () => {
        calls++;
        return { status: 'answered', answer: JSON.stringify({
          architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [],
          workflowNeeds: [], uncertainties: [], evidenceReferences: ['src/index.js'],
          recommendedRoleNeeds: roles.map(role => ({ role, capabilities: ['reasoning', 'coding'],
            reason: 'Required for implementation', evidence: ['src/index.js'] })),
          ...(demandAssessment ? { demandAssessment } : {})
        }) };
      }
    })
  });
  service.snapshot = async () => ({ modelIntelligence: {
    scoredAll: modelRows, eligibility: { codex: { ok: true }, claude: { ok: true } }, registry: null
  } });
  const preflight = await service.preflightProject({ cwd: '/repo' });
  await service.runBootstrapAnalysis({ cwd: '/repo', ...preflight, analyst });
  return { service, store: world.store, calls: () => calls };
}

function assertCap(strategy) {
  const cap = Math.ceil(strategy.projectTeam.length / models.length);
  const loads = new Map();
  for (const entry of strategy.projectTeam) {
    assert.ok(entry.model, `${entry.role} must be assigned`);
    const key = entry.model.modelId;
    const assigned = loads.get(key) ?? [];
    assigned.push(entry);
    loads.set(key, assigned);
  }
  for (const [model, entries] of loads) {
    const exceptions = entries.filter(entry => /only qualified|every qualified model is full/i.test(entry.reason ?? ''));
    assert.ok(entries.length <= cap + exceptions.length, `${model} has ${entries.length} roles, cap ${cap}, explained exceptions ${exceptions.length}`);
  }
}

test('S15/T21: offline analyze persists a capped draft and rebuild preserves assignments', async () => {
  const { service, store, calls } = await analyze();
  const draft = structuredClone(store.strategy);
  assertCap(draft);
  const rebuilt = await service.rebuildProjectTeam({ cwd: '/repo', yes: true });
  assert.equal(rebuilt.changed, false, JSON.stringify(rebuilt.roles));
  assert.deepEqual(rebuilt.phasePlan.idealTeam, draft.projectTeam);
  assert.deepEqual(store.strategy.projectTeam, draft.projectTeam);
  assert.equal(calls(), 1, 'rebuild must not call the analyst');
});

test('S15: rebuild preserves the analyzed Astra assignments instead of silently lowering verified demand', async () => {
  const catalog = loadProjectRoleCatalog({ projectRoot: '/nonexistent-cap-fixture' });
  catalog.registry.Architect = { ...catalog.registry.Architect, floor: .88 };
  const demandAssessment = {
    productPurpose: 'Review an autonomous execution engine.',
    riskCategories: Object.fromEntries(['actionsAndSecurity', 'money', 'personalData', 'realtimeConcurrency', 'aiIntegration', 'domainComplexity']
      .map(name => [name, { level: 5, evidence: ['src/index.js'] }]))
  };
  const modelRows = models.map((model, index) => ({ ...model,
    intelligenceIndex: [90, 64, 62, 61][index], codingIndex: [90, 64, 62, 61][index]
  }));
  const { service, store, calls } = await analyze({ demandAssessment, catalog, modelRows });
  const draft = structuredClone(store.strategy);
  assert.deepEqual(draft.projectTeam.filter(entry => entry.model?.modelId === 'gpt-6-astra').map(entry => entry.role).sort(),
    ['Architect', 'Debugger (fix)', 'Reviewer', 'Security Reviewer'].sort());
  assertCap(draft);
  const rebuilt = await service.rebuildProjectTeam({ cwd: '/repo', yes: true });
  assert.equal(rebuilt.changed, false, JSON.stringify(rebuilt.roles));
  assert.deepEqual(rebuilt.phasePlan.idealTeam, draft.projectTeam);
  assert.deepEqual(store.strategy.projectTeam, draft.projectTeam);
  // A pre-T28 stored analysis has only the summary. Its verified levels
  // still carry the same demand; rebuilding must not reset them to .60.
  delete store.strategy.analysisInputs;
  const legacy = await service.rebuildProjectTeam({ cwd: '/repo', yes: true });
  assert.equal(legacy.changed, false, JSON.stringify(legacy.roles));
  assert.deepEqual(legacy.phasePlan.idealTeam, draft.projectTeam);
  assert.equal(calls(), 1);
});

test('S15: rebuild uses project role metadata even without a demand assessment', async () => {
  const catalog = loadProjectRoleCatalog({ projectRoot: '/nonexistent-cap-fixture' });
  catalog.registry.Architect = { ...catalog.registry.Architect, floor: .88 };
  const { service, store } = await analyze({ catalog });
  const draft = structuredClone(store.strategy);
  assert.equal(draft.projectTeam.find(entry => entry.role === 'Architect').decisionEvidence.requiredFloor, .88);
  const rebuilt = await service.rebuildProjectTeam({ cwd: '/repo', yes: true });
  assert.deepEqual(rebuilt.phasePlan.idealTeam, draft.projectTeam);
});
