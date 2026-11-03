import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { projectKeyForPath } from '../src/global/next/project-key.js';
import { escalationBudgetPath, recordEscalation, readEscalationBudget } from '../src/global/team/escalation-budget.js';

const escalation = { to: 'Frontier Authority', reason: 'uncertainty', evidence: 'Conflicting contracts require a decision.' };
const flags = ['--goal', 'Resolve contract', '--authorized-file', 'src/example.js', '--preserved-contract', 'CLI', '--acceptance-check', 'node --test', '--work-budget', 'One decision', '--escalation-condition', 'Conflict', '--to', escalation.to, '--reason', escalation.reason, '--evidence', escalation.evidence];
async function world() {
  const home = await mkdtemp(join(tmpdir(), 'team-escalate-'));
  const cwd = join(home, 'project');
  await mkdir(cwd);
  execFileSync('git', ['init', '-q', cwd]);
  const model = { adapterId: 'codex', modelId: 'astra', displayName: 'Astra', intelligenceIndex: 60, codingIndex: 95, gpqa: .98, hle: .95, accessMode: 'automatic', utility: 2 };
  const strategy = { status: 'active', approvedAt: '2026-11-03T12:00:00Z', projectTeam: [{ role: 'Frontier Authority', model, assignmentSource: 'recommended' }] };
  await writeProjectStrategy(home, cwd, strategy);
  const cachePath = join(home, '.harness', 'sessions', projectKeyForPath(cwd), 'routing-input-cache.json');
  await writeFile(cachePath, JSON.stringify({ schema: 'kairo.routing-input-cache/v2', generatedAt: Date.now(), approvedAt: strategy.approvedAt, roles: { 'Frontier Authority': { pool: [model] } }, eligibility: { codex: { ok: true } }, modelEntitlement: {}, providerCapacity: { codex: { quotaRemainingPercent: 50 } }, models: [model], registry: null }));
  const env = { ...process.env, HARNESS_HOME: home };
  for (const key of ['KAIRO_HOST', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDECODE', 'OPENCODE_CLIENT']) delete env[key];
  const cli = (args = flags, action = 'escalate') => new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve('bin/kairo.js'), 'team', action, '--cwd', cwd, '--json', ...args], { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolveResult({ code, stdout, stderr, json: () => JSON.parse(stdout) }));
  });
  console.log(`scratch: ${home}`);
  return { home, cwd, cli, model, cachePath, ledger: () => readFile(escalationBudgetPath(home, cwd), 'utf8'), budget: () => readEscalationBudget(home, cwd) };
}
// Observable: public escalation returns the routed authority and spends one decision.
test('valid escalation returns authority and consumes exactly one unit', async () => {
  const f = await world();
  const out = await f.cli();
  assert.equal(out.code, 0, out.stderr || out.stdout);
  assert.equal(out.stderr, '');
  assert.equal(out.json().authority.model.modelId, f.model.modelId);
  assert.equal(out.json().authority.provider, 'codex');
  assert.equal(out.json().budget.remaining, 9);
  assert.equal((await f.budget()).used, 1);
  assert.deepEqual(JSON.parse(await f.ledger()).entries.map(({ at, ...entry }) => entry), [escalation]);
});
// Observable: invalid handoffs produce typed JSON and leave ledger bytes unchanged.
test('invalid escalation refuses without consuming budget', async () => {
  const f = await world();
  await recordEscalation(f.home, f.cwd, escalation);
  const before = await f.ledger();
  const out = await f.cli(flags.map(value => value === 'uncertainty' ? 'routine' : value));
  assert.equal(out.code, 1);
  assert.equal(out.json().code, 'invalid_handoff');
  assert.ok(out.json().reason);
  assert.equal(await f.ledger(), before);
});
// Observable: exhausted budgets refuse with stable code and no ledger mutation.
test('exhausted escalation refuses without changing budget', async () => {
  const f = await world();
  for (let i = 0; i < 10; i++) await recordEscalation(f.home, f.cwd, escalation);
  const before = await f.ledger();
  const out = await f.cli();
  assert.equal(out.code, 1);
  assert.equal(out.json().code, 'escalation_budget_exhausted');
  assert.ok(out.json().reason);
  assert.equal(await f.ledger(), before);
});
// Observable: concurrent CLI processes cannot both spend the last shared unit.
test('two concurrent escalations admit exactly one last unit', async () => {
  const f = await world();
  for (let i = 0; i < 9; i++) await recordEscalation(f.home, f.cwd, escalation);
  const out = await Promise.all([f.cli(), f.cli()]);
  assert.deepEqual(out.map(row => row.code).sort(), [0, 1]);
  const refused = out.find(row => row.code === 1).json();
  assert.ok(['escalation_budget_busy', 'escalation_budget_exhausted'].includes(refused.code));
  assert.ok(refused.reason);
  assert.equal(out.find(row => row.code === 0).json().budget.remaining, 0);
  assert.equal((await f.budget()).used, 10);
});
// Observable: unavailable routing refuses before creating a budget ledger.
test('no available authority refuses without consuming budget', async () => {
  const f = await world();
  const cache = JSON.parse(await readFile(f.cachePath, 'utf8'));
  cache.providerCapacity.codex = { quotaRemainingPercent: 0, exhaustion: true };
  await writeFile(f.cachePath, JSON.stringify(cache));
  const out = await f.cli();
  assert.equal(out.code, 1);
  assert.equal(out.json().code, 'frontier_authority_unavailable');
  assert.ok(out.json().reason);
  assert.equal((await f.budget()).used, 0);
  await assert.rejects(f.ledger(), { code: 'ENOENT' });
});
// Observable: existing routes remains read-only and preserves its public JSON shape.
test('existing routes command keeps previous behavior', async () => {
  const f = await world();
  const out = await f.cli([], 'routes');
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(out.json().escalation, { used: 0, cap: 10, remaining: 10 });
  assert.equal(out.json().rows[0].role, 'Frontier Authority');
  assert.equal((await f.budget()).used, 0);
  await assert.rejects(f.ledger(), { code: 'ENOENT' });
});
