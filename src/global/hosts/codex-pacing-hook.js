// Native Codex UserPromptSubmit transport. All quota policy stays in the shared CLI.
import { pathToFileURL } from 'node:url';
import { readPacingContext } from './pacing-context.js';

export async function runCodexPacingHook(input, { run } = {}) {
  if (input?.hook_event_name !== 'UserPromptSubmit' || typeof input.cwd !== 'string' || !input.cwd.trim()) return {};
  const additionalContext = await readPacingContext({ cwd: input.cwd, host: 'codex', run });
  return additionalContext ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } } : {};
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
