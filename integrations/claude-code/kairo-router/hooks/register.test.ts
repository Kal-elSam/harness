import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { pacingContext, pacingBand } from './register'

function world(on: On, response: unknown = { decision: 'ROUTED', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-a' }, failure?: string, duringLaunch?: () => void | Promise<void>) {
  const calls: Array<Record<string, unknown>> = []
  const processes: Array<Record<string, unknown>> = []
  const toasts: string[] = []
  mock.clock(on, { now: 1_700_000_000_000 })
  on('process.run', (_, e) => {
    processes.push({ ...e })
    if ((e.argv as string[])[2] === 'detect-exhaustion') return { value: { exitCode: 0, stdout: 'null', stderr: '', timedOut: false } }
    if (['record-launch', 'record-outcome'].includes((e.argv as string[])[2])) {
      if (failure === 'record-throw') throw new Error('ledger unavailable')
      if (failure === 'record-pending') return new Promise(() => {})
      return { value: { exitCode: failure === 'record-exit' ? 1 : 0, stdout: '', stderr: '', timedOut: false } }
    }
    if (failure === 'throw') throw new Error('process unavailable')
    return { value: { exitCode: failure === 'exit' ? 1 : 0, stdout: JSON.stringify(response), stderr: '', timedOut: failure === 'timeout' } }
  })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', async (_, e) => { const { tool_use_id, ...input } = e; calls.push(input); await duringLaunch?.(); return { result: {} } })
  return { calls, processes, toasts }
}
const agent = (prompt = 'build it') => ({ tool: 'Agent', subagent_type: 'team-builder', description: 'build', prompt, model: 'opus' }) as const

test('routes to the Codex agent without setting a non-Claude model', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(w.calls).toEqual([{ ...agent(), subagent_type: 'team-builder-codex' }])
  expect(w.processes).toHaveLength(4)
  expect(w.processes[0]).toMatchObject({ argv: ['kairo', 'team', 'route', '--agent', 'team-builder', '--cwd', '/tmp/project', '--json'], init: { timeoutMs: 2000 } })
})

test('sets routed Claude model even when the agent name stays the same', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'claude', targetAgent: 'team-builder', targetModel: 'sonnet' })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(w.calls).toEqual([{ ...agent(), model: 'sonnet' }])
})

for (const [reason, response, failure] of [
  ['stale', { decision: 'STALE', why: 'refresh required' }, undefined],
  ['unknown agent', { decision: 'ERROR', code: 'unknown_agent', message: 'Unknown agent' }, 'exit'],
  ['timeout', {}, 'timeout'],
  ['error', {}, 'throw'],
  ['nonzero', {}, 'exit'],
  ['malformed', null, undefined],
] as const) test(`fails open on ${reason} and warns once per session`, async ($, on) => {
  const w = world(on, response, failure)
  for (let i = 0; i < 2; i++) expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.calls).toEqual([agent(), agent()])
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('kairo-router:')
})

for (const prompt of ['retry [no-redirect]', 'retry [please no-redirect here]']) test(`bracket marker bypasses lookup: ${prompt}`, async ($, on) => {
  const w = world(on)
  expect((await $.tool.call(agent(prompt))).deny).toBeUndefined()
  expect(w.calls).toEqual([agent(prompt)])
  expect(w.processes).toHaveLength(0)
  expect(w.toasts).toHaveLength(0)
})

for (const provider of ['codex', 'opencode', 'opencode-go', 'gemini']) test(`routes unmapped ${provider} work through its Kairo wrapper with the concrete model`, async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider, targetAgent: null, targetModel: 'model-a' })
  expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.calls).toEqual([{ ...agent(), subagent_type: `kairo-${provider}`, prompt: 'kairo-model: model-a\nbuild it' }])
  expect(w.toasts).toHaveLength(0)
})


test('Claude route sets its model when no adapter agent is registered', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'claude', targetAgent: null, targetModel: 'sonnet' })
  expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.calls).toEqual([{ ...agent(), model: 'sonnet' }])
})

