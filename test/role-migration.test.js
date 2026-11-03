// S4 read-time many-to-one migration to the v2 catalog (T6/U2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoleDocument, originalRoleDocument, roleIdsOnRead, LEGACY_ROLE_IDS, ROLE_REGISTRY, DEFAULT_CATALOG_ROLES } from '../src/global/intelligence/role-registry.js';
import { resolveProjectRoute } from '../src/global/team/project-router.js';
import { strategyHash } from '../src/global/team/pending-team-proposal-store.js';
import { WORK_ROLE_ALIASES } from '../src/global/intelligence/role-catalog.js';
import { mapGentleRolePicks } from '../src/global/intelligence/gentle-role-map.js';

const A = { adapterId: 'claude', modelId: 'opus' };
const B = { adapterId: 'codex', modelId: 'worker' };
const team = (...rows) => ({ status: 'active', projectTeam: rows.map(([role, model]) => ({ role, model })) });

const MAPPING = {
  Architect: 'Technical Lead', Planner: 'Technical Lead', 'Debugger (diagnosis)': 'Technical Lead',
  Builder: 'Builder', 'Backend Builder': 'Builder', 'Frontend Builder': 'Builder', 'Debugger (fix)': 'Builder', Refactorer: 'Builder', DevOps: 'Builder',
  Verifier: 'Quality Lead', 'Test Designer': 'Quality Lead', 'Test Runner': 'Test Repro Runner'
};
for (const [old, modern] of Object.entries(MAPPING)) {
  test(`S4 ${old} migrates to ${modern} on read`, () => {
    const next = normalizeRoleDocument(team([old, A]));
    assert.deepEqual(next.projectTeam.map(row => row.role), [modern]);
    assert.deepEqual(next.projectTeam[0].model, A);
    assert.equal(next.reapprovalRequired, undefined);
    assert.equal(roleIdsOnRead(old)[0], modern);
  });
}

test('S4 singular legacy ids expand: Tester -> Test Repro Runner + Quality Lead, Debugger -> Builder + Technical Lead', () => {
  assert.deepEqual(normalizeRoleDocument(team(['Tester', A])).projectTeam.map(row => row.role), ['Test Repro Runner', 'Quality Lead']);
  assert.deepEqual(normalizeRoleDocument(team(['Debugger', A])).projectTeam.map(row => row.role), ['Builder', 'Technical Lead']);
});

test('S4 the safe id has no slash and every target is a default catalog role', () => {
  assert.equal(ROLE_REGISTRY['Test Repro Runner'].displayName, 'Test/Repro Runner');
  assert.match('Test Repro Runner', /^[A-Za-z][A-Za-z0-9 ()._-]*$/);
  for (const targets of Object.values(LEGACY_ROLE_IDS)) for (const id of targets) assert.ok(DEFAULT_CATALOG_ROLES.includes(id), id);
});

test('S4 collision, same model: merges silently into one entry', () => {
  const next = normalizeRoleDocument(team(['Architect', A], ['Planner', A], ['Debugger (diagnosis)', A]));
  assert.deepEqual(next.projectTeam.map(row => row.role), ['Technical Lead']);
  assert.equal(next.projectTeam[0].migration, undefined);
  assert.equal(next.reapprovalRequired, undefined);
});

test('S4 collision, different models: highest-demand pick stays, marked assignmentChanged, team flagged reapprovalRequired', () => {
  const next = normalizeRoleDocument(team(['Planner', B], ['Architect', A]));
  assert.equal(next.projectTeam.length, 1);
  assert.equal(next.projectTeam[0].role, 'Technical Lead');
  assert.deepEqual(next.projectTeam[0].model, A, 'Architect before Planner');
  assert.deepEqual(next.projectTeam[0].migration, { from: ['Architect', 'Planner'], assignmentChanged: true });
  assert.equal(next.reapprovalRequired, true);
  const builder = normalizeRoleDocument(team(['Refactorer', B], ['Builder', A], ['Backend Builder', B]));
  assert.deepEqual(builder.projectTeam.map(row => row.role), ['Builder']);
  assert.deepEqual(builder.projectTeam[0].model, A, 'explicit Builder wins over specialties');
  const specialties = normalizeRoleDocument(team(['Refactorer', B], ['Frontend Builder', A], ['Debugger (fix)', B]));
  assert.deepEqual(specialties.projectTeam[0].model, B, 'Debugger (fix) outranks the other specialties');
  assert.equal(specialties.reapprovalRequired, true);
});

