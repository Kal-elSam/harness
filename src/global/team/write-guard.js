import fs from 'node:fs';
import os from 'node:os';
import { posix } from 'node:path';
import { ROLE_REGISTRY } from '../intelligence/role-registry.js';

const osTempDirectories = [os.tmpdir()];
try {
  osTempDirectories.push(fs.realpathSync(os.tmpdir()));
} catch {}
const osTempPrefixes = [...new Set(osTempDirectories)].map(directory => `${posix.normalize(directory).replace(/\/+$/, '')}/`);
const isScratchPath = path => path === '/dev/null' || path.startsWith('/tmp/') || path.startsWith('/private/tmp/') ||
  osTempPrefixes.some(prefix => path.startsWith(prefix));

// A conservative command recognizer, not a sandbox for arbitrary program effects.
function shellTokens(command) {
  const lines = command.replace(/\\\r?\n/g, '').split('\n')
  const kept = []
  for (let n = 0; n < lines.length; n++) {
    kept.push(lines[n])
    const open = [...lines[n].matchAll(/<<(-?)\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][A-Za-z0-9_]*))/g)]
    for (const match of open) {
      const delimiter = match[2] ?? match[3] ?? match[4]
      let end = n + 1
      while (end < lines.length && (match[1] ? lines[end].trim() : lines[end]) !== delimiter) end++
      if (end < lines.length) {
        // Anything after the terminator line (for example `)"`) stays shell text.
        n = end
      } else n = lines.length
    }
  }
  return kept.join('\n').match(/(?:[^\s"'<>|;&()]+|'[^']*'|"(?:\\.|[^"\\])*"|\\.)+|[<>]&(?:\d+|-)|&?>>?|<>|<<-?|[|;&()\n]/g) ?? []

}

export function bashWritesFiles(command) {
  return tokensWriteFiles(shellTokens(command));
}

// Keep quoted operators inside words; only unquoted operators are shell syntax.
// Heredoc bodies are data: shellTokens drops them (and their terminator) so their text is never scanned as shell syntax.
function tokensWriteFiles(tokens) {
  const word = (token) => token.replace(/'([^']*)'|"((?:\\.|[^"\\])*)"/g, (_, single, double) => single ?? double)
  const scratch = (path) => {
    if (!path.startsWith('/') || /[$`\\]/.test(path)) return false
    const parts = []
    for (const part of path.split('/')) {
      if (part === '..') parts.pop()
      else if (part && part !== '.') parts.push(part)
    }
    const normalized = '/' + parts.join('/')
    return isScratchPath(normalized)
  }
  for (let i = 0; i < tokens.length; i++) {
    if (/^(?:&?>>?|<>)$/.test(tokens[i])) {
      // File descriptor duplication (2>&1) is not a path write.
      if (tokens[i + 1] === '&' && /^(?:\d+|-)$/.test(tokens[i + 2] ?? '')) continue
      if (!scratch(word(tokens[i + 1] ?? ''))) return true
    }
  }
  const segments = [[]]
  for (const token of tokens) {
    if (/^[|;&()\n]$/.test(token)) segments.push([])
    else segments[segments.length - 1].push(token)
  }
  for (const segment of segments) {
    const words = segment.map(word)
    // Also recognizes executable paths and common wrappers such as env or sudo.
    for (let i = 0; i < words.length; i++) {
      const executable = words[i].split('/').pop()
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || ['env', 'sudo', 'command', 'rtk', 'proxy'].includes(executable ?? '')) continue
      const args = words.slice(i + 1)
      if (executable === 'sed' && args.some(arg => /^-(?:[^-]*i|-[Ii]n-place)/.test(arg))) return true
      if (executable === 'perl' && args.some(arg => /^-[^-]*i/.test(arg))) return true
      if (/^(?:python3?|node)$/.test(executable ?? '') && segment.slice(i + 1).some(arg => /^<<-?$/.test(arg))) return true
      const flagC = args.findIndex(arg => /^-[A-Za-z]*c$/.test(arg))
      if (/^(?:sh|bash|zsh)$/.test(executable ?? '') && flagC >= 0 && args[flagC + 1] !== undefined && bashWritesFiles(args[flagC + 1])) return true
      if (/^(?:cp|mv|touch|rm|rmdir|mkdir|install|ln|truncate)$/.test(executable ?? '') && args.some(arg => !arg.startsWith('-') && !/^[<>]/.test(arg) && !scratch(arg))) return true
      if (executable === 'tee' && args.some(arg => !arg.startsWith('-') && !/^[<>]/.test(arg) && !scratch(arg))) return true
      break
    }
  }
  return false
}

const word = token => token.replace(/'([^']*)'|"((?:\\.|[^"\\])*)"/g, (_, single, double) => single ?? double);
const base = token => token.split('/').pop();
const scratch = path => typeof path === 'string' && path.startsWith('/') && !/[$`\\]/.test(path) &&
  isScratchPath(posix.normalize(path));
const documentation = path => typeof path === 'string' && !posix.isAbsolute(path) &&
  !path.split('/').includes('..') && !/[$`\\]/.test(path) &&
  (/^docs\/.+/.test(path) || /^(?:README|CHANGELOG|CONTRIBUTING|LICENSE)(?:\.[a-z]+)?$/i.test(path));
const safeEnvNames = new Set(['CI', 'NODE_ENV', 'FORCE_COLOR', 'NO_COLOR', 'TZ', 'LANG', 'LC_ALL', 'TERM']);
const decision = (allow, reason) => ({ allow, reason });

// Exact server/tool pairs verified from exposed MCP schemas and Graphify's installed
// serve.py. Engram mutations affect memory, not repository files. Never trust an
// entire server namespace; unconfirmed tools (including Obsidian) need escalation.
const READ_ONLY_MCP_TOOLS = {
  codegraph: new Set(['codegraph_explore']),
  context7: new Set(['resolve_library_id', 'query_docs']),
  graphify: new Set(['query_graph', 'get_node', 'get_neighbors', 'get_community', 'god_nodes', 'graph_stats', 'shortest_path']),
  engram: new Set([
    'mem_capture_passive', 'mem_compare', 'mem_consolidate', 'mem_context',
    'mem_current_project', 'mem_doctor', 'mem_get_observation', 'mem_judge',
    'mem_judge_many', 'mem_list_projects', 'mem_pin', 'mem_review',
    'mem_save', 'mem_save_prompt', 'mem_search', 'mem_search_prompts',
    'mem_session_end', 'mem_session_finalize', 'mem_session_start', 'mem_session_summary',
    'mem_suggest_topic_key', 'mem_unpin', 'mem_update',
  ]),
};

function commandParts(command) {
  const parts = [[]];
  for (const token of shellTokens(command)) {
    if (/^[|;&()\n]$/.test(token)) parts.push([]);
    else parts.at(-1).push(token);
  }
  return parts.filter(part => part.length).map(tokens => {
    const words = tokens.map(word);
    const envNames = [];
    while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || ['env', 'sudo', 'command', 'rtk', 'proxy'].includes(base(words[0])))) {
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(words.shift());
      if (assignment) envNames.push(assignment[1]);
    }
    return { words, tokens, envNames };
  });
}

function inspectCommand(command, permission, depth = 0) {
  if (depth > 8) return decision(false, 'Shell nesting exceeds guard limit');
  // Dynamic execution cannot be proven safe by this lexical guard.
  if (shellTokens(command).some(token => /[$`]/.test(token))) return decision(false, 'Dynamic shell execution requires escalation');
  for (const { words, tokens, envNames } of commandParts(command)) {
    // Environment can configure git, pagers, loaders and PATH; only scoped writers may set it.
    if (permission !== 'scoped-write' && envNames.some(name => !safeEnvNames.has(name))) return decision(false, 'Environment assignments require escalation');
    if (!words.length) continue;
    const executable = base(words[0]);
    const args = words.slice(1);
    if (['sh', 'bash', 'zsh'].includes(executable)) {
      const index = args.findIndex(arg => /^-[A-Za-z]*c$/.test(arg));
      if (index < 0 || !args[index + 1]) return decision(false, 'Shell script requires escalation');
      const nested = inspectCommand(args[index + 1], permission, depth + 1);
      if (!nested.allow) return nested;
      continue;
    }
    if (executable === 'node' && args[0] === '--test') {
      if (args.some(arg => /^(?:--(?:import|require|loader|experimental-loader|eval|print|input-type)|-[rep])(?:=|$)/.test(arg))) return decision(false, 'node code-loading options require escalation');
      continue;
    }
    if (executable === 'git' && args.some(arg => arg === '-c' || arg.startsWith('--config-env') || arg === '--git-dir' || arg.startsWith('--git-dir='))) return decision(false, 'Git configuration overrides require escalation');
    // Global flags may precede git/gh subcommands; never treat flag values as verbs.
    let rest = [...args];
    while ((executable === 'git' || executable === 'gh') && rest[0]?.startsWith('-')) {
      const flag = rest.shift();
      if (['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--repo', '-R', '--hostname'].includes(flag)) rest.shift();
      else if (!['--no-pager', '--no-optional-locks', '--paginate'].includes(flag) && !/^--(?:git-dir|work-tree|repo|hostname)=/.test(flag)) return decision(false, 'Unsupported command option');
    }
    const [verb, action] = rest;
    const delivery = executable === 'git' && verb === 'push' || executable === 'gh' &&
      (verb === 'pr' && ['create', 'edit', 'merge', 'ready', 'comment'].includes(action) || verb === 'release' && action === 'create');
    if (delivery) {
      if (permission !== 'authorized-delivery') return decision(false, 'Delivery requires authorized-delivery permission');
      continue;
    }
    if (executable === 'git') {
      if (!['status', 'diff', 'log', 'show', 'blame', 'ls-files', 'ls-tree', 'rev-parse', 'rev-list', 'describe', 'grep', 'commit'].includes(verb)) return decision(false, 'Git mutation is not an allowed coordination command');
      // Commit is explicitly allowed, but not aliases, external diffs or output writes.
      if (args.some(arg => /^(?:--output|--ext-diff|--no-index)(?:=|$)/.test(arg))) return decision(false, 'Git write/external option is not allowed');
      if (verb === 'grep' && args.some(arg => /^-[^-]*O|^--open-files-in-pager(?:=|$)/.test(arg))) return decision(false, 'git grep pager execution is not allowed');
      continue;
    }
    if (executable === 'gh') {
      if (!['pr', 'issue', 'release', 'repo', 'run', 'workflow'].includes(verb) || !['view', 'list', 'status', 'diff', 'checks'].includes(action)) return decision(false, 'Only read-only gh commands are allowed');
      continue;
    }
    if (executable === 'kairo' || executable === 'npm' && ['test', 'run'].includes(verb) && (verb === 'test' || /^(?:test|lint|typecheck|check)(?::|$)/.test(action ?? '')) || executable === 'claude' && verb === 'plugin' && action === 'test') continue;
    const writes = tokensWriteFiles(tokens);
    if (writes) {
      if (permission === 'scoped-write') continue;
      // Only simple redirections have statically unambiguous output paths.
      const targets = [];
      const tokens = shellTokens(command);
      for (let i = 0; i < tokens.length; i++) if (/^(?:&?>>?|<>)$/.test(tokens[i]) && tokens[i + 1] !== '&') targets.push(word(tokens[i + 1] ?? ''));
      const pathRule = permission === 'docs-only' ? documentation : scratch;
      if (targets.length && ['echo', 'printf', 'cat'].includes(executable) && targets.every(pathRule)) continue;
      return decision(false, `Command writes outside ${permission} permission`);
    }
    if (['cat', 'ls', 'pwd', 'echo', 'printf', 'grep', 'rg', 'head', 'tail', 'wc', 'find', 'stat', 'file', 'which', 'true', 'false', 'test', 'sort', 'uniq', 'cut', 'diff', 'sed', 'tee', 'cp', 'mv', 'touch', 'rm', 'rmdir', 'mkdir', 'install', 'ln', 'truncate'].includes(executable)) {
      if (executable === 'find' && args.some(arg => /^-(?:exec|execdir|ok|okdir|delete|fprint|fls)/.test(arg))) return decision(false, 'find side effects are not read-only');
      if (executable === 'sort' && args.some(arg => /^-(?!-)[A-Za-z]*o|^--(?:output|compress-program)/.test(arg))) return decision(false, 'sort output writes require escalation');
      if (executable === 'rg' && args.some(arg => /^--(?:pre|pre-glob|hostname-bin)(?:=|$)/.test(arg))) return decision(false, 'rg preprocessor execution is not allowed');
      if (executable === 'uniq') {
        // The second positional of uniq is an output file; -f/-s/-w take a separate value.
        const positionals = args.filter((arg, index) => !arg.startsWith('-') && !/^-[fsw]$/.test(args[index - 1] ?? ''));
        if (positionals.length > 1) return decision(false, 'uniq output file requires escalation');
      }
      if (executable === 'sed') {
        // Only the script can run side effects (w, e); file operands are data.
        const script = args.find(arg => !arg.startsWith('-'));
        if (args.some(arg => /^-[^-]*[ef]|^--(?:expression|file)/.test(arg)) || /[we]/.test(script ?? '')) return decision(false, 'sed program side effects require escalation');
      }
      continue;
    }
    if (permission === 'scoped-write') continue;
    return decision(false, 'Command effects are unknown; escalate to the authorized worker');
  }
  return decision(true, 'Command permitted by role permission');
}

/** Pure host-independent preflight. Paths are actual tool targets, not authority claims. */
export function checkToolCall(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return decision(false, 'Tool call must be an object');
  const { host, role, tool, command, paths = [] } = input;
  if (typeof host !== 'string' || !host.trim() || typeof tool !== 'string' || !tool.trim() || !Array.isArray(paths) || paths.some(path => typeof path !== 'string' || !path.trim())) return decision(false, 'Invalid host, tool or paths');
  const permission = role === undefined || ['Master Orchestrator', 'orchestrator'].includes(role) ? 'read-only' : ROLE_REGISTRY[role]?.permission;
  if (!permission) return decision(false, 'Unknown role permission');
  if (tool === 'write_stdin') {
    if (permission === 'scoped-write') return decision(true, 'Interactive stdin permitted by scoped-write permission');
    const poll = input.stdin === undefined || input.stdin === '';
    return decision(poll, poll ? 'Empty stdin poll' : 'Interactive stdin requires scoped-write permission');
  }
  // Delegation/session bookkeeping is not a repository write.
  if (['spawn_agent', 'wait_agent', 'close_agent', 'update_plan',
    'send_message', 'followup_task', 'interrupt_agent', 'list_agents',
    'task', 'todowrite', 'todoread'].includes(tool)) return decision(true, 'Host coordination tool');
  if (['web_search', 'webfetch', 'WebFetch', 'WebSearch'].includes(tool)) return decision(true, 'Read-only web tool');
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) {
    if (Object.hasOwn(READ_ONLY_MCP_TOOLS, mcp[1]) && READ_ONLY_MCP_TOOLS[mcp[1]].has(mcp[2])) return decision(true, 'Allowlisted knowledge tool');
    if (permission === 'scoped-write') return decision(true, 'MCP tool permitted by scoped-write permission');
    return decision(false, 'Unknown tool effects; escalate');
  }
  if (/^(?:bash|shell|exec_command|execute|terminal)$/i.test(tool)) {
    if (typeof command !== 'string' || !command.trim()) return decision(false, 'Shell command is required');
    // Check redirections before command allowlists (including git and tests).
    if (bashWritesFiles(command) && !['scoped-write', 'docs-only'].includes(permission)) return decision(false, 'Command writes outside role permission');
    return inspectCommand(command, permission);
  }
  if (/^(?:read|read_file|view_image|glob|grep|search|list|list_directory)$/i.test(tool)) return decision(true, 'Read-only tool');
  if (/^(?:write|edit|multiedit|write_file|edit_file|apply_patch|notebookedit)$/i.test(tool)) {
    if (!paths.length) return decision(false, 'Write targets are required');
    const allow = permission === 'scoped-write' || permission === 'docs-only' && paths.every(documentation) || permission === 'scratch-only' && paths.every(scratch);
    return decision(allow, allow ? 'Write targets permitted by role permission' : `Write denied for ${permission} role`);
  }
  return decision(false, 'Unknown tool effects; escalate');
}
