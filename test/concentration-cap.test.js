import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectStrategy } from '../src/global/team/project-strategy.js';

const row = (modelId, score, adapterId = 'codex') => ({ adapterId, modelId,
  intelligenceIndex: score, codingIndex: score, priceInputPerMTok: 1,
  priceOutputPerMTok: 1, accessMode: 'automatic' });
const roles = ['Explorer', 'Architect', 'Debugger (fix)', 'Test Author', 'Docs Writer', 'Refactorer'];
function build(models, names = roles) {
  return buildProjectStrategy({ fingerprint: 'cap', roleRequirements: names.map(role => ({ role, capabilities: ['reasoning', 'coding'] })) },
    { scoredAll: models, eligibility: { codex: { ok: true }, claude: { ok: true } }, orchestrator: { source: 'host', model: models[0] } },
    { model: models[0] });
}
function counts(team) {
  return Object.values(team.reduce((out, entry) => {
    if (entry.model) out[entry.model.modelId] = (out[entry.model.modelId] ?? 0) + 1;
    return out;
  }, {}));
}
test('project teams strictly cap six assignable roles across three qualified models at two', () => {
  const strategy = build([row('best', 90), row('second', 80), row('third', 75)]);
  for (const team of [strategy.projectTeam, strategy.qualityTeam, strategy.efficientTeam]) {
    assert.equal(team.length, 6);
    assert.ok(team.every(entry => entry.model));
    assert.ok(counts(team).every(count => count <= 2), JSON.stringify(team));
    assert.ok(team.some(entry => /cap.*mov|mov.*cap/i.test(entry.reason)));
  }
});
test('only-qualified overflow is allowed and explained for each overflowing role', () => {
  const strategy = build([row('only', 90), row('weak', 30)]);
  // weak is eligible, but never qualified: denominator is one, not two.
  assert.equal(counts(strategy.projectTeam)[0], 6);
  const mixed = buildProjectStrategy({ fingerprint: 'sole', roleRequirements: [
    ...roles.map(role => ({ role, capabilities: ['coding'] })),
    { role: 'Analyst', capabilities: ['reasoning'] }
  ] }, { scoredAll: [row('only', 90), { ...row('reasoner', 90), codingIndex: 20 }],
    eligibility: { codex: { ok: true } } }, { model: row('only', 90) });
  const sole = mixed.projectTeam.filter(entry => entry.model?.modelId === 'only');
  assert.ok(sole.length > 4);
  for (const entry of sole.slice(4)) assert.match(entry.reason, /only qualified.*cap|cap.*only qualified/i);
});
test('host orchestrator is neither assigned nor counted in the project cap', () => {
  const strategy = build([row('best', 90), row('second', 80), row('third', 75)], [...roles, 'Orchestrator']);
  assert.equal(strategy.orchestrator.source, 'host');
  assert.equal(strategy.projectTeam.some(entry => entry.role === 'Orchestrator'), false);
  assert.ok(counts(strategy.projectTeam).every(count => count <= 2));
});
test('project cap preserves the existing step-b independence ladder', () => {
  const strategy = build([row('builder', 80), row('reviewer', 75), row('weak', 40, 'claude')], ['Builder', 'Reviewer']);
  const reviewer = strategy.projectTeam.find(entry => entry.role === 'Reviewer');
  assert.equal(reviewer.assignmentState, 'degraded');
  assert.notEqual(reviewer.model.modelId, strategy.projectTeam.find(entry => entry.role === 'Builder').model.modelId);
  assert.match(reviewer.reason, /step b.*not provider-independent/i);
});

test('unassignable roles without metric evidence do not inflate the cap', () => {
  const requirements = [
    ...roles.map(role => ({ role, capabilities: ['coding'] })),
    { role: 'Security Reviewer', capabilities: ['terminalExecution'] },
    { role: 'Analyst', capabilities: ['softwareExecution'] },
    { role: 'Researcher', capabilities: ['instructionFollowing'] }
  ];
  const strategy = buildProjectStrategy({ fingerprint: 'no-metric', roleRequirements: requirements },
    { scoredAll: [row('best', 90), row('second', 80), row('third', 75)], eligibility: { codex: { ok: true } } },
    { model: row('best', 90) });
  assert.equal(strategy.projectTeam.length, 6);
  assert.ok(counts(strategy.projectTeam).every(count => count <= 2));
});

test('when every qualified model is full, the least-loaded qualified model takes one extra role, explained', () => {
  const reasoner = id => ({ ...row(id, 90), codingIndex: 20 });
  const strategy = buildProjectStrategy({ fingerprint: 'full', roleRequirements: [
    ...roles.map(role => ({ role, capabilities: ['coding'] })),
    { role: 'Analyst', capabilities: ['reasoning'] }
  ] }, { scoredAll: [row('a', 90), row('b', 88), reasoner('r'), reasoner('s')], eligibility: { codex: { ok: true } } },
  { model: row('a', 90) });
  const team = strategy.projectTeam;
  assert.equal(team.length, 7);
  assert.ok(team.every(entry => entry.model && entry.assignmentState !== 'blocked'), JSON.stringify(team));
  const coding = team.filter(entry => entry.role !== 'Analyst').map(entry => entry.model.modelId);
  assert.deepEqual([coding.filter(id => id === 'a').length, coding.filter(id => id === 'b').length].sort(), [3, 3]);
  assert.equal(team.filter(entry => /every qualified model is full/i.test(entry.reason)).length, 2);
});
