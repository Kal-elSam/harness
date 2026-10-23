// Kairo versions of the hand-built Claude Code hooks, called by the kairo-router
// plugin: agent enforcement, plan-approval dispatch and relevant-only CodeGraph
// prompt context. Every command is read-mostly and the plugin fails open when
// any of them is unavailable.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { harnessHomePaths, resolveHomeDir } from '../paths.js';
import { projectKeyForPath } from '../next/project-key.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { loadProjectRoleCatalog, agentNameToRole, WORK_ROLE_ALIASES } from '../intelligence/role-catalog.js';
import { slugRole } from '../hosts/render.js';

/** Claude Code's own helper agents, never routed through Kairo roles. */
const HOST_AGENTS = new Set(['claude-code-guide', 'statusline-setup']);
const LISTED_ROLES = 10;

/** Agent names that launch a role: its own agents first, then the work aliases that point at it. */
function namesForRole(catalog, id) {
  const own = (catalog.registry[id]?.agents ?? []).map(agent => typeof agent === 'string' ? agent : agent.name);
  const aliases = Object.entries(WORK_ROLE_ALIASES).filter(([, role]) => role === id).map(([name]) => name);
  return [...new Set([...own, ...aliases])];
}

/**
 * Only Kairo-routable agents may launch: catalog agents and role ids (user,
 * Kairo and gentle-ai roles), Kairo provider wrappers (kairo-*), plugin agents
 * (namespace:name), Claude Code's own helpers and the agents the user defined
 * (userAgents). Anything else, including the default general-purpose agent,
 * inherits the orchestrator's model and skips the per-launch route.
 */
export function evaluateAgentLaunch(subagentType, catalog, userAgents = new Set()) {
  const name = typeof subagentType === 'string' ? subagentType.trim() : '';
  if (name && (agentNameToRole(catalog).byAgent.has(name) || name.startsWith('kairo-') || name.includes(':') || HOST_AGENTS.has(name) || userAgents.has(name))) {
    return { allowed: true };
  }
  const roles = Object.entries(catalog.registry)
    .filter(([, entry]) => entry.owner !== 'gentle-ai')
    .map(([id]) => [id, namesForRole(catalog, id)])
    .filter(([, names]) => names.length)
    .slice(0, LISTED_ROLES)
    .map(([id, names]) => `${id} -> ${names.join(' or ')}`);
  return {
    allowed: false,
    reason: `Blocked subagent_type '${name || '<default general-purpose>'}': generic agents inherit the orchestrator model and skip Kairo routing. `
      + `Launch a Kairo role agent instead: ${roles.join('; ') || 'run kairo team roles init to register agents'}. `
      + 'If no delegation trigger applies, do the work inline.'
  };
}

// A role without agents is launched by the file roles sync installs for it: the slugged role id.
const agentFor = (catalog, id) => namesForRole(catalog, id)[0] ?? slugRole(id) ?? id;
const CONSTRAINED = new Set(['CONSERVE', 'CRITICAL']);

/** Instructions injected once, right after a plan is approved. Generic: agent names come from the catalog. */
export function buildDispatchContext({ catalog, pacing, planPath, saved }) {
  const tiers = Object.entries(pacing?.providers ?? {}).filter(([, p]) => p?.tier);
  const constrained = tiers.length > 0 && tiers.every(([, p]) => CONSTRAINED.has(p.tier));
  const critic = constrained
    ? 'Plan critic: skip (every provider with quota data is constrained).'
    : `Plan critic (LARGE or HIGH-RISK only): launch one ${agentFor(catalog, 'Reviewer')} in background to critique the saved plan before the first writer starts; fold blocker fixes into the tasks yourself and ask the user first only when a fix changes business scope.`;
  const plan = saved
    ? `Approved plan saved at ${planPath} for the plan critic.`
    : 'The approved plan could not be saved; give the plan critic the approved plan directly.';
  const quota = tiers.length ? `Quota now: ${tiers.map(([name, p]) => `${name} ${p.tier}`).join(', ')}. ` : '';
  return `PLAN APPROVED. Do not ask the user which agent or model to use; Kairo routes every launch.
${plan}
STEP 1 - classify the task: SMALL when it is understood, touches nothing high-risk and could be resumed from the original request and the diff; otherwise LARGE or HIGH-RISK.
- SMALL: implement inline in this session, even across files. No team agents, no plan critic. Write the failing test first when a runnable test exists, run the focused test and the suite once each.
STEP 2 - LARGE or HIGH-RISK: delegate only where a trigger fires.
- Mapping or codebase search -> ${agentFor(catalog, 'Explorer')}.
- Heavy independent writer unit -> ${agentFor(catalog, 'Builder')}.
- Tests, lint, build -> ${agentFor(catalog, 'Tester')}; builders write the tests, the tester only runs them.
- Stuck debugging -> ${agentFor(catalog, 'Debugger')}.
- Independent review of a high-risk change -> ${agentFor(catalog, 'Reviewer')}.
${critic}
Writer routing: ${quota}follow the latest "Pacing:" line and the automatic Kairo route; do not pick a provider or model yourself.
Rules: launch agents in background. Independent read-only agents may run in parallel; ONE writer at a time. Give each writer "## Allowed edit surfaces" and "## Verification" sections. Report only the verified outcome, failures and next step.`;
}

export const lastPlanPath = (homeDir, projectRoot) =>
  join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(projectRoot), 'last-plan.md');