test('other tools bypass the router', async ($, on) => {
  const w = world(on)
  expect((await $.tool.call({ tool: 'Read', file_path: '/tmp/example' })).deny).toBeUndefined()
  expect(w.processes).toHaveLength(0)
})

for (const failure of [undefined, 'record-exit', 'record-throw', 'record-pending']) test(`records routed launch without waiting or denying on ${failure}`, async ($, on) => {
  const w = world(on, undefined, failure)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.calls).toEqual([{ ...agent(), subagent_type: 'team-builder-codex' }])
  expect(w.processes[1]).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'team-builder-codex', '--adapter', 'codex', '--model', 'gpt-a', '--cwd', '/tmp/project'] })
  expect(w.toasts).toHaveLength(0)
})

test('records confirmed original agent and final Claude model', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'claude', targetAgent: 'team-builder', targetModel: 'sonnet' })
  expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.processes[1]).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'team-builder', '--adapter', 'claude', '--model', 'sonnet'] })
})

test('records the original catalog agent for a built-in wrapper and routed provider model', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'codex', targetAgent: null, targetModel: 'gpt-a' })
  await $.tool.call(agent())
  expect(w.processes).toHaveLength(4)
  expect(w.processes[1]).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'team-builder', '--adapter', 'codex', '--model', 'gpt-a'] })
})

for (const route of [
  { provider: '', targetAgent: 'team-builder-codex', targetModel: 'gpt-a' },
  { provider: 'codex', targetAgent: 'team-builder-codex', targetModel: '' },
]) test(`fails open without modifying the input on invalid route ${JSON.stringify(route)}`, async ($, on) => {
  const w = world(on, { decision: 'ROUTED', ...route })
  expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.calls).toEqual([agent()])
  expect(w.processes).toHaveLength(1)
})

const codexRoute = { decision: 'ROUTED', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-a' }
const claudeRoute = { decision: 'ROUTED', provider: 'claude', targetAgent: 'team-builder', targetModel: 'sonnet' }
const exhaustedResult = { content: [{ type: 'text', text: 'You have hit your usage limit. Please try again later.' }], exitCode: 1 }

function handoverWorld(on: On, options: {
  initialRoute?: unknown,
  reroute?: unknown,
  first?: unknown,
  second?: unknown,
  recordFailure?: string,
  rerouteFailure?: string,
  detectionFailure?: string,
  pacing?: boolean,
} = {}) {
  const calls: Array<Record<string, unknown>> = []
  const processes: Array<Record<string, unknown>> = []
  const toasts: string[] = []
  if (options.pacing) {
    on('prompt.submit', (_, e) => ({ text: e.text }))
    on('ui.status', () => ({ value: undefined }))
  }
  let routes = 0
  let exhaustedRecorded = false
  on('process.run', async (_, e) => {
    processes.push({ ...e })
    const argv = e.argv as string[]
    if (options.pacing && ['pacing', 'verdict'].includes(argv[2])) return { value: { exitCode: 0, stdout: JSON.stringify(argv[2] === 'pacing' ? pacingResponse : []), stderr: '', timedOut: false } }
    if (argv[2] === 'detect-exhaustion') {
      if (options.detectionFailure === 'throw') throw new Error('detector failed')
      if (options.detectionFailure === 'malformed') return { value: { exitCode: 0, stdout: '{}', stderr: '', timedOut: false } }
      const isExhausted = calls.length === 1 ? options.first === undefined : options.second === exhaustedResult
      const provider = argv[argv.indexOf('--adapter') + 1]
      return { value: { exitCode: 0, stdout: JSON.stringify(isExhausted ? { provider, reason: 'usage limit exhausted' } : null), stderr: '', timedOut: false } }
    }
    if (argv[2] === 'record-outcome') {
      // Built-in transport names are not members of the project role catalog.
      if (argv[argv.indexOf('--agent') + 1].startsWith('kairo-')) return { value: { exitCode: 1, stdout: '', stderr: 'Unknown agent in project role catalog', timedOut: false } }
      if (options.recordFailure === 'throw') throw new Error('record failed')
      if (options.recordFailure === 'pending') return new Promise(() => {})
      if (options.recordFailure === 'exit') return { value: { exitCode: 1, stdout: '', stderr: 'record failed', timedOut: false } }
      // Rerouting must wait until the exhaustion marker is durably applied.
      await Promise.resolve()
      if (argv.includes('exhausted')) exhaustedRecorded = true
      return { value: { exitCode: 0, stdout: '{}', stderr: '', timedOut: false } }
    }
    if (argv[2] === 'record-launch') return { value: { exitCode: 0, stdout: '', stderr: '', timedOut: false } }
    routes++
    if (routes > 1) {
      expect(exhaustedRecorded).toBe(true)
      if (options.rerouteFailure === 'throw') throw new Error('reroute failed')
      if (options.rerouteFailure === 'timeout') return { value: { exitCode: null, stdout: '', stderr: '', timedOut: true } }
      if (options.rerouteFailure === 'malformed') return { value: { exitCode: 0, stdout: '{', stderr: '', timedOut: false } }
    }
    return { value: { exitCode: 0, stdout: JSON.stringify(routes === 1 ? options.initialRoute ?? codexRoute : options.reroute ?? claudeRoute), stderr: '', timedOut: false } }
  })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => {
    const { tool_use_id, ...input } = e
    calls.push(input)
    return { result: calls.length === 1 ? options.first ?? exhaustedResult : options.second ?? { content: [{ type: 'text', text: 'Finished remaining work.' }] } }
  })
  return { calls, processes, toasts }
}

