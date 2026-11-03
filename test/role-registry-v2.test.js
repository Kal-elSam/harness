// S21 adds authority and Delivery coordination to the S4 catalog; S12/S17 permissions stay unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_REGISTRY, DEFAULT_CATALOG_ROLES, isModelCompatibleWithRole, isBuildRole } from '../src/global/intelligence/role-registry.js';
import { loadProjectRoleCatalog, GENTLE_WORKFLOW_ROLES, GENTLE_OWNED_ACTORS, WORK_ROLE_ALIASES } from '../src/global/intelligence/role-catalog.js';

const EXPECTED = {
  'Frontier Authority': ['authority', 'global', 'read-only'],
  'Delivery Coordinator': ['coordination', 'delivery', 'read-only'],
  'Technical Lead': ['analysis', 'design', 'read-only'],
  Explorer: ['labor', 'design', 'read-only'],
  'Execution Coordinator': ['coordination', 'implementation', 'read-only'],
  Builder: ['labor', 'implementation', 'scoped-write'],
  Documenter: ['labor', 'implementation', 'docs-only'],
  'Quality Lead': ['verification', 'quality', 'read-only'],
  Reviewer: ['analysis', 'quality', 'read-only'],
  'Security Reviewer': ['analysis', 'quality', 'read-only'],
  'Test Repro Runner': ['labor', 'quality', 'scratch-only'],
  Deliverer: ['labor', 'delivery', 'authorized-delivery']
};
const frontier = { adapterId: 'x', modelId: 'frontier', intelligenceIndex: 60, codingIndex: 95, gpqa: .9, hle: .8 };
const ordinary = { adapterId: 'x', modelId: 'ordinary', intelligenceIndex: 40, codingIndex: 90, gpqa: .8, hle: .7 };

test('S4 default catalog is exactly the 12 routable roles, Master Orchestrator excluded', () => {
  assert.deepEqual([...DEFAULT_CATALOG_ROLES].sort(), Object.keys(EXPECTED).sort());
  assert.ok(!('Master Orchestrator' in ROLE_REGISTRY));
});

for (const [role, [cls, cell, permission]] of Object.entries(EXPECTED)) {
  test(`S3/S4 ${role}: class ${cls}, cell ${cell}, permission ${permission}`, () => {
    const entry = ROLE_REGISTRY[role];
    assert.ok(entry, `${role} registered`);
    assert.equal(entry.class, cls);
    assert.equal(entry.cell, cell);
    assert.equal(entry.permission, permission);
    assert.equal(entry.catalog, 'default');
  });
}

test('S4 every registry role carries an explicit class, cell and permission from the enums', () => {
  for (const [role, entry] of Object.entries(ROLE_REGISTRY)) {
    assert.ok(['authority', 'analysis', 'coordination', 'labor', 'verification'].includes(entry.class), `${role} class`);
    assert.ok(['global', 'design', 'implementation', 'quality', 'delivery'].includes(entry.cell), `${role} cell`);
    assert.ok(['read-only', 'scoped-write', 'docs-only', 'scratch-only', 'authorized-delivery'].includes(entry.permission), `${role} permission`);
  }
});

test('S4 legacy role ids leave the default catalog but still resolve in the registry', () => {
  for (const old of ['Architect', 'Planner', 'Debugger (diagnosis)', 'Backend Builder', 'Frontend Builder', 'Debugger (fix)', 'Refactorer', 'Verifier', 'Test Designer', 'Test Runner', 'DevOps']) {
    assert.equal(ROLE_REGISTRY[old]?.catalog, 'legacy', old);
    assert.ok(!DEFAULT_CATALOG_ROLES.includes(old), old);
  }
});

test('S4/S12 read-only roles never hold write action ids; Execution Coordinator never writes code', () => {
  for (const role of DEFAULT_CATALOG_ROLES.filter(id => ROLE_REGISTRY[id].permission === 'read-only')) {
    const ids = ROLE_REGISTRY[role].profile.allowedActionIds;
    assert.ok(!ids.some(id => ['repo.write', 'test.write', 'git.commit', 'git.push', 'pr.open'].includes(id)), `${role}: ${ids}`);
  }
  assert.equal(ROLE_REGISTRY['Execution Coordinator'].builder, false);
  assert.equal(isBuildRole('Execution Coordinator'), false);
});

test('S4 builder and executionRole flags stay consistent', () => {
  assert.equal(ROLE_REGISTRY.Builder.builder, true);
  assert.equal(ROLE_REGISTRY['Test Repro Runner'].executionRole, true);
  assert.equal(ROLE_REGISTRY['Test Repro Runner'].builder, false);
  assert.equal(isBuildRole('Test Repro Runner'), true);
});

test('S4 the built-in project catalog carries the v2 fields and every alias target exists', () => {
  const { registry } = loadProjectRoleCatalog({});
  for (const role of DEFAULT_CATALOG_ROLES) assert.equal(registry[role].permission, EXPECTED[role][2], role);
  for (const [name, target] of Object.entries(WORK_ROLE_ALIASES)) assert.ok(registry[target], `${name} -> ${target}`);
});

test('S4 review-* and jd-* actors are non-staffing protocol actors', () => {
  const { registry } = loadProjectRoleCatalog({});
  for (const actor of GENTLE_OWNED_ACTORS.filter(name => name in GENTLE_WORKFLOW_ROLES)) {
    assert.equal(registry[actor].staffing, false, actor);
    assert.equal(registry[actor].protocolActor, true, actor);
  }
  for (const role of DEFAULT_CATALOG_ROLES) assert.notEqual(registry[role].staffing, false, role);
});

test('S21 frontier models fit authority and non-lead review seats, never a cell lead, superseding S3 routine leadership', () => {
  for (const role of ['Technical Lead', 'Execution Coordinator', 'Quality Lead', 'Delivery Coordinator']) {
    assert.equal(isModelCompatibleWithRole(frontier, role), false, role);
  }
  for (const role of ['Reviewer', 'Security Reviewer']) assert.equal(isModelCompatibleWithRole(frontier, role), true, role);
  for (const role of ['Explorer', 'Builder', 'Documenter', 'Test Repro Runner', 'Deliverer']) {
    assert.equal(isModelCompatibleWithRole(frontier, role), false, role);
    assert.equal(isModelCompatibleWithRole(ordinary, role), true, role);
  }
});
