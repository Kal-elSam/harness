import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { harness, draftTeam } from './helpers/setup-harness.js';
import { activateCatalogRoles } from '../src/global/intelligence/role-registry.js';
import { readProjectStrategy, readTeamReform } from '../src/global/team/project-strategy-store.js';
import { structuralSnapshot } from '../src/global/team/project-strategy.js';

test('pending role enters baseline and activation history only after model evidence appears', async t => {
  const signals = { gitRemote: true };
  const profile = () => ({ projectName: 'repo', stack: ['Node.js'], architecture: { pattern: 'x' },
    quality: { buildCommand: null, testCommand: null, lintCommand: null, typeCheckCommand: null },
    hotspots: [], workflowCapabilities: [], risks: [], fingerprint: 'fp-1', signals,
    roleRequirements: activateCatalogRoles([{ role: 'Explorer', capabilities: ['reasoning'], reason: '' }], { signals }) });
  const h = await harness({ git: true, diskStrategy: true, serviceDeps: { recoverRuns: async () => {}, enableProviderProbes: true, computeProjectProfile: async () => profile() } });
  t.after(async () => { await rm(h.root, { recursive: true, force: true }); await rm(h.home, { recursive: true, force: true }); });
  await draftTeam(h);
  await h.service.approveProjectStrategy({ cwd: h.root });
  const initial = await readProjectStrategy(h.home, h.root);
  assert.equal(initial.projectTeam.some(row => row.role === 'Deliverer'), false);
  assert.equal(initial.structure.roles.includes('Deliverer'), false);
  assert.equal((await readTeamReform(h.home, h.root)).entries.some(entry => entry.reasons.some(reason => reason.kind === 'role_activated' && reason.role === 'Deliverer')), false);
  await h.service.refreshRoutingInputs({ cwd: h.root });
  assert.equal((await readTeamReform(h.home, h.root)).entries.some(entry => entry.reasons.some(reason => reason.kind === 'role_activated' && reason.role === 'Deliverer')), false, 'missing role must not be logged as activated');
  assert.equal((await readProjectStrategy(h.home, h.root)).activation?.reasons?.some(reason => reason.kind === 'role_activated' && reason.role === 'Deliverer') ?? false, false, 'missing role must not appear in activation reasons');
  h.modelIntelligence.scoredAll = h.modelIntelligence.scoredAll.map(row => ({ ...row, terminalBenchV2: 0.8, ifBench: 0.9, endToEndSeconds: 10 }));
  h.modelIntelligence.manualSelectionScoredPool = h.modelIntelligence.scoredAll;
  await h.service.refreshRoutingInputs({ cwd: h.root });
  const active = await readProjectStrategy(h.home, h.root);
  assert.ok(active.projectTeam.some(row => row.role === 'Deliverer'));
  assert.ok(active.structure.roles.includes('Deliverer'));
  assert.ok((await readTeamReform(h.home, h.root)).entries.some(entry => entry.reasons.some(reason => reason.kind === 'role_activated' && reason.role === 'Deliverer')));
});

test('provider loss details use typed installation and authentication states', () => {
  const snapshot = structuralSnapshot({ roles: [], teamProviders: ['a', 'b'], models: [], eligibility: {
    a: { ok: false, installed: false, authenticated: false, reason: 'login required' },
    b: { ok: false, installed: true, authenticated: false, reason: 'CLI missing' }
  } });
  assert.deepEqual(snapshot.detail, { a: 'not_installed', b: 'not_authenticated' });
});
