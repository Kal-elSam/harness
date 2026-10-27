import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readProjectStrategy, readTeamReform, unannouncedReform, reformNoticeLine, markReformAnnounced } from './project-strategy-store.js';
import { currentTeamPhase } from './project-strategy.js';
import { quotaPressure } from '../intelligence/quota-pacing.js';
import { createConversationOperations, ConversationOperationError } from './operations.js';
import { resolveActiveHost, hostAllowsProvider } from '../hosts/active-host.js';
import { readTeamRoute } from './routing-input-cache.js';

const statusOf = strategy => ({ suggested: 'draft', active: 'approved' }[strategy?.status] ?? strategy?.status ?? 'none');
const rowsOf = strategy => [
  ...(strategy?.bootstrapAnalyst ? [{ role: 'Project Analyst', model: strategy.bootstrapAnalyst }] : []),
  // Legacy assigned orchestrators remain readable, but new strategies are host-owned.
  ...(strategy?.orchestrator?.source === 'host' ? [] : strategy?.orchestrator ? [{ role: 'Orchestrator', model: strategy.orchestrator }] : []),
  ...(strategy?.projectTeam ?? [])
].map(({ role, model, assignmentState }) => ({ role, model: model?.displayName ?? model?.modelId ?? '-', provider: model?.adapterId ?? '-', status: statusOf(strategy) + (assignmentState === 'degraded' ? ' (degraded)' : '') }));

const orchestratorLine = strategy => {
  const orchestrator = strategy?.orchestrator;
  if (orchestrator?.source === 'host') return `Orchestrator: your current session model (HOST, ${orchestrator.model ?? 'as selected in your session'})`;
  if (orchestrator) return `Orchestrator: your current session model (HOST, as selected in your session); this team still lists an assigned ${orchestrator.displayName ?? orchestrator.modelId ?? 'model'} from an older analysis, run kairo team analyze to refresh it`;
  return 'Orchestrator: your current session model (HOST, as selected in your session)';
};

