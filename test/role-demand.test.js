import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDemand, roleDemandFloor } from '../src/global/intelligence/role-demand.js';
import { ROLE_REGISTRY, withRoleCatalog } from '../src/global/intelligence/role-registry.js';

test('B3 a catalog-promoted demanding Planner keeps its floor without assessment raises', () => {
  withRoleCatalog({ registry: { ...ROLE_REGISTRY,
    Planner: { ...ROLE_REGISTRY.Planner, tier: 'demanding', floor: .6 }
  } }, () => {
    const demand = projectDemand({ demandAssessment: { categories: {
      actionsAndSecurity: { level: 4 }, money: { level: 4 }, personalData: { level: 3 },
      realtimeConcurrency: { level: 3 }, aiIntegration: { level: 3 }, domainComplexity: { level: 3 }
    } } });
    assert.equal(demand.floors.Planner, undefined);
    assert.equal(demand.assessment.raises.Planner, undefined);
    assert.equal(roleDemandFloor('Planner', demand), .6);
    for (const role of ['Architect', 'Security Reviewer', 'Reviewer', 'Debugger (fix)']) {
      assert.equal(roleDemandFloor(role, demand), .65);
    }
    for (const role of ['Builder', 'Backend Builder', 'Frontend Builder', 'Refactorer', 'Test Runner']) {
      assert.equal(demand.floors[role], undefined);
      assert.equal(roleDemandFloor(role, demand), role === 'Test Runner' ? .35 : .55);
    }
  });
});