test('records completed outcomes in the background without changing the tool result', async ($, on) => {
  const original = { content: [{ type: 'text', text: 'Build completed.' }] }
  const w = handoverWorld(on, { first: original, recordFailure: 'pending' })
  const result = await $.tool.call(agent())
  expect(result.result).toEqual(original)
  expect(w.calls).toHaveLength(1)
  expect(w.processes.find(p => (p.argv as string[])[2] === 'record-outcome')).toMatchObject({ argv: ['kairo', 'team', 'record-outcome', '--agent', 'team-builder-codex', '--adapter', 'codex', '--model', 'gpt-a', '--status', 'completed'] })
  expect(w.toasts).toHaveLength(0)
})

test('hands exhausted work to another provider once using the original role and working tree', async ($, on) => {
  const w = handoverWorld(on)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual({ content: [{ type: 'text', text: 'Finished remaining work.' }] })
  expect(w.calls).toHaveLength(2)
  expect(w.calls[1]).toMatchObject({ subagent_type: 'team-builder', model: 'sonnet', description: 'build' })
  expect(w.calls[1].prompt).toContain('codex')
  expect(w.calls[1].prompt).toContain('current working tree')
  expect(w.calls[1].prompt).toContain('do not redo finished work')
  expect(w.calls[1].prompt).toContain('build it')
  const routes = w.processes.filter(p => (p.argv as string[])[2] === 'route')
  expect(routes).toHaveLength(2)
  expect(routes[1]).toMatchObject({ argv: ['kairo', 'team', 'route', '--agent', 'team-builder', '--cwd', '/tmp/project', '--json'] })
  const outcomes = w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')
  expect(outcomes).toHaveLength(2)
  expect(outcomes[0].argv).toContain('exhausted')
  expect(outcomes[1].argv).toContain('completed')
  expect(outcomes[1].argv).toContain('claude')
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('codex')
  expect(w.toasts[0]).toContain('claude')
})

test('records second provider exhaustion without a third launch or another notification', async ($, on) => {
  const w = handoverWorld(on, { second: exhaustedResult })
  expect((await $.tool.call(agent())).result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(2)
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'route')).toHaveLength(2)
  const outcomes = w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')
  expect(outcomes).toHaveLength(2)
  expect(outcomes[1].argv).toContain('exhausted')
  expect(outcomes[1].argv).toContain('claude')
  expect(w.toasts).toHaveLength(1)
})

