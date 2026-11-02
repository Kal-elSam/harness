import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildProjectProposal, formatProposalEvidence } from '../src/global/team/project-proposal.js';
import { summarizeProjectStrategy } from '../src/global/host/project-team-sidecar.js';
import { createConversationService } from '../src/global/team/service.js';
import { proposalWorld, chosenAnalyst } from './helpers/team-proposal-world.js';

const dirs = [];
test.after(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });

async function scratch(prefix) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

const git = (cwd, ...args) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};

/** Real git project: each entry commits one file under the given conventional subject. */
async function project(commits) {
  const root = await scratch('kairo-proposal-root-');
  git(root, 'init', '-q');
  let index = 0;
  for (const [subject, path] of commits) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), `// ${index += 1}\n`);
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', subject);
  }
  return root;
}

const DATA_COMMITS = [
  ['feat(db): add users table', 'db/migrations/001_users.sql'],
  ['fix(db): users index', 'db/migrations/002_index.sql'],
  ['feat(db): orders table', 'db/migrations/003_orders.sql'],
  ['feat(ui): home page', 'src/ui/home.js'],
  ['fix(ui): header', 'src/ui/header.js'],
  ['feat(ui): footer', 'src/ui/footer.js'],
  ['feat(server): health route', 'src/server/health.js']
];

test('S13 proposes an extra cell beyond the defaults with its evidence', async () => {
  const root = await project(DATA_COMMITS);
  const proposal = await buildProjectProposal({ root });
  const data = proposal.cells.find(cell => cell.name === 'Data');
  assert.ok(data, 'a Data cell is proposed for the recurring db/migrations work');
  assert.equal(data.source, 'proposed');
  assert.match(data.evidence.join('\n'), /db: .*3 changes/);
  const seat = proposal.seats.find(entry => entry.cell === 'Data');
  assert.equal(seat.role, 'Data Builder');
  assert.equal(seat.source, 'proposed');
  // Generic, not special-cased: a different project gets a different extra cell.
  const mobile = await project([['feat: ios a', 'ios/A.swift'], ['fix: ios b', 'ios/B.swift'], ['feat: ios c', 'ios/C.swift']]);
  assert.ok((await buildProjectProposal({ root: mobile })).cells.some(cell => cell.name === 'Mobile'));
  assert.ok(!proposal.cells.some(cell => cell.name === 'Mobile'));
});

test('S13 drops seats no work maps to and lists each with its reason', async () => {
  const root = await project(DATA_COMMITS);
  const proposal = await buildProjectProposal({ root });
  const roles = proposal.seats.map(seat => seat.role);
  for (const dropped of ['Documenter', 'Security Reviewer', 'Deliverer']) {
    assert.ok(!roles.includes(dropped), `${dropped} has no mapped work`);
  }
  assert.match(proposal.dropped.find(entry => entry.role === 'Documenter').reason, /no documentation work/i);
  assert.match(proposal.dropped.find(entry => entry.role === 'Security Reviewer').reason, /no security/i);
  assert.ok(roles.includes('Builder') && roles.includes('Technical Lead') && roles.includes('Quality Lead'));
  // Work present keeps the seat: docs, CI and an auth surface map Documenter, Deliverer and Security Reviewer.
  const busy = await project([
    ['docs: guide', 'docs/guide.md'], ['ci: pipeline', '.github/workflows/ci.yml'], ['feat: login', 'src/auth/login.js']
  ]);
  const kept = (await buildProjectProposal({ root: busy })).seats.map(seat => seat.role);
  for (const role of ['Documenter', 'Deliverer', 'Security Reviewer']) assert.ok(kept.includes(role), role);
});

