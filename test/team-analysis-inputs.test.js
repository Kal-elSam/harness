import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAnalystPrompt, deriveRoleRequirements } from '../src/global/team/project-analysis.js';
import { buildProjectStrategy } from '../src/global/team/project-strategy.js';
import { readProjectStrategy, writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { loadProjectRoleCatalog } from '../src/global/intelligence/role-catalog.js';
import { proposalWorld, chosenAnalyst } from './helpers/team-proposal-world.js';

const profile = {
  projectName: 'fixture', stack: [], architecture: {}, quality: {}, hotspots: [], workflowCapabilities: [], risks: [],
  roleRequirements: [{ role: 'Architect', capabilities: ['reasoning'], reason: 'fixture' }], fingerprint: 'fixture'
};

const REAL_FILE = 'src/index.js';
const ODD_WORKER_ANALYSIS = JSON.stringify({
  architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [],
  workflowNeeds: [],
  recommendedRoleNeeds: [
    { role: 'odd-worker', capabilities: ['coding'], reason: 'bounded implementation unit', evidence: [REAL_FILE] }
  ],
  uncertainties: [], evidenceReferences: []
});

// Real analysis run through the conversation service with fake DI: the
// probe, the snapshot (one real file the analyst cited) and the analyst
// adapter (returns ODD_WORKER_ANALYSIS). No provider is ever called.
async function analysisRun({ probeState }) {
  const world = proposalWorld({ strategy: null });
  const service = world.createService({
    probeGentle: async () => ({ state: probeState, diagnostics: [], error: null }),
    buildSanitizedSnapshot: async () => ({
      snapshotRoot: '/tmp/snap', filesCopied: 1, secretsRedacted: 0, copiedFiles: [REAL_FILE],
      excludedPrivatePaths: [], cleanup: async () => {}
    }),
    createBootstrapAnalyzerAdapter: () => ({
      checkEligibility: async () => ({ eligible: true, isolation: 'verified' }),
      analyze: async () => ({ status: 'answered', answer: ODD_WORKER_ANALYSIS })
    })
  });
  const { preflight, analyst } = await chosenAnalyst(service);
  return service.runBootstrapAnalysis({ cwd: '/repo', profile: preflight.profile, candidates: preflight.candidates, analyst });
}

test('goal is included in analyst input and persists in the draft strategy', () => {
  const prompt = buildAnalystPrompt(profile, undefined, null, { projectGoal: 'Keep payments correct.' });
  assert.match(prompt, /Project goal: Keep payments correct\./);
  const strategy = buildProjectStrategy(profile, { scoredAll: [], eligibility: {}, registry: null, projectGoal: 'Keep payments correct.' }, { model: {} });
  assert.equal(strategy.projectGoal, 'Keep payments correct.');
});

test('no goal preserves the analyst input byte-for-byte', () => {
  assert.equal(
    buildAnalystPrompt(profile),
    buildAnalystPrompt(profile, undefined, null, { projectGoal: null })
  );
});

test('draft strategy records the host orchestrator without assigning an orchestrator role', () => {
  const strategy = buildProjectStrategy(profile, { scoredAll: [], eligibility: {}, registry: null, orchestrator: { source: 'host', model: 'Opus 5.5' } }, { model: {} });
  assert.deepEqual(strategy.orchestrator, { source: 'host', model: 'Opus 5.5' });
  assert.ok(!strategy.projectTeam.some(entry => entry.role === 'Orchestrator'));
});

test('legacy assigned orchestrator strategies still load', async t => {
  const home = await mkdtemp(join(tmpdir(), 'kairo-team-inputs-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, 'project');
  const legacy = { status: 'suggested', orchestrator: { adapterId: 'codex', modelId: 'gpt-6' }, projectTeam: [] };
  await writeProjectStrategy(home, root, legacy);
  assert.deepEqual((await readProjectStrategy(home, root)).orchestrator, legacy.orchestrator);
});

test('team show prints the host orchestrator line', async t => {
  const home = await mkdtemp(join(tmpdir(), 'kairo-team-show-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, 'project');
  await writeProjectStrategy(home, root, {
    status: 'suggested', bootstrapAnalyst: { adapterId: 'claude', modelId: 'sonnet' },
    orchestrator: { source: 'host', model: 'Opus 5.5' }, projectTeam: []
  });
  const output = [];
  await runTeamCli({ teamAction: 'show', cwd: root }, {
    homeDir: home, resolveRoot: async () => root, log: text => output.push(text)
  });
  assert.match(output[0], /Orchestrator: your current session model \(HOST, Opus 5\.5\)/);
});

test('rule 2: with the gentle probe available, an analysis naming odd-worker derives it as a role requirement', async () => {
  const catalog = loadProjectRoleCatalog({ projectRoot: '/nonexistent-kairo-project' });
  const analysis = JSON.parse(ODD_WORKER_ANALYSIS);
  const derived = deriveRoleRequirements(analysis, [], [REAL_FILE], catalog);
  assert.ok(derived.some(requirement => requirement.role === 'odd-worker'));
});

test('rule 2: without the gentle catalog, odd-worker is not derived', () => {
  const analysis = JSON.parse(ODD_WORKER_ANALYSIS);
  const derived = deriveRoleRequirements(analysis, [], [REAL_FILE], null);
  assert.ok(!derived.some(requirement => requirement.role === 'odd-worker'));
});

test('rule 2: with the gentle probe available, the draft team gives odd-worker a model', async () => {
  const result = await analysisRun({ probeState: 'available' });
  const entry = result.projectTeam.find(item => item.role === 'odd-worker');
  assert.ok(entry, 'odd-worker must be in the draft team');
  assert.ok(entry.model, 'odd-worker must have a model');
});

test('rule 2: with the gentle probe missing, gentle roles are filtered out of the draft team', async () => {
  const result = await analysisRun({ probeState: 'missing' });
  assert.ok(!result.projectTeam.some(item => item.role === 'odd-worker'));
});

test('team show never labels a legacy assigned orchestrator as the host model', async t => {
  const home = await mkdtemp(join(tmpdir(), 'kairo-team-show-legacy-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, 'project');
  await writeProjectStrategy(home, root, {
    status: 'suggested', bootstrapAnalyst: { adapterId: 'codex', modelId: 'gpt-6-astra' },
    orchestrator: { adapterId: 'codex', modelId: 'gpt-6-astra', displayName: 'GPT-6-Astra' }, projectTeam: []
  });
  const output = [];
  await runTeamCli({ teamAction: 'show', cwd: root }, {
    homeDir: home, resolveRoot: async () => root, log: text => output.push(text)
  });
  assert.doesNotMatch(output[0], /\(HOST, GPT-6-Astra\)/);
  assert.match(output[0], /older analysis, run kairo team analyze/);
});