test('hands built-in wrapper exhaustion back to Claude using the original role', async ($, on) => {
  const w = handoverWorld(on, { initialRoute: { decision: 'ROUTED', provider: 'codex', targetModel: 'gpt-a' } })
  await $.tool.call(agent())
  expect(w.calls).toHaveLength(2)
  expect(w.calls[0]).toEqual({ ...agent(), subagent_type: 'kairo-codex', prompt: 'kairo-model: gpt-a\nbuild it' })
  expect(w.calls[1]).toMatchObject({ subagent_type: 'team-builder', model: 'sonnet' })
  expect(w.calls[1].prompt).not.toContain('kairo-model:')
  const routes = w.processes.filter(p => (p.argv as string[])[2] === 'route')
  expect(routes).toHaveLength(2)
  expect(routes[1].argv).toContain('team-builder')
})

test('keeps the concrete model header on a replacement wrapper and never hands over twice', async ($, on) => {
  const w = handoverWorld(on, { reroute: { decision: 'ROUTED', provider: 'gemini', targetModel: 'gemini-a' }, second: exhaustedResult })
  expect((await $.tool.call(agent())).result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(2)
  expect(w.calls[1]).toEqual({ ...agent(), subagent_type: 'kairo-gemini', prompt: 'kairo-model: gemini-a\nPrevious codex provider stopped on quota. Continue from the current working tree state; do not redo finished work.\n\nbuild it' })
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'route')).toHaveLength(2)
  expect(w.toasts).toHaveLength(1)
  const outcomes = w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')
  expect(outcomes).toHaveLength(2)
  expect(outcomes[1].argv).toContain('gemini')
  expect(outcomes[1].argv).toContain('exhausted')
})

test('background launch records no outcome while the subagent keeps working', async ($, on) => {
  const launched = { content: [{ type: 'text', text: 'Async agent launched successfully.\nagentId: a1\nThe agent is working in the background. You will be notified when it completes.' }] }
  const w = handoverWorld(on, { first: launched })
  const result = await $.tool.call({ ...agent(), run_in_background: true })
  expect(result.result).toEqual(launched)
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-launch')).toHaveLength(1)
  expect(w.processes.filter(p => ['record-outcome', 'detect-exhaustion'].includes((p.argv as string[])[2]))).toHaveLength(0)
})

test('foreground launch with the background flag but a finished result still records its outcome', async ($, on) => {
  const w = handoverWorld(on, { first: { content: [{ type: 'text', text: 'Build completed.' }] } })
  await $.tool.call({ ...agent(), run_in_background: true })
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')).toHaveLength(1)
})

test('keeps a catalog agent already on the route provider instead of a wrapper and records its own model', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'codex', targetAgent: null, targetModel: 'gpt-a' })
  const input = { ...agent(), subagent_type: 'team-builder-codex' }
  await $.tool.call(input)
  expect(w.calls).toEqual([input])
  const launch = w.processes.find(p => (p.argv as string[])[2] === 'record-launch')
  expect(launch).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'team-builder-codex', '--adapter', 'codex', '--model', 'agent-own'] })
})

test('still wraps when the provider must change', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'gemini', targetAgent: null, targetModel: 'gemini-a' })
  await $.tool.call({ ...agent(), subagent_type: 'team-builder-codex' })
  expect(w.calls[0]).toMatchObject({ subagent_type: 'kairo-gemini', prompt: 'kairo-model: gemini-a\nbuild it' })
})

for (const reroute of [codexRoute, { decision: 'STALE', why: 'refresh required' }, { decision: 'ROUTED', provider: 'claude', targetAgent: null, targetModel: null }]) test(`does not relaunch exhausted work on unusable reroute ${JSON.stringify(reroute)}`, async ($, on) => {
  const w = handoverWorld(on, { reroute })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(1)
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('codex')
})

