// Shared advisory pacing text for host transports (Codex hook, OpenCode plugin). Quota policy stays in the CLI.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const kairoBin = fileURLToPath(new URL('../../../bin/kairo.js', import.meta.url));
// Providers name their own windows (Claude: "Current session", "Current week (all models)"); accept any short printable label.
const validWindowName = name => typeof name === 'string' && /^[\x20-\x7E]{1,40}$/.test(name) && name.trim() === name;

export function buildPacingContext(snapshot) {
  try {
    if (snapshot?.ok !== true || !snapshot.providers || Array.isArray(snapshot.providers)) return null;
    const lines = [];
    for (const name of ['claude', 'codex', 'opencode-go']) {
      const provider = snapshot.providers[name];
      if (!provider) continue;
      if (!Array.isArray(provider.windows) || ![null, 'HEALTHY', 'WATCH', 'CONSERVE', 'CRITICAL'].includes(provider.tier)) return null;
      const windows = provider.windows.map(window => {
        if (!validWindowName(window.name)
          || !Number.isFinite(window.remainingPercent) || window.remainingPercent < 0 || window.remainingPercent > 100
          || (window.resetsAt !== null && !Number.isFinite(Date.parse(window.resetsAt)))) throw new Error('Invalid quota window');
        return `${window.name} ${window.remainingPercent}% (resets ${window.resetsAt ?? 'unknown'})`;
      });
      const idle = provider.expectedDeadTimeMs;
      if (idle !== null && (!Number.isFinite(idle) || idle < 0)) return null;
      lines.push(`${name}: ${windows.length ? `${windows.join(', ')}; ${provider.tier}; expected idle ${Math.ceil((idle ?? 0) / 60000)}m` : 'unavailable'}`);
    }
    if (!lines.length) return null;
    if (['team-builder', 'team-builder-codex'].includes(snapshot.nextWriter)) lines.push(`Suggested next writer: ${snapshot.nextWriter}`);
    return `Pacing (advisory; never overrides explicit model choices)${snapshot.stale ? ' [stale cached quota; refresh pending]' : ''}:\n${lines.join('\n')}`;
  } catch { return null; }
}

// Bounded no-wait CLI call. Returns the advisory text, or null on any failure.
// Hosts that embed their own runtime (OpenCode) pass the Node path captured at install as execPath.
export async function readPacingContext({ cwd, host, execPath = process.execPath, run = promisify(execFile) } = {}) {
  if (typeof cwd !== 'string' || !cwd.trim()) return null;
  try {
    const { stdout } = await run(execPath, [kairoBin, 'team', 'pacing', '--json', '--no-wait', '--cwd', cwd],
      { timeout: 1800, maxBuffer: 65536, encoding: 'utf8', env: { ...process.env, KAIRO_HOST: host } });
    return buildPacingContext(JSON.parse(stdout));
  } catch { return null; }
}