test('S4 collision, different models: the seat still runs on the pick (never blocked)', () => {
  const priced = modelId => ({ adapterId: 'codex', modelId, priceInputPerMTok: 1, priceOutputPerMTok: 1 });
  const route = resolveProjectRoute({
    role: 'Architect', strategy: team(['Planner', priced('small')], ['Architect', priced('big')]),
    eligibility: { codex: { ok: true } }, activeHost: 'codex'
  });
  assert.equal(route.role, 'Technical Lead');
  assert.equal(route.model?.modelId, 'big');
  assert.notEqual(route.decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.equal(route.blocked ?? false, false);
});

test('S4 an explicit modern entry wins over every legacy sibling, with no re-approval', () => {
  const next = normalizeRoleDocument(team(['Architect', B], ['Technical Lead', A], ['Test Runner', B], ['Test Repro Runner', A]));
  assert.deepEqual(next.projectTeam.map(row => [row.role, row.model.modelId]), [['Technical Lead', 'opus'], ['Test Repro Runner', 'opus']]);
  assert.equal(next.reapprovalRequired, undefined);
});

test('S4 role-keyed maps merge by priority and flag differing values', () => {
  const next = normalizeRoleDocument({ roles: { Planner: { pool: ['b'] }, Architect: { pool: ['a'] } }, floors: { Verifier: 0.5, 'Test Designer': 0.5 } });
  assert.deepEqual(next.roles, { 'Technical Lead': { pool: ['a'] } });
  assert.deepEqual(next.floors, { 'Quality Lead': 0.5 });
  assert.equal(next.reapprovalRequired, true);
});

test('S4 read-time only: stored bytes stay unchanged, the original document hash binding survives', () => {
  const doc = team(['Planner', B], ['Architect', A]);
  const before = JSON.stringify(doc);
  const next = normalizeRoleDocument(doc);
  assert.equal(JSON.stringify(doc), before);
  assert.equal(originalRoleDocument(next), doc);
  assert.equal(strategyHash(next), strategyHash(doc));
  next.projectTeam[0].model = { modelId: 'edited' };
  assert.notEqual(strategyHash(next), strategyHash(doc));
});

test('S4 normalization is idempotent and returns modern documents untouched', () => {
  const modern = team(['Technical Lead', A], ['Builder', B]);
  assert.equal(normalizeRoleDocument(modern), modern);
  for (const legacy of [team(['Planner', B], ['Architect', A]), team(['Tester', A], ['Debugger', B]), team(['Architect', A], ['Planner', A])]) {
    const once = normalizeRoleDocument(legacy);
    assert.deepEqual(normalizeRoleDocument(once), once);
    assert.equal(normalizeRoleDocument(once), once);
  }
});

test('S4 aliases and Gentle mapping reach the v2 roles', () => {
  assert.equal(WORK_ROLE_ALIASES['team-test-runner'], 'Test Repro Runner');
  assert.equal(WORK_ROLE_ALIASES['kairo-architect'], 'Technical Lead');
  assert.equal(WORK_ROLE_ALIASES['team-plan-critic-codex'], 'Technical Lead');
  const { picks } = mapGentleRolePicks([{ role: 'Test Repro Runner', model: { modelId: 'haiku', adapterId: 'claude' } }]);
  assert.equal(picks['odd-verify']?.role, 'Test Repro Runner');
});

test('S4 default team flips to the v2 roles; legacy ids never staff or activate', () => {
  const defaults = Object.keys(ROLE_REGISTRY).filter(role => ROLE_REGISTRY[role].defaultTeam).sort();
  assert.deepEqual(defaults, ['Builder', 'Explorer', 'Quality Lead', 'Reviewer', 'Technical Lead', 'Test Repro Runner']);
  assert.equal(ROLE_REGISTRY['Technical Lead'].assessmentRaised, true);
  for (const [role, entry] of Object.entries(ROLE_REGISTRY)) if (entry.catalog === 'legacy') assert.equal(entry.defaultTeam, false, role);
  // S5: verification and review are independent of Builders.
  for (const role of ['Reviewer', 'Security Reviewer', 'Quality Lead']) assert.equal(ROLE_REGISTRY[role].independentReview, true, role);
  assert.ok(!ROLE_REGISTRY.Builder.independentReview);
});