for (const recordFailure of ['throw', 'exit', 'pending']) test(`preserves original exhaustion when recording fails: ${recordFailure}`, async ($, on) => {
  const w = handoverWorld(on, { recordFailure })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(1)
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'route')).toHaveLength(1)
  expect(w.toasts).toHaveLength(1)
})

for (const rerouteFailure of ['throw', 'timeout', 'malformed']) test(`preserves original exhaustion when rerouting fails: ${rerouteFailure}`, async ($, on) => {
  const w = handoverWorld(on, { rerouteFailure })
  const result = await $.tool.call(agent())
  expect(result.result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(1)
  expect(w.toasts).toHaveLength(1)
})

test('ordinary failed work records failure without being retried as exhausted', async ($, on) => {
  const original = { content: [{ type: 'text', text: 'Compilation failed: missing variable.' }], exitCode: 1 }
  const w = handoverWorld(on, { first: original })
  expect((await $.tool.call(agent())).result).toEqual(original)
  expect(w.calls).toHaveLength(1)
  expect(w.processes.find(p => (p.argv as string[])[2] === 'record-outcome')?.argv).toContain('failed')
  expect(w.toasts).toHaveLength(0)
})

for (const detectionFailure of ['throw', 'malformed']) test(`fails open when shared exhaustion detection fails: ${detectionFailure}`, async ($, on) => {
  const w = handoverWorld(on, { detectionFailure })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(1)
  expect(w.toasts).toHaveLength(1)
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')).toHaveLength(0)
})

test('sends normalized tool text and exit metadata to the shared detector CLI', async ($, on) => {
  const w = handoverWorld(on)
  await $.tool.call(agent())
  const detected = w.processes.find(p => (p.argv as string[])[2] === 'detect-exhaustion')
  expect(detected).toMatchObject({ argv: ['kairo', 'team', 'detect-exhaustion', '--text', exhaustedResult.content[0].text, '--adapter', 'codex', '--exit-code', '1'], init: { timeoutMs: 2000 } })
})


test('successful error-handling summary preserves completion when the shared detector returns null', async ($, on) => {
  const original = {
    content: [{ type: 'text', text: 'Implemented handling for usage_limit_reached and rate_limit_exceeded errors. All tests pass.' }],
    exitCode: 0,
  }
  // The backend regression verifies this null response using the actual classifier.
  const w = handoverWorld(on, { first: original })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual(original)
  expect(w.calls).toHaveLength(1)
  expect(w.processes.find(p => (p.argv as string[])[2] === 'detect-exhaustion')).toMatchObject({ argv: ['kairo', 'team', 'detect-exhaustion', '--text', original.content[0].text, '--adapter', 'codex', '--exit-code', '0'] })
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'route')).toHaveLength(1)
  const outcomes = w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0].argv).toContain('completed')
  expect(outcomes[0].argv).not.toContain('exhausted')
  expect(w.toasts).toHaveLength(0)
})

for (const [name, rows, failure] of [
  ['pending', [{ agent: 'team-builder', modelId: 'gpt-a', at: '2026-10-23T00:00:00Z' }], undefined],
  ['empty', [], undefined],
  ['missing kairo', [], 'throw'],
  ['nonzero', [], 'exit'],
  ['timeout', [], 'timeout'],
  ['malformed', {}, undefined],
] as const) test(`pending verdict reminder: ${name}`, async ($, on) => {
  const w = world(on, rows, failure)
  const prompts: Array<Record<string, unknown>> = []
  on('prompt.submit', (_, e) => { prompts.push({ ...e }); return { text: e.text } })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'continue', context: ['existing'] })
  expect(prompts).toHaveLength(1)
  expect(prompts[0].text).toBe('continue')
  if (name === 'pending') {
    expect(prompts[0].context).toEqual(['existing', 'Kairo: 1 delegated result waits for a verdict; after verifying, run kairo team verdict --agent NAME --result pass or fail.'])
    expect(w.processes[0]).toMatchObject({ argv: ['kairo', 'team', 'verdict', '--pending', '--json', '--cwd', '/tmp/project'] })
  } else expect(prompts[0].context).toEqual(['existing'])
  expect(w.toasts).toHaveLength(0)
})

