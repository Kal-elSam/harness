import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readProjectStrategy } from './project-strategy-store.js';
import { createConversationOperations, ConversationOperationError } from './operations.js';

const statusOf = strategy => ({ suggested: 'draft', active: 'approved' }[strategy?.status] ?? strategy?.status ?? 'none');
const rowsOf = strategy => [
  ...(strategy?.bootstrapAnalyst ? [{ role: 'Project Analyst', model: strategy.bootstrapAnalyst }] : []),
  ...(strategy?.orchestrator ? [{ role: 'Orchestrator', model: strategy.orchestrator }] : []),
  ...(strategy?.projectTeam ?? [])
].map(({ role, model }) => ({ role, model: model?.displayName ?? model?.modelId ?? '-', provider: model?.adapterId ?? '-', status: statusOf(strategy) }));

function table(rows) {
  const cells = [['Role', 'Model', 'Provider', 'Status'], ...rows.map(r => [r.role, r.model, r.provider, r.status])];
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
    homeDir, recoverRuns: async () => {},
    readArtificialAnalysisModels: args => readArtificialAnalysisModels({ ...args, ...noWrite }),
    readHuggingFaceLeaderboard: args => readHuggingFaceLeaderboard({ ...args, ...noWrite })
  });
}

const nextSteps = {
  no_strategy: 'No draft team yet. Run kairo team analyze.',
  no_project: 'No Git project found. Run kairo team analyze --cwd /path/to/project.',
  strategy_active: 'Team is already approved. Run kairo team show.',
  strategy_not_draft: 'Team is not a draft. Run kairo team show.',
  analyzer_unavailable: 'No recommended analyst is available. Run kairo doctor.',
  access_unverified: 'Analyst access is not verified. Run kairo doctor.',
  access_denied: 'Analyst access is denied. Run kairo doctor.',
  access_exhausted: 'Analyst usage is exhausted. Run kairo doctor.',
  approval_blocked: 'Team approval failed validation; draft unchanged. Run kairo team show.',
  confirmation_stale: 'Team changed during confirmation. Run kairo team show.',
  analysis_in_progress: 'Analysis is already running. Wait, then run kairo team show.'
};

/** Plain CLI over the same fresh plan/confirmation operations as MCP. */
export async function runTeamCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  const action = options.teamAction;
  let stage = 'project';
  try {
    const cwd = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    stage = action;
    const homeDir = deps.homeDir ?? resolveHomeDir();
    const readStrategy = () => readProjectStrategy(homeDir, cwd);
    const strategy = await readStrategy();
    if (action !== 'analyze' && !strategy) throw new ConversationOperationError('no_strategy');
    if (action === 'analyze' && strategy?.status === 'active') throw new ConversationOperationError('strategy_active');
    let result;
    if (action === 'show') {
      result = { ok: true, action, strategyStatus: statusOf(strategy), team: rowsOf(strategy) };
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
      if (action === 'analyze') {
        const setup = await ops.setup();
        analyzerKey = setup.analyzers.find(a => a.recommended && a.available)?.candidateKey;
        if (!analyzerKey) throw new ConversationOperationError('analyzer_unavailable');
      }
      const plan = await ops.planSetup({ action: action === 'analyze' ? 'run_analysis' : 'approve_team', analyzerKey });
      if (plan.decision !== 'READY') throw new ConversationOperationError(plan.reasonCode);
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
    if (action === 'show') human = table(result.team);
    else if (!result.applied && action === 'analyze') human = `Analyze a sanitized snapshot of this project: ${cwd}\nAnalyst: ${result.analyst.model} (${result.analyst.provider}). This spends provider usage.\nPreview only. Run kairo team analyze --yes to create a draft team.`;
    else if (!result.applied) human = `Approve this draft team:\n${table(result.team)}\n${result.warnings.length ? result.warnings.join('\n') + '\n' : ''}Preview only. Run kairo team approve --yes.`;
    else human = action === 'analyze' ? 'Draft team created. Run kairo team show, then kairo team approve --yes.' : 'Team approved. Run kairo team roles init --yes.';
    log(options.json ? JSON.stringify(result) : human);
    return result;
  } catch (error) {
    const code = stage === 'project' ? 'no_project' : error.code ?? `${action}_failed`;
    const result = { ok: false, action, code, error: nextSteps[code] ?? `Team ${action} failed. Run kairo team show or kairo doctor.` };
    log(options.json ? JSON.stringify(result) : result.error);
    process.exitCode = 1;
    return result;
  }
}
