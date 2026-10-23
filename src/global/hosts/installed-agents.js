import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { listHosts } from './registry.js';

// Agent metadata is a flat YAML frontmatter or TOML table. Unsupported values
// remain unknown rather than being inferred from the host that stores the file.
function scalar(value) {
  const text = value.trim();
  if (text.startsWith('"')) {
    try { return JSON.parse(text.replace(/\s+#.*$/, '')); } catch { return null; }
  }
  if (text.startsWith("'")) return /^'([^']*)'\s*(?:#.*)?$/.exec(text)?.[1] ?? null;
  if (/^[>|[{]/.test(text)) return null;
  return text.replace(/\s+#.*$/, '').trim();
}
function parseAgent(text, path) {
  const toml = extname(path) === '.toml';
  const front = toml ? text : /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? '';
  const fields = {};
  for (const line of front.split(/\r?\n/)) {
    if (toml && /^\s*\[/.test(line)) break;
    const match = (toml ? /^(name|description|model)\s*=\s*(.*)$/ : /^(name|description|model):\s*(.*)$/).exec(line);
    if (match) fields[match[1]] = scalar(match[2]);
  }
  return { name: fields.name || basename(path, extname(path)), description: fields.description ?? '', model: fields.model ?? null,
    body: toml ? text : text.slice(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0].length ?? 0) };
}
function inferProvider({ model, body }) {
  const wrappers = [
    ['codex', /\bcodex\s+exec\b/], ['opencode', /\bopencode\s+run\b/],
    ['cursor', /\bcursor-agent\b/], ['gemini', /\bgemini(?:\s+[-\w]|\s*$)/m]
  ].filter(([, pattern]) => pattern.test(body));
  if (wrappers.length > 1) return { reason: 'Ambiguous wrapper providers' };
  if (wrappers.length === 1) return { adapterId: wrappers[0][0] };
  if (typeof model === 'string') {
    const slash = /^([\w.-]+)\/.+/.exec(model);
    if (slash) return { adapterId: slash[1] };
    if (/^(?:sonnet|opus|haiku)(?:[\w.-]*)$|^claude(?:[\w.-]*)$/i.test(model)) return { adapterId: 'claude' };
    if (/^(?:gpt|openai)(?:[\w.-]*)$/i.test(model)) return { adapterId: 'codex' };
    if (/^gemini(?:[\w.-]*)$/i.test(model)) return { adapterId: 'gemini' };
  }
  return { reason: `Unknown provider for model ${JSON.stringify(model)}` };
}

/** Read installed agents through host role directories, never executable probes. */
export async function discoverInstalledAgents({ projectRoot, homeDir, env = process.env }) {
  const agents = [];
  const warnings = [];
  for (const host of listHosts()) {
    if (!['claude-code', 'codex', 'opencode', 'cursor', 'gemini'].includes(host.id)) continue;
    const dir = host.capabilities().roleDir;
    const dirs = [join(projectRoot, dir), join(homeDir, dir)];
    if (host.id === 'opencode') dirs.push(join(env.XDG_CONFIG_HOME || join(homeDir, '.config'), 'opencode', 'agents'));
    for (const root of new Set(dirs)) {
      let entries;
      try { entries = await readdir(root, { withFileTypes: true }); }
      catch (error) { if (error.code !== 'ENOENT') warnings.push(`${root}: ${error.message}`); continue; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() || extname(entry.name) !== (host.id === 'codex' ? '.toml' : '.md')) continue;
        const path = join(root, entry.name);
        try {
          const text = await readFile(path, 'utf8');
          if (/kairo-(?:role|bridge)\b/.test(text)) continue;
          const parsed = parseAgent(text, path);
          agents.push({ host: host.id, path, ...parsed, ...inferProvider(parsed) });
        } catch (error) { warnings.push(`${path}: ${error.message}`); }
      }
    }
  }
  return { agents, warnings };
}
