import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readProjectStrategy } from './project-strategy-store.js';
import { mapGentleRolePicks } from '../intelligence/gentle-role-map.js';
import { planGentleStateWrite, applyGentleStateWrite, ODD_KEYS } from '../gentle-state-writer.js';
import { planClaudeOddBridge, applyClaudeOddBridge } from '../claude-odd-bridge.js';

const NO_TEAM = 'No approved team for this project. Run kairo team analyze --analyst MODEL --yes, then kairo team approve --yes, before kairo team apply.';

/**
 * Compose the approved team into gentle-ai state and the Claude ODD bridge.
 * Both targets are planned before either is applied, so a refusal writes nothing.
 */
export async function applyProjectTeam({ projectRoot, homeDir, yes = false, now }) {
  const strategy = await readProjectStrategy(homeDir, projectRoot);
  if (strategy?.status !== 'active' || !strategy.projectTeam?.length) throw new Error(NO_TEAM);
  const mapping = mapGentleRolePicks(strategy.projectTeam);
  const { picks } = mapping;
  const statePlan = await planGentleStateWrite({ homeDir, picks });
  const bridgePlan = await planClaudeOddBridge({ homeDir, picks });
  const refusals = [...(statePlan.ok ? [] : statePlan.reasons), ...(bridgePlan.ok ? [] : bridgePlan.reasons)];
  const strip = ({ roles, ...rest }) => ({ ...rest, roles: roles?.map(({ content, ...r }) => r) });
  if (refusals.length) return { ok: false, applied: false, ...mapping, state: strip(statePlan), bridge: strip(bridgePlan), refusals };
  if (!yes) return { ok: true, applied: false, ...mapping, state: strip(statePlan), bridge: strip(bridgePlan), refusals: [] };
  const state = await applyGentleStateWrite({ homeDir, picks, yes: true, now });
  const bridge = await applyClaudeOddBridge({ homeDir, picks, yes: true, now });
  return { ok: true, applied: state.applied || bridge.applied, ...mapping, state: strip(state), bridge: strip(bridge), refusals: [] };
}

function render(result) {
  const lines = [result.applied ? 'Applied the approved team.' : result.ok ? 'Preview only; pass --yes to apply.' : 'Refused; nothing written.'];
  for (const key of ODD_KEYS) {
    const pick = result.picks[key];
    lines.push(pick ? `${key}: ${pick.role} -> ${pick.model}${pick.effort ? ` (${pick.effort})` : ''}` : `${key}: no pick`);
  }
  const { state, bridge } = result;
  lines.push(`gentle-ai state: ${state.path}`);
  for (const [key, c] of Object.entries(state.changes ?? {})) lines.push(`  change ${key}: ${JSON.stringify(c.current)} -> ${JSON.stringify(c.next)}`);
  for (const key of state.unchanged ?? []) lines.push(`  unchanged ${key}`);
  for (const k of state.keptManual ?? []) lines.push(`  kept manual pick ${k.key}: ${JSON.stringify(k.current)}`);
  if (state.backupPath) lines.push(`  backup: ${state.backupPath}`);
  lines.push('Claude bridge files:');
  for (const r of bridge.roles ?? []) lines.push(`  ${r.action} ${r.path} (model ${r.model})${r.backupPath ? ` backup: ${r.backupPath}` : ''}`);
  for (const u of result.unmapped) lines.push(`unmapped ${u.role}: no ODD counterpart`);
  for (const i of result.incompatible) lines.push(`incompatible ${i.role}: ${i.reason}`);
  for (const reason of result.refusals) lines.push(`refused: ${reason}`);
  return lines.join('\n');
}

export async function runTeamApplyCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  try {
    const projectRoot = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    const result = await applyProjectTeam({ projectRoot, homeDir: deps.homeDir ?? resolveHomeDir(), yes: options.yes === true, now: deps.now });
    log(options.json ? JSON.stringify(result) : render(result));
    if (!result.ok) process.exitCode = 1;
    return result;
  } catch (error) {
    if (options.json) log(JSON.stringify({ ok: false, error: error.message }));
    else (deps.logError ?? console.error)(error.message);
    process.exitCode = 1;
    return null;
  }
}