async function readStdin(stdin = process.stdin) {
  if (stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** YAML scalar of `name:`: a quoted value up to its closing quote, else the plain value before a ` #` comment. */
function frontmatterName(front) {
  const raw = /^name:[ \t]*(.*)$/m.exec(front ?? '')?.[1]?.trim();
  if (!raw) return undefined;
  const quoted = /^(['"])(.*?)\1/.exec(raw);
  const value = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim();
  return value || undefined;
}

/** Agent names defined in ~/.claude/agents and <project>/.claude/agents: the frontmatter name, else the file name. */
export async function readUserAgentNames(dirs) {
  const names = new Set();
  for (const dir of dirs) {
    let files = [];
    try { files = (await readdir(dir)).filter(file => file.endsWith('.md')); } catch { continue; }
    for (const file of files) {
      try {
        const text = await readFile(join(dir, file), 'utf8');
        const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
        names.add(frontmatterName(front) ?? file.slice(0, -3));
      } catch { /* An unreadable agent file is skipped, never fatal. */ }
    }
  }
  return names;
}

const rootFor = async (options, deps) => {
  try { return await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd); } catch { return options.cwd ?? process.cwd(); }
};

/** kairo team check-agent --agent NAME [--cwd PATH] [--json]: always exits 0; the caller denies on allowed=false. */
export async function runTeamCheckAgentCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  const root = await rootFor(options, deps);
  const catalog = loadProjectRoleCatalog({ projectRoot: root });
  const userAgents = await readUserAgentNames([join(deps.userHome ?? homedir(), '.claude', 'agents'), join(root, '.claude', 'agents')]);
  const verdict = evaluateAgentLaunch(options.agent, catalog, userAgents);
  log(options.json ? JSON.stringify(verdict) : verdict.allowed ? 'allowed' : verdict.reason);
  return verdict;
}

/** kairo team dispatch [--cwd PATH] [--json]: the approved plan arrives on stdin and is saved per project. */
export async function runTeamDispatchCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  const home = deps.homeDir ?? resolveHomeDir();
  const root = await rootFor(options, deps);
  const catalog = loadProjectRoleCatalog({ projectRoot: root });
  const plan = await (deps.readStdin ?? readStdin)().catch(() => '');
  let planPath = null, saved = false;
  if (plan.trim()) {
    try {
      planPath = lastPlanPath(home, root);
      await mkdir(dirname(planPath), { recursive: true });
      await writeFile(planPath, plan);
      saved = true;
    } catch { planPath = null; }
  }
  let pacing = null;
  try {
    const { runTeamPacingCli } = await import('./pacing-cli.js');
    pacing = await runTeamPacingCli({ cwd: options.cwd, json: true }, { ...deps, log: () => {} });
  } catch { /* Dispatch text never depends on quota data. */ }
  const result = { context: buildDispatchContext({ catalog, pacing, planPath, saved }), planPath, saved };
  log(options.json ? JSON.stringify(result) : result.context);
  return result;
}

const IGNORED_SEGMENTS = new Set(['third_party', 'vendor', 'node_modules', 'dist', 'build', 'coverage', 'graphify-out', '.git']);
const SYMBOL_LINE = /^- `([^`]+)` \(([^()]+?)(?::\d+)?\)(.*)$/;

/**
 * Keep the short, current part of CodeGraph's prompt context: symbols whose file
 * still exists outside vendored or generated directories. Source, relationship
 * lists and anything over the cap are dropped; the agent fetches more on demand.
 */
export function filterCodegraphContext(raw, { projectRoot, maxChars = 1500, maxItems = 5 } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex(line => /^\*\*Blast radius/.test(line));
  if (start < 0) return '';
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\*\*/.test(line)) break;
    const match = SYMBOL_LINE.exec(line);
    if (!match) continue;
    const path = match[2];
    if (path.split('/').some(segment => IGNORED_SEGMENTS.has(segment))) continue;
    if (projectRoot && !existsSync(join(projectRoot, path))) continue;
    items.push(line.length > 220 ? `${line.slice(0, 217)}...` : line);
    if (items.length === maxItems) break;
  }
  if (!items.length) return '';
  const title = (lines.find(line => /^\*\*Exploration:/.test(line)) ?? '').replace(/^\*\*Exploration:\s*/, '').replace(/\*\*$/, '').trim();
  const head = `CodeGraph${title ? `: ${title}` : ''}`;
  const tail = 'Use codegraph_explore for source and call flow.';
  while (items.length) {
    const text = [head, ...items, tail].join('\n');
    if (text.length <= maxChars) return text;
    items.pop();
  }
  return '';
}

/** kairo team prompt-context [--cwd PATH]: {prompt,cwd} JSON on stdin, filtered CodeGraph context on stdout; silent on any failure. */
export async function runTeamPromptContextCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  try {
    const input = await (deps.readStdin ?? readStdin)();
    let cwd = options.cwd;
    try { cwd = cwd ?? JSON.parse(input)?.cwd; } catch { /* Raw stdin is passed through unchanged. */ }
    const root = await rootFor({ cwd }, deps);
    const ran = (deps.spawn ?? spawnSync)('codegraph', ['prompt-hook'], { input, encoding: 'utf8', timeout: 1500, cwd: root });
    if (ran.error || ran.status !== 0) return '';
    const text = filterCodegraphContext(ran.stdout, { projectRoot: root });
    if (text) log(text);
    return text;
  } catch { return ''; }
}
