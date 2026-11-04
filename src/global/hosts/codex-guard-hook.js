import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROLE_REGISTRY } from '../intelligence/role-registry.js';
import { GENTLE_WORKFLOW_ROLES, WORK_ROLE_ALIASES, kairoAgentName } from '../intelligence/role-catalog.js';
import { planCodexPacing } from './codex-pacing-config.js';

const marker = 'Kairo team write guard (managed)';
const quote = value => process.platform === 'win32' ? `"${value.replaceAll('"', '\\"')}"` : `'${value.replaceAll("'", "'\\''")}'`;
const owned = group => group?.hooks?.length === 1 && group.hooks[0].statusMessage === marker
  && /[/\\]codex-guard-hook\.js['"]?$/.test(group.hooks[0].command ?? '');

// Merge with pacing before applying: both registrations share one hooks.json snapshot.
export function planCodexGuard(context, remove = false) {
  const plan = planCodexPacing(context, remove);
  const document = JSON.parse(plan.next || '{}');
  const groups = document.hooks?.PreToolUse ?? [];
  if (!Array.isArray(groups)) throw new Error('Codex hooks.json PreToolUse must be an array.');
  const others = groups.filter(group => !owned(group));
  const packageRoot = context.packageRoot ?? fileURLToPath(new URL('../../../', import.meta.url));
  const handler = { type: 'command', command: `${quote(process.execPath)} ${quote(join(packageRoot, 'src/global/hosts/codex-guard-hook.js'))}`, timeout: 10, statusMessage: marker };
  const nextGroups = remove ? others : [...others, { hooks: [handler] }];
  if (JSON.stringify(groups) === JSON.stringify(nextGroups)) return plan;
  document.hooks ??= {};
  if (!nextGroups.length) delete document.hooks.PreToolUse;
  else document.hooks.PreToolUse = nextGroups;
  const next = `${JSON.stringify(document, null, 2)}\n`;
  return { ...plan, next, changed: next !== plan.current };
}

// Resolve host-owned agent names, never role claims supplied inside tool arguments.
export function guardRole(agent) {
  if (!agent || ['default', 'orchestrator', 'Master Orchestrator'].includes(agent)) return undefined;
  return Object.keys(ROLE_REGISTRY).find(role => role === agent || kairoAgentName(role) === agent || kairoAgentName(role) === `kairo-${agent}`)
    ?? WORK_ROLE_ALIASES[agent] ?? GENTLE_WORKFLOW_ROLES[agent]?.sourceRole ?? agent;
}

// Transport only. All permission decisions belong to the policy-free core CLI.
export function guardToolCall({ host, role, tool, input }, { nodePath = process.execPath, run = spawnSync, cwd } = {}) {
  const args = input && typeof input === 'object' ? input : {};
  const normalizedTool = typeof tool === 'string' ? tool.replace(/^(?:functions\.|tools\.)/, '') : tool;
  const isPatch = /^apply_patch$/i.test(normalizedTool ?? '');
  // Codex 0.166 exposes freeform patches as command; OpenCode uses patchText.
  const patch = typeof input === 'string' ? input : isPatch
    ? args.command ?? args.patch ?? args.input ?? (host === 'opencode' ? args.patchText : undefined)
    : args.patch ?? args.input;
  if (isPatch && (typeof patch !== 'string' || !patch.trim())) return { allow: false, reason: 'Patch text is required' };
  const paths = [args.file_path, args.filePath, args.path, args.notebook_path,
    ...(Array.isArray(args.paths) ? args.paths : []),
    ...(typeof patch === 'string' ? [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(match => match[1]) : [])].filter(value => value !== undefined);
  const payload = { host, role, tool: normalizedTool, command: args.command ?? args.cmd, paths, stdin: args.chars };
  try {
    const result = run(nodePath, [fileURLToPath(new URL('../../../bin/kairo.js', import.meta.url)), 'team', 'guard', '--json'], {
      input: JSON.stringify(payload), encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, ...(cwd ? { cwd } : {}),
    });
    const decision = JSON.parse(result.stdout);
    if (!result.error && typeof decision.allow === 'boolean' && typeof decision.reason === 'string' && decision.reason.trim()
        && result.status === (decision.allow ? 0 : 1)) return decision;
  } catch { /* A missing or malformed guard response must not authorize a tool. */ }
  return { allow: false, reason: 'Kairo team guard unavailable or invalid response' };
}

export function runCodexGuardHook(input) {
  const decision = input?.hook_event_name === 'PreToolUse'
    ? guardToolCall({ host: 'codex', role: guardRole(input.agent_type), tool: input.tool_name, input: input.tool_input })
    : { allow: false, reason: 'Invalid Codex PreToolUse input' };
  // Codex 0.166.0 embedded pre-tool-use.command.output schema: do not approve
  // allowed calls, since that would bypass the host's ordinary permission checks.
  return decision.allow ? {} : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input;
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* Invalid input denies below. */ }
  console.log(JSON.stringify(runCodexGuardHook(input)));
}