const pacingResponse = {
  ok: true, generatedAt: '2026-10-23T12:00:00Z', preferredProvider: 'codex', nextWriter: 'team-builder-codex', writerCounts: { claude: 3, codex: 1 },
  providers: {
    claude: { tier: 'CONSERVE', expectedDeadTimeMs: 7200000, windows: [{ name: 'weekly', remainingPercent: 10, resetsAt: '2026-10-24T12:00:00Z', expectedDeadTimeMs: 7200000 }] },
    codex: { tier: 'WATCH', expectedDeadTimeMs: 0, windows: [{ name: '5h', remainingPercent: 60, resetsAt: '2026-10-23T14:00:00Z', expectedDeadTimeMs: 0 }] },
  },
}
function pacingWorld(on: On, provider = 'codex') {
  const calls: Array<Record<string, unknown>> = [], prompts: Array<Record<string, unknown>> = [], statuses: unknown[] = []
  const processes: string[][] = []
  on('process.run', (_, e) => {
    const argv = e.argv as string[]; processes.push(argv)
    const value = argv[2] === 'pacing' ? pacingResponse : argv[2] === 'route' ? { decision: 'ROUTED', provider, targetAgent: provider === 'claude' ? 'team-builder' : 'team-builder-codex', targetModel: provider === 'claude' ? 'sonnet' : 'gpt-a' } : argv[2] === 'verdict' ? [] : null
    return { value: { exitCode: 0, stdout: JSON.stringify(value), stderr: '', timedOut: false } }
  })
  on('ui.status', (_, e) => { statuses.push(e); return { value: undefined } })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => { prompts.push({ ...e }); return { text: e.text } })
  on('tool.call', (_, e) => { const { tool_use_id, ...input } = e; calls.push(input); return { result: {} } })
  return { calls, prompts, statuses, processes }
}
test('one compact pacing context line and separate status entry preserve existing context', async ($, on) => {
  const w = pacingWorld(on)
  await $.prompt.submit({ text: 'continue', context: ['existing'] })
  expect(w.prompts[0].context).toEqual(['existing', expect.stringContaining('Pacing:')])
  const line = (w.prompts[0].context as string[])[1]
  expect(line).toContain('claude: week 10% (resets Oct 24) - would sit unused about 2h')
  expect(line).toContain('next writer team-builder-codex')
  expect(line.split('\n')).toHaveLength(1)
  expect(w.statuses).toHaveLength(1)
  expect(JSON.stringify(w.statuses[0])).not.toContain('10%')
})
test('display switches hide context and status without disabling routing', { options: { showBand: false, showStatus: false, showContext: false } }, async ($, on) => {
  const w = pacingWorld(on)
  await $.prompt.submit({ text: 'continue', context: ['existing'] })
  await $.tool.call(agent())
  expect(w.prompts[0].context).toEqual(['existing'])
  expect(w.statuses).toHaveLength(0)
  expect(w.calls[0].subagent_type).toBe('team-builder-codex')
})
for (const name of ['review-risk', 'review-resilience', 'review-readability', 'review-reliability', 'review-refuter', 'jd-judge-a', 'jd-judge-b', 'jd-fix-agent']) test(`never looks up or rewrites gentle actor ${name}`, async ($, on) => {
  const w = pacingWorld(on)
  const input = { ...agent(), subagent_type: name }
  await $.tool.call(input)
  expect(w.calls).toEqual([input])
  expect(w.processes).toHaveLength(0)
})

