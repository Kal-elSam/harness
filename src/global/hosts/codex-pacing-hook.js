// Native Codex UserPromptSubmit transport. All quota policy stays in the shared CLI.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function runCodexPacingHook(input, { run = promisify(execFile) } = {}) {
  if (input?.hook_event_name !== 'UserPromptSubmit' || typeof input.cwd !== 'string' || !input.cwd.trim()) return {};
  try {
    const { stdout } = await run(process.execPath, [fileURLToPath(new URL('../../../bin/kairo.js', import.meta.url)),
      'team', 'pacing', '--json', '--no-wait', '--cwd', input.cwd],
    { timeout: 1800, maxBuffer: 65536, encoding: 'utf8', env: { ...process.env, KAIRO_HOST: 'codex' } });
    const snapshot = JSON.parse(stdout);
    if (snapshot?.ok !== true || !snapshot.providers || Array.isArray(snapshot.providers)) return {};
    const lines = [];
    for (const name of ['claude', 'codex', 'opencode-go']) {
      const provider = snapshot.providers[name];
      if (!provider) continue;
      if (!Array.isArray(provider.windows) || ![null, 'HEALTHY', 'WATCH', 'CONSERVE', 'CRITICAL'].includes(provider.tier)) return {};
      const windows = provider.windows.map(window => {
        if (!['5h', 'week', 'session', 'weekly', 'seven_day', 'five_hour'].includes(window.name)
          || !Number.isFinite(window.remainingPercent) || window.remainingPercent < 0 || window.remainingPercent > 100
          || (window.resetsAt !== null && !Number.isFinite(Date.parse(window.resetsAt)))) throw new Error('Invalid quota window');
        return `${window.name} ${window.remainingPercent}% (resets ${window.resetsAt ?? 'unknown'})`;
      });
      const idle = provider.expectedDeadTimeMs;
      if (idle !== null && (!Number.isFinite(idle) || idle < 0)) return {};
      lines.push(`${name}: ${windows.length ? `${windows.join(', ')}; ${provider.tier}; expected idle ${Math.ceil((idle ?? 0) / 60000)}m` : 'unavailable'}`);
    }
    if (!lines.length) return {};
    if (['team-builder', 'team-builder-codex'].includes(snapshot.nextWriter)) lines.push(`Suggested next writer: ${snapshot.nextWriter}`);
    const additionalContext = `Pacing (advisory; never overrides explicit model choices)${snapshot.stale ? ' [stale cached quota; refresh pending]' : ''}:\n${lines.join('\n')}`;
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } };
  } catch { return {}; } // Missing CLI, quota, malformed output or timeout must never block a prompt.
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let output = {};
  const timer = setTimeout(() => process.stdin.destroy(), 300);
  try {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (raw.length > 262144) throw new Error('Hook input too large');
    }
    clearTimeout(timer);
    output = await runCodexPacingHook(JSON.parse(raw));
  } catch { /* Invalid or unavailable stdin is also fail-open. */ }
  finally { clearTimeout(timer); }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