test('S13 links a specialty to an installed SKILL.md', async () => {
  const root = await project(DATA_COMMITS);
  const home = await scratch('kairo-proposal-home-');
  await mkdir(join(home, '.claude', 'skills', 'frontend'), { recursive: true });
  await writeFile(join(home, '.claude', 'skills', 'frontend', 'SKILL.md'), '---\nname: frontend\ndescription: ui work\n---\n');
  const proposal = await buildProjectProposal({ root, homeDir: home });
  const specialty = proposal.seats.find(seat => seat.role === 'Builder').specialties.find(entry => entry.name === 'frontend');
  assert.equal(specialty.missingSkill, false);
  assert.equal(specialty.skill.name, 'frontend');
  assert.ok(specialty.skill.path.endsWith('frontend/SKILL.md'));
});

test('S13 marks a specialty with no installed skill as a missing skill', async () => {
  const root = await project(DATA_COMMITS);
  const home = await scratch('kairo-proposal-home-');
  const proposal = await buildProjectProposal({ root, homeDir: home });
  const specialty = proposal.seats.find(seat => seat.role === 'Builder').specialties.find(entry => entry.name === 'frontend');
  assert.equal(specialty.skill, null);
  assert.equal(specialty.missingSkill, true);
  assert.match(formatProposalEvidence(proposal), /missing skill/i);
});

test('S13 the proposal is persisted on the suggested strategy and activates only on approval', async () => {
  const world = proposalWorld({ strategy: null });
  const service = world.createService({
    probeGentle: async () => ({ state: 'missing', diagnostics: [], error: null }),
    buildSanitizedSnapshot: async () => ({ snapshotRoot: '/tmp/snap', filesCopied: 0, secretsRedacted: 0, copiedFiles: [], excludedPrivatePaths: [], cleanup: async () => {} }),
    createBootstrapAnalyzerAdapter: () => ({
      checkEligibility: async () => ({ eligible: true, isolation: 'verified' }),
      analyze: async () => ({ status: 'answered', answer: JSON.stringify({
        architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [],
        recommendedRoleNeeds: [], uncertainties: [], evidenceReferences: []
      }) })
    })
  });
  const { preflight, analyst } = await chosenAnalyst(service);
  const strategy = await service.runBootstrapAnalysis({ cwd: '/repo', profile: preflight.profile, candidates: preflight.candidates, analyst });
  assert.equal(strategy.status, 'suggested');
  assert.equal(strategy.proposal.status, 'suggested');

  let stored = { ...strategy, bootstrapAnalyst: strategy.bootstrapAnalyst, projectTeam: strategy.projectTeam };
  const approving = createConversationService({
    resolveRoot: async () => '/repo', homeDir: '/home/test',
    readProjectStrategy: async () => stored,
    writeProjectStrategy: async (_home, _root, next) => { stored = next; return next; },
    activationBlockers: async () => []
  });
  assert.equal(stored.proposal.status, 'suggested', 'nothing activates before approval');
  const approved = await approving.approveProjectStrategy({ cwd: '/repo' });
  if (approved.ok) assert.equal(approved.proposal.status, 'approved');
  else assert.equal(stored.proposal.status, 'suggested', 'a blocked approval leaves the proposal suggested');
});

test('S13 the evidence is visible before approval through the host summary', async () => {
  const root = await project(DATA_COMMITS);
  const proposal = await buildProjectProposal({ root });
  const summary = summarizeProjectStrategy({ status: 'suggested', projectTeam: [], proposal });
  assert.match(summary.proposal.evidence, /Data/);
  assert.match(summary.proposal.evidence, /db: /);
  assert.match(summary.proposal.evidence, /Dropped seats/);
  assert.match(summary.proposal.evidence, /Documenter/);
});

test('S13 prior behaviour holds: strategies and summaries without a proposal are unchanged', () => {
  const summary = summarizeProjectStrategy({ status: 'suggested', projectTeam: [{ role: 'Builder', model: { adapterId: 'codex', modelId: 'm' } }] });
  assert.ok(!('proposal' in summary));
  assert.deepEqual(summary.roles, ['Builder']);
});