test('prompt no-redirect marker bypasses every subsequent Agent rewrite', async ($, on) => {
  const w = pacingWorld(on)
  await $.prompt.submit({ text: '[no-redirect] continue' })
  await $.tool.call(agent())
  expect(w.calls).toEqual([agent()])
  expect(w.processes.filter(argv => argv[2] === 'route')).toHaveLength(0)
})
test('malformed pacing windows fail open without blocking prompts', async ($, on) => {
  const prompts: unknown[] = []
  on('process.run', (_, e) => ({ value: { exitCode: 0, stdout: JSON.stringify((e.argv as string[])[2] === 'pacing' ? { ...pacingResponse, providers: { claude: { ...pacingResponse.providers.claude, windows: [null] } } } : []), stderr: '', timedOut: false } }))
  on('prompt.submit', (_, e) => { prompts.push(e); return { text: e.text } })
  await $.prompt.submit({ text: 'continue', context: ['existing'] })
  expect(prompts).toHaveLength(1)
})

test('band shows only action and constrained return, without quota percentages', async ($, on) => {
  pacingWorld(on)
  await $.prompt.submit({ text: 'continue' })
  const rendered = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', requestId: 'pacing', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} } })
  const text = JSON.stringify(rendered)
  expect(text).toContain("Use codex now; claude has quota now, but at today's pace it would sit unused about 2h (until Oct 24)")
  expect(text).not.toContain('10%')
  expect(text).not.toContain('CONSERVE')
})
test('hidden band leaves engine render unchanged', { options: { showBand: false } }, async ($, on) => {
  pacingWorld(on)
  await $.prompt.submit({ text: 'continue' })
  const rendered = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', requestId: 'pacing', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} } })
  expect(JSON.stringify(rendered)).not.toContain('Use codex')
})


test('conflicting pacing never bypasses qualified route accounting or exhaustion handling', async ($, on) => {
  const w = pacingWorld(on, 'claude')
  await $.prompt.submit({ text: 'continue' })
  await $.tool.call(agent())
  expect(w.calls[0].subagent_type).toBe('team-builder')
  expect(w.calls[0].model).toBe('sonnet')
  const launch = w.processes.find(argv => argv[2] === 'record-launch')
  expect(launch).toContain('claude')
  expect(launch).toContain('sonnet')
  expect(w.processes.filter(argv => argv[2] === 'detect-exhaustion')).toHaveLength(1)
  expect(w.processes.filter(argv => argv[2] === 'record-outcome')).toHaveLength(1)
})

test('pacing requests a qualified forced-provider route before launch accounting', async ($, on) => {
  const w = pacingWorld(on, 'claude')
  await $.prompt.submit({ text: 'continue' })
  await $.tool.call(agent())
  const route = w.processes.find(argv => argv[2] === 'route')!
  expect(route).toContain('--provider')
  expect(route[route.indexOf('--provider') + 1]).toBe('codex')
  // A mismatched response is not proof of a qualified redirect.
  expect(w.calls[0].subagent_type).toBe('team-builder')
})

test('empty providers appear once in context and never add unknown band rows', () => {
  const snapshot = { ...pacingResponse, providers: { ...pacingResponse.providers, 'opencode-go': { tier: null, windows: [], expectedDeadTimeMs: null } } }
  const context = pacingContext(snapshot)
  expect(context).toContain('No quota data: opencode-go')
  expect(context).not.toContain('UNKNOWN')
  expect(context.split('opencode-go')).toHaveLength(2)
  expect(pacingBand(snapshot)).not.toContain('opencode-go')
})

test('forced pacing route retains concrete model, launch accounting and unforced exhaustion handover', async ($, on) => {
  const w = handoverWorld(on, { pacing: true })
  await $.prompt.submit({ text: 'continue' })
  await $.tool.call(agent())
  const routes = w.processes.filter(p => (p.argv as string[])[2] === 'route')
  expect(routes).toHaveLength(2)
  expect(routes[0].argv).toContain('--provider')
  expect(routes[0].argv).toContain('codex')
  expect(routes[1].argv).not.toContain('--provider')
  expect(w.calls[0].subagent_type).toBe('team-builder-codex')
  expect(w.calls[1].model).toBe('sonnet')
  const launches = w.processes.filter(p => (p.argv as string[])[2] === 'record-launch')
  expect(launches).toHaveLength(2)
  expect(launches[0].argv).toContain('gpt-a')
  expect(launches[1].argv).toContain('sonnet')
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')).toHaveLength(2)
})


