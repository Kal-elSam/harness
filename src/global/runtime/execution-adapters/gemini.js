import { createExecutionAdapter, parseNdjsonLine } from './create-execution-adapter.js';

// Team-exec only: adding a wrapper does not opt Gemini into automatic routing.
export default createExecutionAdapter({
  id: 'gemini', label: 'Gemini', executable: 'gemini',
  capabilities: { structuredEvents: true },
  buildLaunch: ({ task, cwd, model, env = process.env }) => ({
    command: 'gemini', args: ['--model', model, '--output-format', 'stream-json', '--prompt', task], cwd, env,
  }),
  parseEventLine: parseNdjsonLine,
});
