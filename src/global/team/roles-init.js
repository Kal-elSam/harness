import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readProjectStrategy } from './project-strategy-store.js';
import { loadProjectRoleCatalog } from '../intelligence/role-catalog.js';
import { discoverInstalledAgents } from '../hosts/installed-agents.js';
import { readIfExists, backupExclusive } from '../file-safety.js';
import { writeAtomicJson } from '../runtime/write-atomic-json.js';

const TOKENS = { builder: 'Builder', explorer: 'Explorer', researcher: 'Researcher', reviewer: 'Reviewer', tester: 'Tester', verifier: 'Verifier', planner: 'Planner', architect: 'Architect', debugger: 'Debugger', documenter: 'Documenter' };
function matchRole(agent, registry) {
  const exact = Object.entries(registry).filter(([id, role]) => id === agent.name || (role.agents ?? []).some(a => (typeof a === 'string' ? a : a.name) === agent.name)).map(([id]) => id);
  if (exact.length === 1) return { id: exact[0] };
  if (exact.length > 1) return { reason: `Ambiguous exact role matches: ${exact.join(', ')}` };
  const tokens = agent.name.toLowerCase().replace(/-(?:claude|codex|opencode|cursor|gemini|openai|anthropic)$/, '').split(/[^a-z0-9]+/);
  const matched = [...new Set(tokens.filter(t => TOKENS[t]).map(t => TOKENS[t]))];
  if (matched.length > 1) return { reason: `Ambiguous role tokens: ${matched.join(', ')}` };
  if (matched.length === 1 && registry[matched[0]]) return { id: matched[0] };
  return { reason: matched.length ? `No ${tokens.find(t => TOKENS[t])} role in project catalog` : 'No matching role name or token in project catalog' };
}

export async function initProjectRoles({ projectRoot, homeDir, yes = false, env, now = Date.now }) {
  const strategy = await readProjectStrategy(homeDir, projectRoot);
  if (strategy?.status !== 'active' || !strategy.projectTeam?.length) {
    throw new Error('No approved team for this project. Analyze and approve a project team first: run kairo team analyze --yes, then kairo team approve --yes. MCP alternative: kairo_setup_plan, kairo_setup_run_analysis, kairo_setup_approve_team. init never runs analysis or calls a model.');
  }
  const path = join(projectRoot, '.kairo', 'roles.json');
  const text = await readIfExists(path);
  if (text?.symlink) throw new Error(`Refusing symlink: ${path}`);
  const doc = text === null ? { roles: [] } : JSON.parse(text);
  const catalog = loadProjectRoleCatalog({ projectRoot });
  if (catalog.warnings.length) throw new Error(`Cannot merge roles: ${catalog.warnings.join('; ')}`);
  const { agents, warnings } = await discoverInstalledAgents({ projectRoot, homeDir, env });
  const next = structuredClone(doc);
  const unmapped = [];
  const conflicts = [];
  const approved = new Set(strategy.projectTeam.map(r => r.role));
  const before = JSON.stringify(next);
  for (const agent of agents.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))) {
    const { body, ...info } = agent;
    if (!agent.adapterId) { unmapped.push({ ...info, reason: agent.reason }); continue; }
    const match = matchRole(agent, catalog.registry);
    if (!match.id) { unmapped.push({ ...info, reason: match.reason }); continue; }
    let role = next.roles.find(r => r.id === match.id);
    const claimed = next.roles.flatMap(r => (r.agents ?? []).filter(a => (typeof a === 'string' ? a : a.name) === agent.name).map(a => ({ id: r.id, agent: a })));
    if (claimed.some(c => c.id !== match.id || typeof c.agent === 'string' || c.agent.adapterId !== agent.adapterId)) {
      conflicts.push({ ...info, reason: `${agent.name} already registered with another role, provider, or provider-less alias; preserved existing entry` }); continue;
    }
    if (claimed.length) continue;
    const roleInfo = catalog.registry[match.id];
    if (!approved.has(match.id) && !approved.has(roleInfo.sourceRole)) {
      unmapped.push({ ...info, reason: `Role ${match.id} is not in the analysis-approved team` }); continue;
    }
    if (!role) { role = { id: match.id, agents: [] }; next.roles.push(role); }
    role.agents ??= [];
    if (role.agents.some(a => typeof a === 'object' && a.adapterId === agent.adapterId)) conflicts.push({ ...info, reason: `Role ${match.id} already has an agent for ${agent.adapterId}; existing first launch target preserved` });
    role.agents.push({ name: agent.name, adapterId: agent.adapterId });
  }
  const changed = JSON.stringify(next) !== before;
  let backupPath = null;
  if (yes && changed) {
    await mkdir(dirname(path), { recursive: true });
    if (text !== null) backupPath = await backupExclusive(path, now());
    await writeAtomicJson(path, next, { createExclusive: text === null });
  }
  return { ok: true, action: 'init', path, applied: yes && changed, changed, backupPath, roles: next.roles, unmapped, conflicts, warnings };
}

export async function runTeamRolesInitCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  try {
    const projectRoot = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    const result = await initProjectRoles({ projectRoot, homeDir: deps.homeDir ?? resolveHomeDir(), yes: options.yes === true, env: deps.env ?? process.env, now: deps.now });
    log(options.json ? JSON.stringify(result) : [result.applied ? `Wrote ${result.path}` : `Preview only (or unchanged); pass --yes to write ${result.path}`,
      ...result.roles.map(r => `${r.id}: ${(r.agents ?? []).map(a => typeof a === 'string' ? a : `${a.name} (${a.adapterId})`).join(', ')}`),
      ...result.unmapped.map(a => `unmapped ${a.name}: ${a.reason}`), ...result.conflicts.map(a => `conflict ${a.name}: ${a.reason}`), ...result.warnings].join('\n'));
    return result;
  } catch (error) {
    log(options.json ? JSON.stringify({ ok: false, error: error.message }) : error.message);
    process.exitCode = 1;
    return null;
  }
}
