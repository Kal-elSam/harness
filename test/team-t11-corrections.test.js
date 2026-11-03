import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createConversationService } from '../src/global/team/service.js';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { writeProjectStrategy, readProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { readRoutingInputCache, runTeamRouteCli } from '../src/global/team/routing-input-cache.js';
import { createToolHandlers } from '../src/global/mcp/kairo-mcp.js';
import { buildAiTeam, buildEfficientTeam, scoreAvailableModels } from '../src/global/intelligence/model-intelligence.js';
import { ROLE_REGISTRY } from '../src/global/intelligence/role-registry.js';

const ordinary = { adapterId: 'codex', modelId: 'terra', displayName: 'Terra', evidenceStatus: 'unscored', accessMode: 'automatic' };
const frontier = { ...ordinary, modelId: 'astra', displayName: 'Astra', evidenceStatus: 'scored', intelligenceIndex: 60 };
async function fixture(model = ordinary, status = 'active') {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'kairo-t11-correction-')));
  const home = join(scratch, 'home'), root = join(scratch, 'repo');
  await mkdir(home); await mkdir(root);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  await writeProjectStrategy(home, root, { status, approvedAt: '2026-11-01T00:00:00Z',
    projectTeam: [{ role: 'Architect', model }, { role: 'Planner', model: { ...ordinary, modelId: 'luna' } }] });
  const service = createConversationService({ homeDir: home, resolveRoot: async () => root });
  service.snapshot = async () => ({ projectRoot: root, projectStrategy: await readProjectStrategy(home, root), modelIntelligence: { scoredAll: [ordinary, frontier], eligibility: { codex: { ok: true } } } });
  const cli = async (options, deps = {}) => {
    try { return await runTeamCli({ cwd: root, json: true, roleHost: 'codex', ...options }, { homeDir: home, log: () => {}, ...deps }); }
    finally { process.exitCode = 0; }
  };
  console.log(`Scratch retained: ${scratch}`);
  return { home, root, service, cli };
}

// Regression B1: a normal refresh cache remains usable by show without an injected service.
test('B1 team show JSON scores a real refreshed registry cache', async () => {
  const f = await fixture();
  const service = createConversationService({ homeDir: f.home, resolveRoot: async () => f.root, enableProviderProbes: true,
    listPlans: async () => [], recoverRuns: async () => {}, listRunRecords: async () => [],
    inspectExecutionAdapters: () => [], inspectEngramIntegration: () => ({}),
    readCodexUsage: async () => null, readClaudeUsage: async () => null, readOpenCodeUsage: async () => null,
    readCodexModels: async () => ({ models: [{ id: 'terra' }] }), readOpenCodeModels: async () => ({ models: [] }),
    readClaudeModels: () => ({ models: [] }), readCursorModels: async () => ({ models: [] }),
    readArtificialAnalysisModels: async () => ({ models: [{ slug: 'terra', name: 'Terra', intelligenceIndex: 50, codingIndex: 90, gpqa: .9, hle: .9 }] }),
    readClaudeEntitlementCache: async () => null, verifyClaudeSubscriptionAuth: async () => null,
    readCursorAccessCache: async () => null, readHuggingFaceLeaderboard: async () => ({ entries: [] }), readAgentSessionTelemetry: async () => null });
  await runTeamRouteCli({ cwd: f.root, refresh: true, json: true }, { homeDir: f.home, service, log: () => {} });
  const cache = await readRoutingInputCache(f.home, f.root);
  assert.ok(Array.isArray(cache.registry));
  assert.ok(cache.models.length > 0);
  const before = await readProjectStrategy(f.home, f.root);
  const result = await f.cli({ teamAction: 'show' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.suggestedMasterOrchestrator.advisory);
  assert.deepEqual(await readProjectStrategy(f.home, f.root), before);
});

// Regression B2: explicit migration reapproval preserves baseline unscored assignments.
test('B2 CLI reapproval accepts compatible unscored migrated assignment', async () => {
  const f = await fixture();
  const result = await f.cli({ teamAction: 'approve', yes: true }, { getService: () => f.service });
  assert.equal(result.ok, true, JSON.stringify(result));
  const stored = await readProjectStrategy(f.home, f.root);
  assert.equal(stored.reapprovalRequired, undefined);
  assert.equal(stored.projectTeam[0].model.evidenceStatus, 'unscored');
  assert.equal(stored.approvedAt, '2026-11-01T00:00:00Z');
});

// Regression B3: MCP must not project a service refusal as successful activation.
test('B3 MCP reapproval refuses frontier lead without changing persisted team', async () => {
  const f = await fixture(frontier);
  const before = await readProjectStrategy(f.home, f.root);
  const handlers = createToolHandlers({ workspaceBound: true, cwdExplicit: true, cwd: f.root, processCwd: f.root,
    userHome: f.home, env: {}, conversationService: f.service });
  const plan = (await handlers.kairo_setup_plan({ action: 'approve_team' })).structuredContent;
  assert.equal(plan.ok, true);
  const result = (await handlers.kairo_setup_approve_team({ confirmationTarget: plan.data.confirmationTarget })).structuredContent;
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.code, 'approval_blocked');
  const refusal = await f.service.reapproveProjectStrategy({ cwd: f.root });
  assert.ok(refusal.reasons.length > 0);
  assert.deepEqual(result.data, { reasons: refusal.reasons });
  assert.deepEqual(await readProjectStrategy(f.home, f.root), before);
});

test('MCP non-approval setup error preserves its previous response shape', async () => {
  const f = await fixture();
  const handlers = createToolHandlers({ workspaceBound: true, cwdExplicit: true, cwd: f.root, processCwd: f.root,
    userHome: f.home, env: {}, conversationService: f.service });
  const result = await handlers.kairo_setup_run_analysis({});
  const expected = { ok: false, code: 'confirmation_required', data: null, diagnostics: ['confirmation_required'] };
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify(expected) }]);
  assert.equal(result.isError, true);
});

// S21 integration: the production catalog, not a reduced override, excludes frontier from every lead and labor seat.
test('S21 production catalog formation excludes frontier from cell leads and labor', () => {
  const pool = scoreAvailableModels([{ adapterId: 'codex', models: [{ id: 'astra' }, { id: 'terra' }] }],
    [{ slug: 'astra', name: 'Astra', intelligenceIndex: 60, codingIndex: 95, gpqa: .98, hle: .95 },
      { slug: 'terra', name: 'Terra', intelligenceIndex: 54, codingIndex: 90, gpqa: .95, hle: .9 }]);
  const capabilities = Object.fromEntries(Object.entries(ROLE_REGISTRY).filter(([, role]) => role.catalog === 'default').map(([name, role]) => [name, role.capabilities]));
  for (const team of [buildAiTeam(pool, { codex: { ok: true } }, null, capabilities), buildEfficientTeam(pool, { codex: { ok: true } }, null, { roleCapabilities: capabilities })]) {
    const seats = team.filter(row => ROLE_REGISTRY[row.role].cellLead || ROLE_REGISTRY[row.role].class === 'labor');
    assert.ok(seats.length > 0);
    for (const row of seats) {
      assert.notEqual(row.primary?.modelId, 'astra', row.role);
      assert.notEqual(row.fallback?.modelId, 'astra', row.role);
    }
    for (const role of Object.keys(ROLE_REGISTRY).filter(role => ROLE_REGISTRY[role].cellLead)) {
      assert.ok(seats.some(row => row.role === role), role);
    }
  }
});
