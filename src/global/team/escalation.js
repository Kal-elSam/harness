import { validateDelegationHandoff, validateEscalation } from './delegation-contract.js';
import { recordEscalation } from './escalation-budget.js';
import { readTeamRoute } from './routing-input-cache.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { resolveHomeDir } from '../paths.js';

/** Admit a frontier decision, never an implementation launch or a host-session replacement. */
export async function escalateTeam({ handoff, cwd, homeDir = resolveHomeDir() }, deps = {}) {
  try {
    validateDelegationHandoff(handoff);
    validateEscalation(handoff.escalation);
  } catch (error) {
    return { ok: false, code: error.code ?? 'invalid_handoff', reason: error.message };
  }
  const projectRoot = await (deps.resolveRoot ?? resolveProjectRoot)(cwd);
  let authority;
  try {
    authority = await (deps.readTeamRoute ?? readTeamRoute)({ role: 'Frontier Authority', cwd: projectRoot, homeDir }, deps);
  } catch (error) {
    return { ok: false, code: 'frontier_authority_unavailable', reason: error.message };
  }
  // STALE and WAIT are not assignments that may spend the shared budget.
  if (authority.decision !== 'ROUTED' || !authority.model || !authority.provider) {
    return { ok: false, code: 'frontier_authority_unavailable', reason: authority.why ?? 'No available Frontier Authority model.' };
  }
  const admission = await recordEscalation(homeDir, projectRoot, handoff.escalation, deps);
  const budget = { used: admission.used, cap: admission.cap, remaining: admission.remaining, windowDays: admission.windowDays };
  if (!admission.ok) return { ok: false, code: admission.code, reason: admission.code === 'escalation_budget_busy'
    ? 'Another escalation is updating the budget; retry.' : 'The shared escalation budget is exhausted.', budget };
  return { ok: true, authority, budget };
}