function table(rows) {
  const cells = [['Role', 'Model', 'Provider', 'Status'], ...rows.map(r => [r.role, r.model, r.provider, r.status])];
  const widths = cells[0].map((_, i) => Math.max(...cells.map(row => String(row[i]).length)));
  return cells.map(row => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

const pickAnalyst = 'Pick one with kairo team analyze --analyst MODEL.';

// The manual analyst inventory includes every executable model, even without
// benchmark evidence. Ranking is never a CLI choice.
function analystRows(facts) {
  const known = new Map((facts.knownCandidates ?? []).map(m => [m.candidateKey, m]));
  return (facts.analystCatalog?.models ?? []).filter(m => m.available === true)
    .sort((a, b) => a.candidateKey.localeCompare(b.candidateKey))
    .map((m, index) => {
      const source = known.get(m.candidateKey);
      const capacity = facts.providerCapacity?.[m.adapterId];
      const hasQuota = capacity && (Number.isFinite(capacity.quotaRemainingPercent) || capacity.quotaWindows?.length);
      return { number: index + 1, modelId: m.modelId, provider: m.adapterId, candidateKey: m.candidateKey,
        // Current built-in analyst adapters are subscription routes. Explicit
        // billing evidence wins; accessMode describes launchability, not billing.
        access: source?.accessType ?? 'subscription',
        estimatedCost: source?.estimatedAnalysisCost ?? 'unknown',
        quotaTier: hasQuota ? quotaPressure(capacity).tier : 'unknown' };
    });
}

function analystTable(rows) {
  const cells = [['Number', 'Model', 'Provider', 'Access', 'Estimated cost', 'Quota tier'],
    ...rows.map(r => [r.number, r.modelId, r.provider, r.access, r.estimatedCost, r.quotaTier])];
  const widths = cells[0].map((_, i) => Math.max(...cells.map(row => String(row[i]).length)));
  return cells.map(row => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

// Discovery may read provider metadata, but a preview must not recover runs or
// write benchmark caches. Analysis itself still uses the shared service runner.
async function buildService(homeDir) {
  const { createConversationService } = await import('./service.js');
  const { readArtificialAnalysisModels } = await import('../observability/artificial-analysis-models.js');
  const { readHuggingFaceLeaderboard } = await import('../observability/huggingface-leaderboard.js');
  const noWrite = { mkdir: async () => {}, writeAtomicJson: async () => {} };
  return createConversationService({
    homeDir, env: process.env, recoverRuns: async () => {}, writeRoutingInputCache: async () => {}, appendUsageSamples: async () => {},
    readArtificialAnalysisModels: args => readArtificialAnalysisModels({ ...args, ...noWrite }),
    readHuggingFaceLeaderboard: args => readHuggingFaceLeaderboard({ ...args, ...noWrite })
  });
}

const nextSteps = {
  no_strategy: 'No draft team yet. Run kairo team analyze.',
  no_project: 'No Git project found. Run kairo team analyze --cwd /path/to/project.',
  strategy_active: 'Team is already approved. Run kairo team show.',
  strategy_not_draft: 'Team is not a draft. Run kairo team show.',
  analyzer_required: pickAnalyst,
  analyst_unknown: 'Unknown or unavailable analyst. Run kairo team analysts.',
  analyzer_unavailable: 'Analyst is no longer available. Run kairo team analysts.',
  access_unverified: 'Analyst access is not verified. Run kairo doctor.',
  access_denied: 'Analyst access is denied. Run kairo doctor.',
  access_exhausted: 'Analyst usage is exhausted. Run kairo doctor.',
  approval_blocked: 'Team approval failed validation; draft unchanged. Run kairo team show.',
  confirmation_stale: 'Team changed during confirmation. Run kairo team show.',
  analysis_in_progress: 'Analysis is already running. Wait, then run kairo team show.'
};

const approveCommand = id => (id ? `kairo team approve --yes --proposal ${id}` : 'kairo team approve --yes');
const proposalModel = model => model?.displayName ?? model?.modelId ?? '-';

// A pending proposal is read through the service; a read failure behaves like
// "none pending" so the draft flow keeps working.
async function readPendingProposal(deps, homeDir, cwd) {
  try {
    const service = await (deps.getService ? deps.getService() : buildService(homeDir));
    return typeof service.pendingTeamProposal === 'function' ? { service, pending: await service.pendingTeamProposal({ cwd }) } : { service, pending: null };
  } catch { return { service: null, pending: null }; }
}

function proposalRows(pending, strategy) {
  const current = new Map((strategy?.projectTeam ?? []).map(e => [e.role, proposalModel(e.model)]));
  return (pending.proposal?.projectTeam ?? []).map(e => ({ role: e.role, old: current.get(e.role) ?? '-', new: proposalModel(e.model) }));
}

function proposalGrid(rows) {
  const cells = [['Role', 'Old model', 'New model'], ...rows.map(r => [r.role, r.old, r.new])];
  const widths = cells[0].map((_, i) => Math.max(...cells.map(row => String(row[i]).length)));
  return cells.map(row => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

const proposalCommands = id => `Approve: ${approveCommand(id)}\nReject: kairo team reject --proposal ${id}`;

function proposalRefusal(action, pending, given) {
  const id = pending?.proposalId;
  const code = id ? 'proposal_mismatch' : 'no_pending_proposal';
  const verb = action === 'approve' ? approveCommand(id) : `kairo team reject --proposal ${id}`;
  const error = !id ? 'No pending team proposal. Run kairo team show.'
    : `${given ? `Proposal ${given} is not the pending one. ` : 'Name the proposal you reviewed. '}The current pending proposal is ${id}. Review it with kairo team approve, then run ${verb}.`;
  return { ok: false, action, code, error };
}

// Approve or reject the pending proposal the human viewed; the id is never defaulted.
async function runPendingProposalCli({ action, options, deps, cwd, strategy, service, pending, log }) {
  const finish = (result, text) => { log(options.json ? JSON.stringify(result) : text); return result; };
  if (action === 'approve' && options.yes !== true) {
    const rows = proposalRows(pending, strategy);
    return finish({ ok: true, action, applied: false, pending: { proposalId: pending.proposalId, source: pending.source, roles: rows } },
      `Pending team proposal ${pending.proposalId} (source ${pending.source}). The approved team stays until you approve.\n${proposalGrid(rows)}\nPreview only. Run ${approveCommand(pending.proposalId)}.`);
  }
  if (options.proposal !== pending.proposalId) {
    const refusal = proposalRefusal(action, pending, options.proposal);
    process.exitCode = 1;
    return finish(refusal, refusal.error);
  }
  try {
    if (action === 'approve') await service.approveRecoveryProposal({ cwd, proposalId: pending.proposalId });
    else await service.rejectRecoveryProposal({ cwd, proposalId: pending.proposalId });
  } catch (error) {
    const result = { ok: false, action, code: `${action}_failed`, error: error.message || `Team ${action} failed. Run kairo team show.` };
    process.exitCode = 1;
    return finish(result, result.error);
  }
  return action === 'approve'
    ? finish({ ok: true, action, applied: true, proposalId: pending.proposalId, strategyStatus: 'approved' }, `Team approved from proposal ${pending.proposalId}. Run kairo team show.`)
    : finish({ ok: true, action, applied: true, proposalId: pending.proposalId }, `Proposal ${pending.proposalId} rejected. The approved team is unchanged.`);
}

async function runTeamRejectCli(options, deps) {
  const log = deps.log ?? console.log;
  try {
    const cwd = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    const homeDir = deps.homeDir ?? resolveHomeDir();
    const { service, pending } = await readPendingProposal(deps, homeDir, cwd);
    if (!pending) {
      const refusal = proposalRefusal('reject', null, options.proposal);
      log(options.json ? JSON.stringify(refusal) : refusal.error);
      process.exitCode = 1;
      return refusal;
    }
    return await runPendingProposalCli({ action: 'reject', options, deps, cwd, strategy: null, service, pending, log });
  } catch (error) {
    const result = { ok: false, action: 'reject', code: 'no_project', error: 'No Git project found. Run kairo team analyze --cwd /path/to/project.' };
    log(options.json ? JSON.stringify(result) : result.error);
    process.exitCode = 1;
    return result;
  }
}

// An active team is never replaced by analyze: the shared setup operation stores
// the result as a pending proposal and the approved team keeps routing until the
// human approves. Access checks and the confirmation binding are the ops layer's.
async function finishReanalysis({ options, cwd, strategy, plan, ops, service, log }) {
  const analyst = plan.change.initialAnalyzer;
  if (options.yes !== true) {
    const result = { ok: true, action: 'analyze', applied: false, spend: plan.spend, strategyStatus: statusOf(strategy), analyst };
    log(options.json ? JSON.stringify(result) : `Re-analyze this project with an approved team: ${cwd}\nAnalyst: ${analyst.model} (${analyst.provider}). This spends provider usage.\nThe approved team keeps routing; the result is stored as a pending proposal.\nPreview only. Run kairo team analyze --analyst ${analyst.modelId}${options.goal ? ` --goal ${JSON.stringify(options.goal)}` : ''} --yes to store a pending proposal.`);
    return result;
  }
  const analysis = await ops.runAnalysis({ confirmationTarget: plan.confirmationTarget });
  if (analysis?.pending !== true || !analysis.proposalId) throw new ConversationOperationError('analyze_failed');
  const pending = await service.pendingTeamProposal({ cwd });
  const rows = pending ? proposalRows(pending, strategy) : [];
  const result = { ok: true, action: 'analyze', applied: true, pending: true, proposalId: analysis.proposalId, strategyStatus: 'approved', roles: rows };
  log(options.json ? JSON.stringify(result) : [`Proposal ${analysis.proposalId} stored. The approved team keeps routing until you approve.`, rows.length ? proposalGrid(rows) : '', proposalCommands(analysis.proposalId)].filter(Boolean).join('\n'));
  return result;
}

const rebuildStatus = r => (r.new.model ? (r.new.assignmentState === 'degraded' ? 'draft (degraded)' : r.new.assignmentState === 'blocked' ? 'draft (blocked)' : 'draft') : 'draft (blocked)');

/**
 * kairo team rebuild [--yes]: recompute the team from the stored analysis with
 * today's logic. Never calls a model or the analyst runner; --yes saves a draft.
 */
export async function runTeamRebuildCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  try {
    const cwd = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    const homeDir = deps.homeDir ?? resolveHomeDir();
    const service = await (deps.getService ? deps.getService() : buildService(homeDir));
    const out = await service.rebuildProjectTeam({ cwd, yes: options.yes === true });
    const rows = out.roles.map(r => ({ role: r.role, old: r.old.model ?? '-', new: r.new.model ?? '-', status: r.changed ? rebuildStatus(r) : `${rebuildStatus(r)} (unchanged)` }));
    const cells = [['Role', 'Old model', 'New model', 'Status'], ...rows.map(r => [r.role, r.old, r.new, r.status])];
    const widths = cells[0].map((_, i) => Math.max(...cells.map(row => String(row[i]).length)));
    const grid = cells.map(row => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
    const why = out.roles.filter(r => r.why).map(r => `${r.role}: ${r.why}`).join('\n');
    const tail = !out.changed ? 'Nothing changed; the stored team already matches today\'s logic.'
      : out.applied ? (out.pending ? `Draft saved as a pending proposal; the approved team stays until you approve. Run ${approveCommand(out.proposalId)}.` : 'Draft team saved. Run kairo team show, then kairo team approve --yes.')
      : 'Preview only. Run kairo team rebuild --yes to save a draft.';
    const result = { ok: true, action: 'rebuild', ...out };
    log(options.json ? JSON.stringify(result) : [grid, why, tail].filter(Boolean).join('\n'));
    return result;
  } catch (error) {
    const result = { ok: false, action: 'rebuild', code: error.code ?? 'rebuild_failed', error: error.code === 'no_analysis' ? error.message : 'Team rebuild failed. Run kairo team show or kairo doctor.' };
    log(options.json ? JSON.stringify(result) : result.error);
    process.exitCode = 1;
    return result;
  }
}

const modelIdentity = model => model ? `${model.adapterId}/${model.modelId}` : null;
const localTime = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'no reset data';
const phaseRole = entry => entry.model ? `${entry.role}: ${modelIdentity(entry.model)}`
  : `${entry.role}: waiting${Number.isFinite(Date.parse(entry.waitUntil)) ? ` until ${localTime(entry.waitUntil)}` : ' (no reset data)'}`;

function allRolesWaiting(team = []) {
  if (!team.length || team.some(entry => entry.model)) return null;
  const resets = team.map(entry => Date.parse(entry.waitUntil)).filter(Number.isFinite);
  if (!resets.length) return 'All roles wait (no reset data)';
  const missing = team.length - resets.length;
  return `All roles wait until ${localTime(new Date(Math.min(...resets)).toISOString())}${missing ? ` (${missing} roles: no reset data)` : ''}`;
}

function phaseChanges(phasePlan, phase) {
  const waiting = allRolesWaiting(phase.team);
  if (waiting) return waiting;
  const ideal = new Map((phasePlan.idealTeam ?? []).map(entry => [entry.role, modelIdentity(entry.model)]));
  return (phase.team ?? []).filter(entry => !entry.model || modelIdentity(entry.model) !== ideal.get(entry.role))
    .map(phaseRole).join('; ') || 'No changes from ideal team';
}

function phaseSummary(phasePlan, now) {
  const { phases, index, phase } = currentTeamPhase(phasePlan, now);
  if (!phase) return 'Current phase: none';
  const next = phases.slice(index + 1).find(candidate =>
    JSON.stringify((candidate.team ?? []).map(phaseRole)) !== JSON.stringify((phase.team ?? []).map(phaseRole)));
  const changes = allRolesWaiting(next?.team) || next?.team?.filter(entry => {
    const before = phase.team?.find(row => row.role === entry.role);
    return modelIdentity(entry.model) !== modelIdentity(before?.model) || entry.waitUntil !== before?.waitUntil;
  }).map(phaseRole).join('; ');
  return `Current phase: ${index + 1}. Next change: ${next ? `${localTime(next.startsAt)} — ${changes}` : 'none in this forecast'}.`;
}

function compactPhases(phasePlan, phases, now, all) {
  const until = now + 24 * 60 * 60 * 1000;
  const rows = [];
  for (const phase of phases) {
    if (!all && (Date.parse(phase.startsAt) >= until || (phase.endsAt && Date.parse(phase.endsAt) <= now))) continue;
    const endsAt = !all && (!phase.endsAt || Date.parse(phase.endsAt) > until) ? new Date(until).toISOString() : phase.endsAt;
    const changes = phaseChanges(phasePlan, phase);
    const previous = rows.at(-1);
    if (previous?.changes === changes && Date.parse(previous.endsAt) === Date.parse(phase.startsAt)) previous.endsAt = endsAt;
    else rows.push({ ...phase, endsAt, changes });
  }
  return rows;
}

async function runTeamPlanCli(options, deps) {
  const log = deps.log ?? console.log;
  try {
    const cwd = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    const homeDir = deps.homeDir ?? resolveHomeDir();
    const service = await (deps.getService ? deps.getService() : buildService(homeDir));
    const { phasePlan } = await service.rebuildProjectTeam({ cwd, yes: false });
    const now = (deps.now ?? Date.now)();
    const { phases } = currentTeamPhase(phasePlan, now);
    // The shared CLI parser already maps --all to helpAll; do not change JSON.
    const all = options.all === true || options.helpAll === true;
    const visible = compactPhases(phasePlan, phases, now, all);
    const cells = [['Phase', 'From (local)', 'Until (local)', 'Changes from ideal / waiting'],
      ...visible.map((phase, index) => [index + 1, localTime(phase.startsAt),
        phase.endsAt ? localTime(phase.endsAt) : 'onward', phase.changes])];
    const widths = cells[0].map((_, i) => Math.max(...cells.map(row => String(row[i]).length)));
    const grid = cells.map(row => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
    const scope = all ? '' : '\nNext 24 hours. Run kairo team plan --all for the full forecast.';
    log(options.json ? JSON.stringify(phasePlan) : `${phaseSummary({ ...phasePlan, phases: visible }, now)}\n${grid}${scope}`);
    return phasePlan;
  } catch (error) {
    const result = { ok: false, action: 'plan', code: error.code ?? 'plan_failed',
      error: error.code === 'no_analysis' ? error.message : 'Team plan failed. Run kairo team show or kairo doctor.' };
    log(options.json ? JSON.stringify(result) : result.error);
    process.exitCode = 1;
    return result;
  }
}

/** Plain CLI over the same fresh plan/confirmation operations as MCP. */
export async function runTeamCli(options, deps = {}) {
  if (options.teamAction === 'providers') return (await import('./providers-cli.js')).runTeamProvidersCli(options, deps);
  if (options.teamAction === 'running') return (await import('./running-cli.js')).runTeamRunningCli(options, deps);
  if (options.teamAction === 'pacing') return (await import('./pacing-cli.js')).runTeamPacingCli(options, deps);
  if (options.teamAction === 'plan') return runTeamPlanCli(options, deps);
  if (options.teamAction === 'routes') return (await import('./team-plan.js')).runTeamRoutesCli(options, deps);
  if (options.teamAction === 'rebuild') return runTeamRebuildCli(options, deps);
  if (options.teamAction === 'reject') return runTeamRejectCli(options, deps);
  const log = deps.log ?? console.log;
  const action = options.teamAction;
  let stage = 'project';
  try {
    const cwd = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    stage = action;
    const homeDir = deps.homeDir ?? resolveHomeDir();
    const readStrategy = () => readProjectStrategy(homeDir, cwd);
    const strategy = await readStrategy();
    if (!['analyze', 'analysts'].includes(action) && !strategy) throw new ConversationOperationError('no_strategy');
    const reanalysis = action === 'analyze' && strategy?.status === 'active';
    if (action === 'approve') {
      const { service, pending } = await readPendingProposal(deps, homeDir, cwd);
      if (pending) return await runPendingProposalCli({ action, options, deps, cwd, strategy, service, pending, log });
    }
    let result;
    let reformLine = null;
    let pendingReform = null;
    if (action === 'show') {
      const reformLog = await readTeamReform(homeDir, cwd);
      pendingReform = unannouncedReform(reformLog);
      const host = resolveActiveHost({ host: options.roleHost, env: deps.env ?? process.env });
      let team = rowsOf(strategy);
      if (host.id && strategy.status === 'active') team = await Promise.all(team.filter(row => row.role !== 'Orchestrator').map(async row => {
        if (row.role === 'Project Analyst') return hostAllowsProvider(host, row.provider) ? row
          : { ...row, provider: '-', model: '-', status: 'host-incompatible' };
        try {
          const route = await readTeamRoute({ role: row.role, cwd, homeDir, activeHost: host });
          return { ...row, provider: route.decision === 'ROUTED' ? route.provider : '-',
            model: route.decision === 'ROUTED' ? route.model.displayName ?? route.model.modelId : '-',
            status: route.decision === 'ROUTED' ? row.status : route.decision.toLowerCase(),
            ...(route.decision !== 'ROUTED' ? { reason: route.why } : {}) };
        } catch (error) { return { ...row, provider: '-', model: '-', status: 'unavailable', reason: error.message }; }
      }));
      // Read-only exposure of the automatic re-form log (for the T9 pane and scripts).
      const { pending: proposal } = strategy.status === 'active' ? await readPendingProposal(deps, homeDir, cwd) : { pending: null };
      result = { ok: true, action, strategyStatus: statusOf(strategy), team, ...(host.id ? { host } : {}),
        ...(proposal ? { pendingProposal: { proposalId: proposal.proposalId, source: proposal.source } } : {}),
        reform: { latest: reformLog.entries.at(-1) ?? null, entries: reformLog.entries, announced: !pendingReform } };
      if (pendingReform && options.json !== true) reformLine = reformNoticeLine(pendingReform);
    } else {
      // Approval preview needs only persisted assignments, not provider discovery.
      let service;
      const getService = async () => {
        if (service) return service;
        if (action === 'approve' && options.yes !== true) {
          service = { readSetup: async () => ({ strategy: await readStrategy(), knownCandidates: [], claudeEntitlement: {}, cursorAccess: {} }) };
        } else {
          const original = await (deps.getService ? deps.getService() : buildService(homeDir));
          service = Object.create(original);
          // Keep MCP's default catalog behavior unchanged. CLI choices use
          // unranked bootstrap-adapter inventory through preview and confirmation.
          service.readSetup = args => original.readSetup({ ...args, analystMode: 'manual' });
          service.preflightProject = args => original.preflightProject({ ...args, analystMode: 'manual' });
          service.runBootstrapAnalysis = args => original.runBootstrapAnalysis({ ...args, projectGoal: options.goal ?? null });
          // The service returns validation refusals as values. Do not let the
          // setup projection turn a refusal into an apparent successful approval.
          service.approveProjectStrategy = async args => {
            const approved = await original.approveProjectStrategy(args);
            if (approved?.ok === false) throw new ConversationOperationError('approval_blocked');
            return approved;
          };
        }
        return service;
      };
      const ops = createConversationOperations({ cwd, getService });
      let analyzerKey;
      if (action === 'analyze' || action === 'analysts') {
        const facts = await (await getService()).readSetup({ cwd });
        const analysts = analystRows(facts);
        if (action === 'analysts' || !options.analyst) {
          if (action === 'analyze' && options.yes === true) throw new ConversationOperationError('analyzer_required');
          result = { ok: true, action, applied: false, analysts,
            ...(action === 'analyze' ? { message: pickAnalyst } : {}) };
          log(options.json ? JSON.stringify(result) : analystTable(analysts) + (action === 'analyze' ? `\n${pickAnalyst}` : ''));
          return result;
        }
        const selection = String(options.analyst);
        const matches = analysts.filter(a => a.modelId === selection || a.candidateKey === selection);
        const selected = matches.length === 1 ? matches[0]
          : matches.length === 0 && /^[1-9]\d*$/.test(selection) ? analysts[Number(selection) - 1] : null;
        if (!selected) throw new ConversationOperationError('analyst_unknown');
        analyzerKey = selected.candidateKey;
      }
      const plan = await ops.planSetup({ action: action === 'analyze' ? 'run_analysis' : 'approve_team', analyzerKey });
      if (plan.decision !== 'READY') throw new ConversationOperationError(plan.reasonCode);
      if (reanalysis) return await finishReanalysis({ options, cwd, strategy, plan, ops, service: await getService(), log });
      if (options.yes !== true) {
        result = { ok: true, action, applied: false, spend: plan.spend, strategyStatus: statusOf(strategy),
          ...(action === 'analyze' ? { analyst: plan.change.initialAnalyzer } : { team: rowsOf(strategy), warnings: plan.warnings }) };
      } else {
        const applied = await (action === 'analyze' ? ops.runAnalysis : ops.approveTeam)({ confirmationTarget: plan.confirmationTarget });
        result = { ok: true, applied: true, ...applied, action,
          strategyStatus: applied.strategyStatus === 'active' ? 'approved' : applied.strategyStatus };
      }
    }
    let human;
    if (action === 'show') {
      const header = result.host
        ? `Host: ${result.host.id} (${result.host.source})\nOrchestrator: your current session model (HOST, as selected in your session)`
        : orchestratorLine(strategy);
      const forecast = strategy.phasePlan ? phaseSummary(strategy.phasePlan, (deps.now ?? Date.now)()) : '';
      const notes = [result.host ? [...new Set(result.team.map(row => row.reason).filter(Boolean))].join('\n') : '',
        forecast ? `${result.host ? 'Shared-team forecast (not a host route): ' : ''}${forecast}` : ''].filter(Boolean).join('\n');
      const proposalNote = result.pendingProposal
        ? `Pending team proposal ${result.pendingProposal.proposalId} (source ${result.pendingProposal.source}); the approved team stays until you approve.\n${proposalCommands(result.pendingProposal.proposalId)}` : '';
      human = [reformLine, header, table(result.team), notes, proposalNote].filter(Boolean).join('\n');
    }
    else if (!result.applied && action === 'analyze') {
      const goal = options.goal ? `Goal: ${options.goal}` : 'No project goal given. Add --goal "TEXT" or .kairo/goal.md.';
      human = `Analyze a sanitized snapshot of this project: ${cwd}\n${goal}\nAnalyst: ${result.analyst.model} (${result.analyst.provider}). This spends provider usage.\nPreview only. Run kairo team analyze --analyst ${result.analyst.modelId}${options.goal ? ` --goal ${JSON.stringify(options.goal)}` : ''} --yes to create a draft team.`;
    }
    else if (!result.applied) human = `Approve this draft team:\n${table(result.team)}\n${result.warnings.length ? result.warnings.join('\n') + '\n' : ''}Preview only. Run kairo team approve --yes.`;
    else human = action === 'analyze' ? 'Draft team created. Run kairo team show, then kairo team approve --yes.' : 'Team approved. Run kairo team roles init --yes.';
    log(options.json ? JSON.stringify(result) : human);
    if (reformLine) await markReformAnnounced(homeDir, cwd, pendingReform);
    return result;
  } catch (error) {
    const code = stage === 'project' ? 'no_project' : error.code ?? `${action}_failed`;
    const result = { ok: false, action, code, error: nextSteps[code] ?? `Team ${action} failed. Run kairo team show or kairo doctor.` };
    log(options.json ? JSON.stringify(result) : result.error);
    process.exitCode = 1;
    return result;
  }
}