test('live status shows final routed model during launch and clears on completion', async ($, on) => {
  const statuses: unknown[] = [];
  world(on, { decision: 'ROUTED', role: 'Explorer', provider: 'claude', targetAgent: 'team-explorer', targetModel: 'claude-haiku-5-5' }, undefined, () => {
    expect(JSON.stringify(statuses)).toContain('Explorer - claude-haiku-5-5 - claude');
  });
  on('ui.status', (_, e) => { statuses.push(e); return { value: undefined } });
  await $.tool.call({ ...agent(), subagent_type: 'team-explorer' });
  expect(JSON.stringify(statuses[statuses.length - 1])).not.toContain('claude-haiku-5-5');
});


test('live work uses the band when status is disabled', { options: { showStatus: false } }, async ($, on) => {
  const statuses: unknown[] = [];
  let visible = '';
  world(on, { decision: 'ROUTED', role: 'Explorer', provider: 'claude', targetAgent: 'team-explorer', targetModel: 'haiku' }, undefined, async () => {
    visible = JSON.stringify(await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', requestId: 'running', props: { hasSurvey: false, isWorking: true, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} } }));
  });
  on('ui.status', (_, e) => { statuses.push(e); return { value: undefined } });
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }));
  await $.tool.call({ ...agent(), subagent_type: 'team-explorer' });
  expect(visible).toContain('Explorer - haiku - claude');
  expect(statuses).toHaveLength(0);
  const idle = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', requestId: 'idle', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} } });
  expect(JSON.stringify(idle)).not.toContain('Explorer - haiku - claude');
});

test('concurrent live status caps three workers and counts the rest', async ($, on) => {
  const statuses: unknown[] = [];
  const releases: Array<() => void> = [];
  let allStarted!: () => void;
  const started = new Promise<void>(resolve => { allStarted = resolve });
  world(on, { decision: 'ROUTED', role: 'Explorer', provider: 'claude', targetAgent: 'team-explorer', targetModel: 'haiku' }, undefined, () => new Promise<void>(resolve => {
    releases.push(resolve);
    if (releases.length === 4) allStarted();
  }));
  on('ui.status', (_, e) => { statuses.push(e); return { value: undefined } });
  const work = [1, 2, 3, 4].map(i => $.tool.call({ ...agent(String(i)), subagent_type: 'team-explorer' }));
  await started;
  const text = JSON.stringify(statuses[statuses.length - 1]);
  expect(text.split('Explorer - haiku - claude').length - 1).toBe(3);
  expect(text).toContain('+1 more');
  for (const release of releases) release();
  await Promise.all(work);
  expect(JSON.stringify(statuses[statuses.length - 1])).not.toContain('haiku');
});

test('band never says use now for an exhausted provider and never calls a provider with quota unavailable', () => {
  const at = '2026-10-23T21:15:00.000Z'
  const snapshot = { generatedAt: at, nextWriter: 'team-builder-codex', providers: {
    codex: { tier: 'CRITICAL', expectedDeadTimeMs: 5_700_000, windows: [
      { name: '5h', remainingPercent: 0, resetsAt: '2026-10-23T22:51:00.000Z', expectedDeadTimeMs: 5_700_000, tier: 'CRITICAL' }] },
    claude: { tier: 'CONSERVE', expectedDeadTimeMs: 338_000_000, windows: [
      { name: 'Current session', remainingPercent: 95, resetsAt: '2026-10-24T02:00:00.000Z', expectedDeadTimeMs: 0, tier: 'HEALTHY' },
      { name: 'week', remainingPercent: 42, resetsAt: '2026-10-28T17:00:00.000Z', expectedDeadTimeMs: 338_000_000, tier: 'CONSERVE' }] },
  } }
  const band = pacingBand(snapshot)!
  expect(band).not.toContain('Use codex now')
  expect(band).toMatch(/codex.*0%/)
  expect(band).not.toContain('claude returns')
  expect(band).toMatch(/claude has quota now/)
})
